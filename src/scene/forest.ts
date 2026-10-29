import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sceneConfig } from './config';
import naturalConfig from './config/natural-upgrade.json';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Point, Trail } from '../game/navigation';
import { createIslandRenderer } from './visland-renderer.js';
import type { IslandRenderer } from './visland-renderer.js';
import { addAutumnScenery } from './autumn';
import { createWeather } from './weather';
import { refineCreek } from './creek';
import { addEcology } from './ecology';
import { ForestSoundscape } from './soundscape';
import { addWildlife } from './wildlife';
import type { WeatherMode } from './weather';

export interface ForestManifest {
  route: [number, number, number][];
  viewpoints: { id: string; label: string; position: [number, number, number]; lookAt: [number, number, number] }[];
  source: string;
  baked: string[];
  trails?: Trail[];
  obstacles?: { x: number; z: number; radius: number }[];
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  solids?: { minX: number; maxX: number; minZ: number; maxZ: number }[];
  tent?: { center: Point; entrance: Point; interiorCamera: Point; interiorLookAt: Point; clearanceRadius: number; doorWidth: number; doorHeight: number };
}
export interface ForestView {
  renderer: THREE.WebGLRenderer | IslandRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  manifest: ForestManifest;
  position(): Point;
  update(seconds: number, moving: boolean): void;
  scenery(): { seed: number; animals: number[][]; variants: number };
  place(progress: number): void;
  viewpoint(id: string): void;
  walk(position: Point): void;
  look(dx: number, dy: number): void;
  resetLook(): void;
  move(dx: number, dz: number): void;
  pick(x: number, y: number): Point | null;
  resize(): void;
  setQuality(level: string): void;
  setWeather(mode: WeatherMode): void;
  armAudio(): Promise<void>;
  mute(muted: boolean): void;
  dispose(): void;
}

export async function createForest(host: HTMLElement, progress: (message: string) => void = () => {}): Promise<ForestView> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const requestedQuality=new URLSearchParams(location.search).get('quality');
  const profile=(level:string|null)=>level==='adaptive-min'?{maxWidth:800,maxHeight:500,shadowSize:512,nearDistance:12,farDistance:65}:level==='adaptive-low'||level==='auto'?{maxWidth:960,maxHeight:600,shadowSize:512,nearDistance:18,farDistance:90}:level==='smooth'?naturalConfig.quality.smooth:level==='high'?naturalConfig.quality.high:{maxWidth:sceneConfig.maxWidth,maxHeight:sceneConfig.maxHeight,shadowSize:2048,nearDistance:naturalConfig.vegetation.nearDistance,farDistance:naturalConfig.vegetation.farDistance};
  let quality=profile(requestedQuality);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = sceneConfig.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#adbdc0');
  scene.fog = new THREE.Fog('#adbdc0', sceneConfig.fogNear, sceneConfig.fogFar);
  const camera = new THREE.PerspectiveCamera(56, 1, .08, 1000);
  host.append(renderer.domElement);
  const sky = new Sky(); sky.name = 'Sky'; sky.scale.setScalar(10000);
  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 3; skyUniforms.rayleigh.value = 1.4;
  skyUniforms.mieCoefficient.value = .004; skyUniforms.mieDirectionalG.value = .8;
  skyUniforms.sunPosition.value.set(-.55,.38,.45); scene.add(sky);
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  const environmentScene = new THREE.Scene(); environmentScene.add(sky.clone());
  const environment = environmentGenerator.fromScene(environmentScene,.03,.1,15000);
  scene.environment = environment.texture; scene.environmentIntensity = .28; environmentGenerator.dispose();
  const sun = new THREE.DirectionalLight('#fff5df', naturalConfig.lighting.sunIntensity);
  sun.position.set(-35, 45, 10); sun.target.position.set(0, 0, -20);
  sun.castShadow = true; sun.shadow.mapSize.set(quality.shadowSize,quality.shadowSize);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 70, bottom: -70, near: 1, far: 130 });
  sun.shadow.normalBias = .035; sun.shadow.bias = -.0001;
  scene.add(sun, sun.target, new THREE.HemisphereLight('#d3e5ef', '#3c4a2d', 1.6));
  const detachedGeometry = new Set<THREE.BufferGeometry>();
  try {
    const response = await fetch(sceneConfig.manifestUrl);
    if (!response.ok) throw new Error(`场景清单加载失败 (${response.status})`);
    const manifest: ForestManifest = await response.json();
    const gltf = await new GLTFLoader().loadAsync(sceneConfig.assetUrl, event => progress(event.lengthComputable ? `主场景下载 ${(event.loaded/1e6).toFixed(1)} / ${(event.total/1e6).toFixed(1)} MB` : `主场景下载 ${(event.loaded/1e6).toFixed(1)} MB`));
    progress('主场景已下载，正在准备植被、动物与材质…');
    scene.add(gltf.scene);
    // Session seed changes natural silhouettes without moving authored trunks into paths.
    let seed = Number(new URLSearchParams(location.search).get('seed')) || crypto.getRandomValues(new Uint32Array(1))[0];
    const scenerySeed = seed;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const variants = new Map<string, { angle: number; scale: number }>();
    const animalMotion = { value: 0 };
    const animals: { mesh: THREE.Object3D; origin: THREE.Vector3; phase: number; legs: THREE.Object3D[]; neck?: THREE.Object3D }[] = [];
    gltf.scene.traverse(object => {
      if (!/^Animal_Deer_\d+$/.test(object.name)) return;
      const legs: THREE.Object3D[]=[]; let neck: THREE.Object3D | undefined;
      object.traverse(child=>{ if(child.name.startsWith('Deer_Leg_')) legs.push(child); if(child.name.startsWith('Deer_Neck_') && !(child instanceof THREE.Mesh)) neck=child; });
      animals.push({mesh:object,origin:object.position.clone(),phase:random()*Math.PI*2,legs,neck});
    });
    // Merge only siblings in an articulated part, so joints stay independently animated.
    for(const animal of animals) for(const joint of [animal.mesh,...animal.legs,...(animal.neck?[animal.neck]:[])]) {
      const groups=new Map<THREE.Material,THREE.Mesh[]>();
      for(const child of joint.children) if(child instanceof THREE.Mesh && !Array.isArray(child.material)) {const list=groups.get(child.material)??[];list.push(child);groups.set(child.material,list);}
      for(const [material,meshes] of groups) {
        if(meshes.length<2)continue;
        const pieces=meshes.map(m=>{m.updateMatrix();return m.geometry.clone().applyMatrix4(m.matrix);});
        const geometry=mergeGeometries(pieces); pieces.forEach(g=>g.dispose());if(!geometry)continue;
        const merged=new THREE.Mesh(geometry,material);merged.name='Deer_Articulated_Part';joint.add(merged);
        meshes.forEach(m=>{detachedGeometry.add(m.geometry);m.removeFromParent();});
      }
    }
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.name.startsWith('Tree_')) {
        const key = object.name.match(/^Tree_\d+/)?.[0] ?? object.name;
        const variant = variants.get(key) ?? { angle: random() * Math.PI * 2, scale: .88 + random() * .24 };
        variants.set(key, variant); object.rotation.y += variant.angle; object.scale.multiplyScalar(variant.scale);
        if (/^Tree_(Shrub|Fern)_/.test(object.name)) { object.position.x += (random()-.5)*1.2; object.position.z += (random()-.5)*1.2; }
      }
      if (object.name.startsWith('Rock_') || object.name.startsWith('Fallen_Log_')) object.rotation.y += random() * Math.PI * 2;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof THREE.MeshStandardMaterial && material.map && /Granite|Wood|Bark/.test(material.name)) { material.bumpMap = material.map; material.bumpScale = .035; }
        if(material instanceof THREE.MeshStandardMaterial && material.name==='Water') {
          material.roughness=.16;material.metalness=.35;material.color.set('#587b73');
          material.onBeforeCompile=shader=>{
            shader.uniforms.streamTime=animalMotion;
            shader.vertexShader='varying vec3 streamPosition;\n'+shader.vertexShader;
            shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n streamPosition=position;');
            shader.fragmentShader='uniform float streamTime; varying vec3 streamPosition;\n'+shader.fragmentShader;
            shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>','#include <normal_fragment_begin>\n normal=normalize(normal+vec3(sin(streamPosition.x*18.0+streamTime*1.7)*.12,0.0,cos(streamPosition.z*22.0-streamTime)*.12));');
          };material.customProgramCacheKey=()=> 'stream-ripples-v1';
        }
        if(material instanceof THREE.MeshStandardMaterial && material.name==='Forest_Floor') {
          material.onBeforeCompile=shader=>{
            shader.vertexShader='varying vec3 forestPosition;\n'+shader.vertexShader;
            shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n forestPosition=position;');
            shader.fragmentShader='varying vec3 forestPosition;\n'+shader.fragmentShader;
            shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n float moss=0.5+0.25*sin(forestPosition.x*.12+sin(forestPosition.z*.08)*2.0)+0.25*sin(forestPosition.z*.27+forestPosition.x*.04); diffuseColor.rgb*=mix(vec3(.62,.79,.41),vec3(.96,.90,.77),smoothstep(.22,.85,moss));');
          };material.customProgramCacheKey=()=> 'forest-floor-patches-v1';
        }
        if (material instanceof THREE.MeshStandardMaterial && material.name.includes('Foliage')) {
          const palette = ['#c4a04e', '#af753d', '#c49c57', '#9b642f'];
          material.color.set(palette[Math.abs([...material.name].reduce((n,c)=>n+c.charCodeAt(0),0)) % palette.length]);
          material.onBeforeCompile = shader => {
            shader.uniforms.animalMotion = animalMotion;
            shader.vertexShader = 'uniform float animalMotion;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.x += sin(animalMotion*1.4 + position.y*.7 + position.x)*smoothstep(2.0,8.0,position.y)*0.055;');
          };
          material.customProgramCacheKey = () => 'foliage-wind-v1';
        }
      }
    });
    // Repeated Blender meshes become draw batches; keep authored transforms.
    gltf.scene.updateMatrixWorld(true);
    const batches = new Map<string, THREE.Mesh[]>();
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material.name.includes('Foliage') || material.name.includes('fern')) { material.transparent = false; material.alphaTest = .45; material.side = THREE.DoubleSide; material.depthWrite = true; }
      }
      object.receiveShadow = true;
      object.castShadow = !object.name.startsWith('Ground') && !object.name.startsWith('Water');
      if(object.name==='Groundcover_Grass') {object.castShadow=false; for(const m of Array.isArray(object.material)?object.material:[object.material]) m.side=THREE.DoubleSide;}
      let isTree = object.name.startsWith('Tree_');
      for (let parent = object.parent; parent; parent = parent.parent) if (parent.name.startsWith('Tree_')) isTree = true;
      if (isTree) {
        const material = object.material;
        const position = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
        const tile=naturalConfig.vegetation.tileSize;
        const key = `${object.geometry.uuid}/${Array.isArray(material) ? material.map(m => m.uuid).join(',') : material.uuid}/${Math.floor(position.x / tile)},${Math.floor(position.z / tile)}`;
        const list = batches.get(key) ?? []; list.push(object); batches.set(key, list);
      }
    });
    const treeLods: {mesh: THREE.InstancedMesh; geometries: THREE.BufferGeometry[]; center: THREE.Vector3; level:number}[]=[];
    for (const meshes of batches.values()) {
      const first = meshes[0];
      const batch = new THREE.InstancedMesh(first.geometry, first.material, meshes.length);
      batch.castShadow = true; batch.receiveShadow = true;
      meshes.forEach((mesh, index) => { batch.setMatrixAt(index, mesh.matrixWorld); mesh.removeFromParent(); });
      batch.computeBoundingSphere(); scene.add(batch);
      const materials=Array.isArray(first.material)?first.material:[first.material];
      if(materials.some(m=>/Foliage|fern/.test(m.name)) && first.geometry.index) {
        const foliage=materials.find(m=>m instanceof THREE.MeshStandardMaterial && /Foliage|fern/.test(m.name)) as THREE.MeshStandardMaterial;
        const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,map:foliage.map,alphaTest:naturalConfig.vegetation.leafAlphaTest,side:THREE.DoubleSide});
        depth.onBeforeCompile=foliage.onBeforeCompile;depth.customProgramCacheKey=()=> 'foliage-wind-depth-v1';batch.customDepthMaterial=depth;
        const geometries=[first.geometry];
        for(const stride of [2,4]) {
          const geometry=first.geometry.clone(); const indices=first.geometry.index.array; const reduced:number[]=[];
          for(let i=0;i<indices.length;i+=6*stride) for(let j=0;j<6 && i+j<indices.length;j++) reduced.push(indices[i+j]);
          geometry.setIndex(reduced); geometries.push(geometry); detachedGeometry.add(geometry);
        }
        treeLods.push({mesh:batch,geometries,center:batch.boundingSphere!.center.clone(),level:0});
      }
      else {
        const geometries=[first.geometry];
        if(first.geometry.index && materials.some(m=>m.name.includes('Bark'))) {
          const indices=first.geometry.index.array,positions=first.geometry.getAttribute('position');
          const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
          for(const threshold of [.012,.035]) {
            const kept:number[]=[];
            for(let i=0;i<indices.length;i+=3) {
              a.fromBufferAttribute(positions,indices[i]);b.fromBufferAttribute(positions,indices[i+1]).sub(a);c.fromBufferAttribute(positions,indices[i+2]).sub(a);
              if(b.cross(c).length()*.5>threshold)kept.push(indices[i],indices[i+1],indices[i+2]);
            }
            const geometry=first.geometry.clone();geometry.setIndex(kept);geometries.push(geometry);detachedGeometry.add(geometry);
          }
        }
        treeLods.push({mesh:batch,geometries,center:batch.boundingSphere!.center.clone(),level:0});
      }
    }
    // Static rocks, timber and bridge pieces share draw calls while preserving authored UVs.
    const staticBatches = new Map<string, THREE.Mesh[]>();
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) || object.name.startsWith('Ground') || object.name.startsWith('Water') || object.name.startsWith('Animal_')) return;
      for(let parent=object.parent;parent;parent=parent.parent) if(parent.name.startsWith('Animal_')) return;
      const key = `${object.material.uuid}/${Object.keys(object.geometry.attributes).sort().join(',')}/${!!object.geometry.index}`;
      const list = staticBatches.get(key) ?? []; list.push(object); staticBatches.set(key, list);
    });
    for (const meshes of staticBatches.values()) {
      if (meshes.length < 2) continue;
      const transformed = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
      const geometry = mergeGeometries(transformed); transformed.forEach(g => g.dispose());
      if (!geometry) continue;
      const batch = new THREE.Mesh(geometry, meshes[0].material); batch.castShadow = true; batch.receiveShadow = true;
      meshes.forEach(mesh => { detachedGeometry.add(mesh.geometry); mesh.removeFromParent(); }); scene.add(batch);
    }
    const path = new THREE.CatmullRomCurve3(manifest.route.map(point => new THREE.Vector3(...point)), false, 'centripetal');
    const ground: THREE.Object3D[] = [];
    gltf.scene.traverse(object => { if (object instanceof THREE.Mesh && object.name.startsWith('Ground')) ground.push(object); });
    for (const meshes of staticBatches.values()) for (const mesh of meshes) if (mesh.name.startsWith('Bridge_Plank')) ground.push(mesh);
    const creek = refineCreek(scene, ground);
    const autumn = addAutumnScenery(scene, ground);
    const ecology = addEcology(scene, ground, manifest);
    const soundscape = new ForestSoundscape();
    const wildlife = addWildlife(scene,ground,manifest,soundscape,creek.splash);
    scene.userData.ecology = {counts:ecology.counts,ancientTrees:ecology.ancientTrees};
    animals.forEach(a=>a.mesh.removeFromParent());
    manifest.solids = [...(manifest.solids ?? []), ...autumn.solids];
    for (const [id, view] of Object.entries(autumn.views)) manifest.viewpoints.push({id,label:({moose:'驼鹿林地',wetland:'秋季湿地',cabin:'红木屋',canopy:'秋色树冠'} as Record<string,string>)[id],position:view.position as Point,lookAt:view.lookAt as Point});
    const weather = createWeather(scene,camera,ground,ecology.sample);
    const setWeather=(mode:WeatherMode)=>{
      weather.setMode(mode);
      const storm=mode!=='clear';soundscape.setRain(storm);
      skyUniforms.turbidity.value=storm?14:3;
      skyUniforms.rayleigh.value=storm?.3:1.4;
      sun.intensity=storm?.15:2.5;
      scene.fog=storm?new THREE.Fog('#66737e',30,210):new THREE.Fog('#adbdc0',sceneConfig.fogNear,sceneConfig.fogFar);
    };
    const ray = new THREE.Raycaster();
    const body = new THREE.Vector3();
    let walked = 0, motionTime = 0, bob = 0;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let yaw = 0, pitch = 0, baseYaw = 0;
    const orient = () => { camera.rotation.set(pitch, baseYaw + yaw, 0, 'YXZ'); };
    const look = (dx: number, dy: number) => { yaw -= dx * .003; pitch = THREE.MathUtils.clamp(pitch - dy * .003, -1.2, 1.2); orient(); };
    const resetLook = () => { yaw = 0; pitch = 0; orient(); };
    const walk = (position: Point) => {
      const dx = position[0] - body.x, dz = position[2] - body.z;
      walked += Math.hypot(dx, dz);
      if (Math.hypot(dx, dz) > .001) {
        const heading = Math.atan2(-dx, -dz);
        const difference = Math.atan2(Math.sin(heading - baseYaw), Math.cos(heading - baseYaw));
        baseYaw += difference * .08;
      }
      body.set(...position); orient();
    };
    const move = (dx: number, dz: number) => {
      const angle = baseYaw + yaw;
      const x = body.x + dx * Math.cos(angle) + dz * Math.sin(angle);
      const z = body.z - dx * Math.sin(angle) + dz * Math.cos(angle);
      const bounds = manifest.bounds ?? { minX: -65, maxX: 65, minZ: -85, maxZ: 42 };
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ || (manifest.obstacles ?? []).some(o => Math.hypot(x - o.x, z - o.z) < o.radius + .3)) return;
      if ((manifest.solids ?? []).some(b=>x>b.minX-.25 && x<b.maxX+.25 && z>b.minZ-.25 && z<b.maxZ+.25)) return;
      const hit = ecology.sample(x,z);
      if (hit && Math.abs(hit.point.y + 1.7 - body.y) < .5) { walked += Math.hypot(x-body.x,z-body.z); body.set(x, hit.point.y + 1.7, z); }
    };
    const pick = (x: number, y: number): Point | null => {
      ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
      const hit = ray.intersectObjects(ground, false)[0];
      return hit ? [hit.point.x, hit.point.y + 1.7, hit.point.z] : null;
    };
    let activeRenderer: THREE.WebGLRenderer | IslandRenderer = renderer;
    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, sceneConfig.maxDpr, quality.maxWidth / Math.max(width, 1), quality.maxHeight / Math.max(height, 1));
      renderer.setPixelRatio(dpr); renderer.setSize(width, height);
      if (activeRenderer !== renderer) { activeRenderer.setPixelRatio(dpr); activeRenderer.setSize(width, height); }
      camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix();
    };
    const setQuality=(level:string)=>{
      quality=profile(level);sun.shadow.map?.dispose();sun.shadow.map=null;
      sun.shadow.mapSize.set(quality.shadowSize,quality.shadowSize);sun.shadow.needsUpdate=true;resize();
      if ('backend' in activeRenderer) activeRenderer.setQuality(quality.shadowSize);
    };
    const place = (progress: number) => {
      const p = Math.min(1, Math.max(0, progress));
      const previous = body.clone(); body.copy(path.getPointAt(p));
      if (p > 0) walked += Math.hypot(body.x-previous.x,body.z-previous.z);
      const surface = ecology.sample(body.x,body.z);
      if (surface) body.y = surface.point.y + 1.7;
      const ahead = path.getPointAt(Math.min(1, p + .025));
      if (p > .975) ahead.add(path.getTangentAt(p).multiplyScalar(4));
      baseYaw = Math.atan2(body.x - ahead.x, body.z - ahead.z);
      if (p === 0) { camera.position.copy(body); bob = 0; }
      orient();
    };
    const viewpoint = (id: string) => {
      if(id==='animals') id='moose';
      if (id === 'tent' && manifest.tent) { camera.position.set(...manifest.tent.interiorCamera); camera.lookAt(new THREE.Vector3(...manifest.tent.interiorLookAt)); body.copy(camera.position); return; }
      if (id === 'tent-outside' && manifest.tent) { const [x,y,z]=manifest.tent.center; camera.position.set(x+4,y+2.0,z+6.5); camera.lookAt(x,y+1.0,z); body.copy(camera.position); return; }
      const view = manifest.viewpoints.find(v => v.id === id);
      if (!view) return;
      camera.position.set(...view.position); camera.lookAt(new THREE.Vector3(...view.lookAt));
      body.copy(camera.position);
    };
    const update = (seconds: number, moving: boolean) => {
      const dt = Math.min(Math.max(seconds, 0), .1); motionTime += dt;
      autumn.update(motionTime,weather.mode()!=='clear');
      weather.update(dt);
      soundscape.update(camera,dt);
      wildlife.update(dt,camera,weather.mode()!=='clear');
      creek.update(dt,weather.mode()==='rain');
      animalMotion.value = motionTime;
      for(const lod of treeLods) {
        const distance=camera.position.distanceTo(lod.center);
        const near=quality.nearDistance+(lod.level===0?5:-5),far=quality.farDistance+(lod.level<2?10:-10);
        const level=distance<near?0:distance<far?1:2;lod.level=level;
        lod.mesh.geometry=lod.geometries[Math.min(level,lod.geometries.length-1)]; lod.mesh.castShadow=distance<85;
      }
      if (dt > 0) {
        const desired = moving && !reducedMotion ? Math.sin(walked * Math.PI * 2 / 1.5) * .018 : 0;
        bob += (desired-bob) * (1-Math.exp(-12*dt));
        camera.position.x = body.x; camera.position.z = body.z;
        camera.position.y += (body.y + bob - camera.position.y) * (1-Math.exp(-18*dt));
      }
    };
    if (new URLSearchParams(location.search).get('engine') !== 'webgl') {
      try { activeRenderer = await createIslandRenderer(host, scene, renderer); }
      catch (error) { console.info('WebGPU unavailable; using the existing WebGL renderer.', error instanceof Error ? error.message : error); progress('使用 WebGL 兼容显示…'); }
    }
    resize(); place(0);setWeather(new URLSearchParams(location.search).get('weather')==='rain'?'rain':'clear');
    return { renderer: activeRenderer, scene, camera, manifest, position: () => body.toArray() as Point, scenery: () => ({ seed: scenerySeed, animals: [...autumn.moose,...autumn.ducks].map(a => a.position.toArray()), variants: variants.size }), update, resize, setQuality, setWeather, armAudio:async()=>{await Promise.all([weather.armAudio(),soundscape.arm(camera)]);},mute:muted=>{weather.mute(muted);soundscape.mute(muted);}, place, viewpoint, walk, look, resetLook, move, pick, dispose: () => { soundscape.dispose();creek.dispose();weather.dispose(); if (activeRenderer !== renderer) activeRenderer.dispose(); environment.dispose(); detachedGeometry.forEach(g => g.dispose()); disposeScene(scene, renderer); } };
  } catch (error) { environment.dispose(); detachedGeometry.forEach(g => g.dispose()); disposeScene(scene, renderer); throw error; }
}

function disposeScene(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  scene.traverse(object => {
    if (object instanceof THREE.Mesh) {
      if(object.customDepthMaterial) materials.add(object.customDepthMaterial);
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => {
        materials.add(material);
        Object.values(material).forEach(value => { if (value instanceof THREE.Texture) textures.add(value); });
      });
    }
    if (object instanceof THREE.Light) object.shadow?.dispose();
  });
  textures.forEach(t => { const data = t.source.data; if (typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap) data.close(); t.dispose(); });
  materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
  renderer.dispose(); renderer.domElement.remove();
}

