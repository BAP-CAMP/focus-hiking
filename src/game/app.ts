import { createForest } from '../scene/forest';
import { sitePath } from '../site-path';
import { forestVolume, setForestVolume, unlockForestAudio } from '../scene/audio-context';
import type { ForestView } from '../scene/forest';
import { Tour } from './tour';
import { findTrailPath, nearestTrack, TrailWalker } from './navigation';
import type { Point } from './navigation';
import type { AttentionPort, SceneEvent, ScenePort, GazeEvent, TargetRegion, InputSource } from '../contracts';

// Optional existing A port. The current entry deliberately does not pass simulated input.
export interface GameOptions {
  hike?: boolean;
  onReady?: (forest: ForestView) => void;
  onFrame?: (forest: ForestView, now: number, dtMs: number) => boolean;
  onError?: (message: string) => void;
}
export function mountGame(app: HTMLElement, attention?: AttentionPort, options: GameOptions = {}) {
  app.innerHTML = `
    <div class="scene-host" aria-label="森林登山三维场景"></div>
    <header class="topbar"><a class="brand" href="${sitePath()}">此刻山间 <span>· Here in the Mountains</span></a><span class="version">秋季山林 · 鼠标与键盘探索</span></header>
    <section class="intro"><p class="eyebrow">FOREST WALK · 林间漫步</p><h1>走进林间，<br>留一点时间给自己。</h1><p class="intro-copy">穿过溪谷、白桦林与山坡。<br>自由漫步，或规划一段登顶路线。</p><button class="primary" id="start" disabled>正在准备森林…</button><p class="hint">自由探索 · 路线规划 · 可随时暂停</p></section>
    <aside class="explore" hidden><h2>林地探索</h2><p>拖动画面转头 · WASD 行走<br>同一片山林，选择自己的走法</p><button id="mode">路线规划</button><button id="center">视角归正</button><svg id="explorer-map" viewBox="-195 -255 390 381" role="img" aria-label="探索地图：三条连通小径与当前位置" style="width:100%;height:180px;background:#24332b;border:1px solid #ffffff35"></svg><div class="destinations" hidden><button data-destination="camp">营地</button><button data-destination="trail">苔岩环线</button><button data-destination="creek">溪谷木桥</button><button data-destination="ridge">山顶俯瞰</button></div><button id="depart" hidden disabled>确认路线并出发</button><p id="navigation-status" aria-live="polite">自由探索 · 地图显示当前位置</p><small>当前为鼠标与键盘模式；目的地用鼠标选择。</small></aside>
    <aside class="error" role="alert" hidden><h2>暂时无法进入森林</h2><p></p><button id="retry">重新加载</button></aside>
    <section class="controls" hidden><div class="journey"><span id="stage">营地出发</span><span id="time">00:00 / 02:00</span></div><progress max="1" value="0" aria-label="游览进度"></progress><div class="buttons"><button id="pause">暂停</button><button id="restart">回到起点</button><button id="report">下载运行记录</button></div></section>
    <footer class="footer"><span>混合林 · 溪谷 · 山坡 <label style="margin-left:12px">画质 <select id="quality" aria-label="场景画质"><option value="original">原画</option><option value="high">高清</option><option value="smooth">流畅</option></select></label> <label>天气 <select id="weather" aria-label="天气模式"><option value="clear">晴天</option><option value="rain">阴雨雷暴</option></select></label> <button id="storm-sound" aria-pressed="false">开启环境声音</button></span><span id="metrics">加载中</span><a href="${sitePath('audio/forest/CREDITS.md')}" target="_blank" rel="noopener" style="color:inherit">声音来源</a></footer>
    <div class="end" hidden><p class="eyebrow">END OF THE TRAIL</p><h2>这一段，走完了。</h2><p>你可以再走一遍，也可以停留片刻。</p><button class="primary" id="again">再走一遍</button><button id="end-report">下载运行记录</button></div>`;
  const get = <T extends HTMLElement>(selector: string) => app.querySelector<T>(selector)!;
  const qualitySelect=get<HTMLSelectElement>('#quality');
  if(options.hike) qualitySelect.insertAdjacentHTML('afterbegin','<option value="auto">自动</option>');
  qualitySelect.value=new URLSearchParams(location.search).get('quality')||(options.hike?'auto':'original');
  qualitySelect.addEventListener('change',()=>{forest?.setQuality(qualitySelect.value);const url=new URL(location.href);url.searchParams.set('quality',qualitySelect.value);history.replaceState(null,'',url);});
  const weatherSelect=get<HTMLSelectElement>('#weather');weatherSelect.value=new URLSearchParams(location.search).get('weather')==='rain'?'rain':'clear';
  if(options.hike)weatherSelect.insertAdjacentHTML('beforeend','<option value="cloudy">阴天 · 雷声</option>');
  const soundButton=get<HTMLButtonElement>('#storm-sound');let soundsOn=false,soundWanted=false,soundPending:Promise<void>|null=null;
  soundButton.insertAdjacentHTML('afterend',` <label>音量 <input id="sound-volume" type="range" min="0" max="100" step="5" value="${Math.round(forestVolume()*100)}" aria-label="环境声音音量" style="width:90px;vertical-align:middle"><output id="sound-volume-value">${Math.round(forestVolume()*100)}%</output></label>`);
  const enableSound=()=>{
    if(!forest)return Promise.resolve();soundWanted=true;if(soundPending)return soundPending;
    const view=forest;soundButton.textContent='正在开启声音…';
    soundPending=(async()=>{try{await view.armAudio();if(disposed||view!==forest||!soundWanted||suspended)return;view.mute(false);soundsOn=true;soundButton.textContent='静音';soundButton.setAttribute('aria-pressed','true');soundButton.title='环境声音已开启';}catch{if(disposed||view!==forest||!soundWanted||suspended)return;view.mute(true);soundsOn=false;soundButton.textContent='点击开启环境声音';soundButton.setAttribute('aria-pressed','false');soundButton.title='声音未启动，请点击重试；也请检查系统音量';}finally{soundPending=null;}})();
    return soundPending;
  };
  weatherSelect.addEventListener('change',()=>{forest?.setWeather(weatherSelect.value==='rain'?'rain':'clear');const url=new URL(location.href);url.searchParams.set('weather',weatherSelect.value);history.replaceState(null,'',url);if(soundWanted)void enableSound();});
  soundButton.onclick=()=>{if(soundsOn){soundWanted=false;forest?.mute(true);soundsOn=false;soundButton.textContent='开启环境声音';soundButton.setAttribute('aria-pressed','false');}else void enableSound();};
  get<HTMLInputElement>('#sound-volume').oninput=event=>{const value=Number((event.target as HTMLInputElement).value);setForestVolume(value/100);get('#sound-volume-value').textContent=`${value}%`;};
  const audioGesture=(event:Event)=>{if(!event.isTrusted||!soundWanted||soundsOn||event.target===soundButton)return;void unlockForestAudio().catch(()=>{});void enableSound();};
  app.addEventListener('pointerdown',audioGesture,true);app.addEventListener('keydown',audioGesture,true);
  const host = get<HTMLDivElement>('.scene-host');
  const start = get<HTMLButtonElement>('#start');
  const controls = get<HTMLElement>('.controls');
  const pause = get<HTMLButtonElement>('#pause');
  const error = get<HTMLElement>('.error');
  const intro = get<HTMLElement>('.intro');
  const end = get<HTMLElement>('.end');
  const tour = new Tour();
  let exploring = !!options.hike, walker: TrailWalker | null = null, explorationPaused = false;
  let planning = false, plannedGoal: Point | null = null;
  const map = get<SVGSVGElement & HTMLElement>('#explorer-map');
  const depart = get<HTMLButtonElement>('#depart');
  let displayedRoute:Point[]=[],followMap=true;
  const trackStatus=document.createElement('p');trackStatus.id='track-status';trackStatus.setAttribute('aria-live','polite');map.after(trackStatus);
  const mapToggle=document.createElement('button');mapToggle.textContent='查看全图';mapToggle.id='map-follow';trackStatus.after(mapToggle);
  mapToggle.onclick=()=>{followMap=!followMap;mapToggle.textContent=followMap?'查看全图':'跟随当前位置';if(!followMap)map.setAttribute('viewBox','-195 -255 390 381');};
  const drawMap = (route: Point[] = []) => {
    if (!forest) return;
    displayedRoute=route;
    const colors = ['#b9c9a2','#aaa491','#d7bd81'];
    map.innerHTML = (forest.manifest.trails ?? []).map((trail,i) => `<polyline fill="none" stroke="${colors[i%3]}" stroke-width="2.5" points="${trail.points.map(p=>`${p[0]},${p[2]}`).join(' ')}"/>`).join('') +
      `<polyline fill="none" stroke="#eae7ca" stroke-width="5" points="${route.map(p=>`${p[0]},${p[2]}`).join(' ')}"/>` +
      forest.manifest.viewpoints.map(v => `<circle cx="${v.position[0]}" cy="${v.position[2]}" r="2" fill="#d7bd81"><title>${v.label}</title></circle>`).join('') + '<line id="track-offset" stroke="#e4a179" stroke-width=".65" stroke-dasharray="2 1"/><circle id="map-position" r="1.7" fill="#f2f3ed" stroke="#121916" stroke-width=".4"/><path id="map-heading" d="M 0 -4 L -1 -2 L 1 -2 Z" fill="#f2f3ed"/>';
  };
  let navigationSource: InputSource = 'manual';
  const keys = new Set<string>();
  let drag: { x: number; y: number; moved: boolean } | null = null;
  const exploration = get<HTMLElement>('.explore');
  const navigationStatus = get<HTMLElement>('#navigation-status');
  const setExploring = () => {
    if (!forest || fixedView) return;
    tour.pause(); exploring = true; explorationPaused = false;
    walker = new TrailWalker(forest.position());
    end.hidden = true; controls.hidden = false; exploration.hidden = false;
    get<HTMLElement>('#mode').textContent = planning ? '自由探索' : '路线规划'; pause.textContent = '暂停';
    navigationStatus.textContent = '自由探索 · 选择目的地或 WASD 行走';
  };
  const goTo = (goal: Point, source: InputSource = 'manual') => {
    if (!forest) return;
    if (!exploring) setExploring();
    walker!.position = forest.position();
    const route = findTrailPath(forest.manifest.trails ?? [{ id: 'main', label: '主路', points: forest.manifest.route }], walker!.position, goal);
    if (!route.length) { navigationStatus.textContent = '这里没有连通的小径，请选择路标。'; return; }
    walker!.go(route); explorationPaused = false; pause.textContent = '暂停';
    navigationSource = source;
    navigationStatus.textContent = '沿小径前往目的地 · 可暂停或重新选择';
    emit({ type: 'movementStarted', timestampMs: performance.now() });
  };
  const plan = (goal: Point) => {
    if (!forest || !planning) return;
    const route = findTrailPath(forest.manifest.trails ?? [], forest.position(), goal);
    if (route.length && Math.hypot(route[0][0]-forest.position()[0],route[0][2]-forest.position()[2])>3) {
      plannedGoal = null; depart.disabled = true; navigationStatus.textContent = '请先在自由探索中走近地图上的小径，再规划路线'; return;
    }
    plannedGoal = route.length ? goal : null; depart.disabled = !plannedGoal;
    drawMap(route);
    const distance = route.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((v,k)=>v-route[i][k])),0);
    navigationStatus.textContent = route.length ? `规划约 ${Math.round(distance)} m · ${Math.ceil(distance/1.45/60)} 分钟 · 确认后出发` : '未找到连通路线';
  };
  const targetRegions = (): TargetRegion[] => {
    const viewport = host.getBoundingClientRect();
    return [...app.querySelectorAll<HTMLButtonElement>('[data-destination]')].map(button => {
      const rect = button.getBoundingClientRect();
      return { id: `explore-${button.dataset.destination}`, x: (rect.left - viewport.left) / viewport.width, y: (rect.top - viewport.top) / viewport.height, width: rect.width / viewport.width, height: rect.height / viewport.height, enabled: !exploration.hidden && !document.hidden && !walker?.moving && !explorationPaused };
    });
  };
  let cameraValidAt = -Infinity, previousTargetState = '';
  const offSamples = attention?.subscribeSamples(sample => { cameraValidAt = sample.source === 'camera' && sample.valid ? sample.timestampMs : -Infinity; });
  const onConfirmation = (event: GazeEvent) => {
    const sampleAge = performance.now() - cameraValidAt;
    if (event.type !== 'targetConfirmed' || !event.targetId || sampleAge < 0 || sampleAge > 250) return;
    const target = targetRegions().find(region => region.id === event.targetId && region.enabled);
    const view = target && forest?.manifest.viewpoints.find(v => `explore-${v.id}` === target.id);
    if (view && planning) goTo(view.position, 'camera');
  };
  const offEvents = attention?.subscribeEvents(onConfirmation);
  const sceneListeners = new Set<(event: SceneEvent) => void>();
  const arrived = new Set<string>();
  const emit = (event: SceneEvent) => sceneListeners.forEach(listener => listener(event));
  let forest: ForestView | null = null;
  let frame = 0, last = 0, disposed = false, attempt = 0;
  let startedAt = 0, loadedMs = 0, nextMetric = 0;
  let gpu = '不可获取';
  const frameTimes: number[] = [];
  const search = new URLSearchParams(location.search);
  const fixedView = search.get('view');
  let suspended = !!document.documentElement.dataset.exhibitPaused || document.hidden;
  const render = (now: number) => {
    frame = 0;
    if (disposed || !forest || suspended || document.hidden) return;
    const dt = last ? now - last : 0; last = now;
    if (!document.hidden) {
      const hikeWalking = options.onFrame?.(forest, now, dt) ?? false;
      if (!exploring) tour.advance(Math.min(dt, 100));
      if (!exploring && (tour.state === 'running' || tour.state === 'completed')) {
        for (const [id, progress] of [['camp', 0], ['trail', .2], ['creek', .6], ['ridge', .85]] as const) {
          if (tour.progress >= progress && !arrived.has(id)) { arrived.add(id); emit({ type: 'nodeArrived', nodeId: id, timestampMs: now }); }
        }
      }
      if (!fixedView) {
        if (!exploring) forest.place(tour.progress);
        else if (!explorationPaused && walker) {
          const wasMoving = walker.moving;
          walker.update(dt / 1000);
          if (wasMoving) forest.walk(walker.position);
          if (wasMoving && !walker.moving) { navigationStatus.textContent = '已到达 · 可以转头、继续探索或返回营地'; emit({ type: 'movementEnded', timestampMs: now }); }
          const dx = Number(keys.has('d')) - Number(keys.has('a')), dz = Number(keys.has('s')) - Number(keys.has('w'));
          if (dx || dz) { walker.stop(); plannedGoal = null; depart.disabled = true; navigationSource = 'manual'; const speed = Math.min(dt, 100) * .00145 / Math.hypot(dx, dz); forest.move(dx * speed, dz * speed); walker.position = forest.position(); }
        }
      }
      if (options.hike) forest.update(Math.min(dt,100)/1000,hikeWalking);
      else if (!fixedView) forest.update(exploring ? (explorationPaused ? 0 : dt/1000) : (tour.state === 'running' ? dt/1000 : 0), exploring ? !!walker?.moving || keys.size > 0 : tour.state === 'running');
      else forest.update(Math.min(dt,100)/1000,false);
      const marker = map.querySelector('#map-position');
      if (marker) {
        const p=forest.position();marker.setAttribute('cx',String(p[0]));marker.setAttribute('cy',String(p[2]));
        if(followMap)map.setAttribute('viewBox',`${p[0]-45} ${p[2]-45} 90 90`);
        map.querySelector('#map-heading')?.setAttribute('transform',`translate(${p[0]} ${p[2]}) rotate(${-forest.camera.rotation.y*180/Math.PI})`);
        const candidates=displayedRoute.length>1?[{label:'所选路线',points:displayedRoute}]:(forest.manifest.trails??[]);
        const closest=candidates.map(t=>({label:t.label,hit:nearestTrack(t.points,p)})).filter(t=>t.hit).sort((a,b)=>a.hit!.distance-b.hit!.distance)[0];
        if(closest?.hit){const {point,distance}=closest.hit,off=distance>2.5;trackStatus.textContent=`${off?'已偏离':'位于'}${closest.label} · 距路线 ${distance.toFixed(1)} m`;trackStatus.dataset.offRoute=String(off);
          marker.setAttribute('fill',off?'#e4a179':'#f2f3ed');const line=map.querySelector('#track-offset');line?.setAttribute('x1',String(p[0]));line?.setAttribute('y1',String(p[2]));line?.setAttribute('x2',String(point[0]));line?.setAttribute('y2',String(point[2]));}
      }
      forest.renderer.render(forest.scene, forest.camera);
      if (dt > 0 && dt < 1000) { frameTimes.push(dt); if (frameTimes.length > 3600) frameTimes.shift(); }
    }
    get<HTMLProgressElement>('progress').value = tour.progress;
    const seconds = Math.floor(tour.elapsedMs / 1000);
    get<HTMLElement>('#time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} / 02:00`;
    get<HTMLElement>('#stage').textContent = tour.progress < .2 ? '营地出发' : tour.progress < .6 ? '林间小径' : tour.progress < .85 ? '溪流木桥' : '山脊远景';
    if (!exploring && tour.state === 'completed' && end.hidden) { end.hidden = false; controls.hidden = true; emit({ type: 'movementEnded', nodeId: 'ridge', timestampMs: now }); }
    if (exploring && forest) { get<HTMLElement>('#stage').textContent = planning ? '路线规划' : '自由探索'; get<HTMLElement>('#time').textContent = `海拔差 ${(forest.position()[1] - forest.manifest.viewpoints[0].position[1]).toFixed(1)} m`; }
    if (attention) {
      const regions = targetRegions(), state = JSON.stringify(regions);
      if (state !== previousTargetState) { attention.setTargets(regions); previousTargetState = state; }
    }
    if (now > nextMetric) {
      const recent = frameTimes.slice(-120); const fps = recent.length ? 1000 * recent.length / recent.reduce((a, b) => a + b, 0) : 0;
      get<HTMLElement>('#metrics').textContent = options.hike?`${Math.round(fps)} FPS`:`${Math.round(fps)} FPS · ${forest.renderer.info.render.calls} draws · ${navigationSource}`;
      nextMetric = now + 1000;
    }
    frame = requestAnimationFrame(render);
  };
  const load = async () => {
    const id = ++attempt; cancelAnimationFrame(frame); forest?.dispose(); forest = null;
    error.hidden = true; start.disabled = true; start.textContent = '正在准备森林…';
    startedAt = performance.now();
    try {
      const view = await createForest(host, message => { if (!disposed && id === attempt) start.textContent = message; });
      if (disposed || id !== attempt) { view.dispose(); return; }
      forest = view; loadedMs = performance.now() - startedAt;
      if ('backend' in view.renderer) gpu = `${view.renderer.backend} ${view.renderer.gpuDescription}`;
      else {
        const gl = view.renderer.getContext();
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        if (debug) gpu = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
      }
      if (fixedView) { view.viewpoint(fixedView); intro.hidden = true; }
      if(options.hike) {
        intro.hidden=true; exploration.hidden=false;
        get<HTMLElement>('.version').textContent='眼动徒步 · 秋季森林';
        exploration.querySelector('h2')!.textContent='当前位置';
        exploration.querySelector('p')!.textContent='地图跟随位置；路线旁显示偏离距离。';
        for(const selector of ['#mode','#center','.destinations','#depart','#navigation-status','.explore small'])get<HTMLElement>(selector).hidden=true;
        weatherSelect.disabled=true; forest.setQuality(qualitySelect.value);
      }
      drawMap(); start.disabled = false; start.textContent = '开始探索'; last = 0;
      options.onReady?.(forest);
      frame = requestAnimationFrame(render);
    } catch (cause) {
      if (disposed || id !== attempt) return;
      error.hidden = false; start.textContent = '加载未完成';
      error.querySelector('p')!.textContent = `${cause instanceof Error ? cause.message : '加载失败'}。请检查网络与浏览器图形支持，然后点击重新加载。`;
      options.onError?.(error.querySelector('p')!.textContent!);
    }
  };
  const begin = () => { intro.hidden = true; setExploring(); void enableSound(); };
  start.onclick = begin;
  pause.onclick = () => { if (exploring) { explorationPaused = !explorationPaused; keys.clear(); pause.textContent = explorationPaused ? '继续' : '暂停'; } else if (tour.state === 'running') { tour.pause(); pause.textContent = '继续'; } else { tour.start(); pause.textContent = '暂停'; } };
  const restart = () => { if (tour.state === 'running' || walker?.moving) emit({ type: 'movementEnded', timestampMs: performance.now() }); tour.restart(); arrived.clear(); exploring = false; planning = false; plannedGoal = null; walker = null; depart.hidden = true; depart.disabled = true; get<HTMLElement>('.destinations').hidden = true; keys.clear(); forest?.resetLook(); forest?.place(0); drawMap(); end.hidden = true; controls.hidden = true; exploration.hidden = true; intro.hidden = false; get<HTMLElement>('#mode').textContent = '路线规划'; };
  get<HTMLButtonElement>('#mode').onclick = () => { planning = !planning; walker?.stop(); plannedGoal = null; depart.disabled = true; depart.hidden = !planning; get<HTMLElement>('.destinations').hidden = !planning; get<HTMLElement>('#mode').textContent = planning ? '自由探索' : '路线规划'; navigationStatus.textContent = planning ? '路线规划 · 在地图或列表选择目的地' : '自由探索 · WASD 行走，地图显示当前位置'; drawMap(); };
  depart.onclick = () => { if (plannedGoal) { goTo(plannedGoal); depart.disabled = true; } };
  map.onclick = event => { if (!planning) return; const point = map.createSVGPoint(); point.x = event.clientX; point.y = event.clientY; const matrix = map.getScreenCTM(); if (matrix) { const p = point.matrixTransform(matrix.inverse()); plan([p.x,0,p.y]); } };
  get<HTMLButtonElement>('#center').onclick = () => forest?.resetLook();
  app.querySelectorAll<HTMLButtonElement>('[data-destination]').forEach(button => { button.onclick = () => { const view = forest?.manifest.viewpoints.find(v => v.id === button.dataset.destination); if (view) plan(view.position); }; });
  const pointerDown = (event: PointerEvent) => { if (suspended || options.hike || !intro.hidden || fixedView) return; drag = { x: event.clientX, y: event.clientY, moved: false }; host.setPointerCapture(event.pointerId); };
  const pointerMove = (event: PointerEvent) => { if (suspended || !drag) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true; forest?.look(dx, dy); drag.x = event.clientX; drag.y = event.clientY; };
  const pointerUp = (event: PointerEvent) => { if (drag && !drag.moved && exploring && planning && forest) { const rect = host.getBoundingClientRect(); const goal = forest.pick((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height); if (goal) plan(goal); } drag = null; };
  const keyDown = (event: KeyboardEvent) => { if (suspended || options.hike || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || !intro.hidden || fixedView) return; const key = event.key.toLowerCase(); if ('wasd'.includes(key) && key.length === 1) { event.preventDefault(); if (!exploring) setExploring(); keys.add(key); } };
  const keyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
  const blur = () => { keys.clear(); drag = null; };
  host.addEventListener('pointerdown', pointerDown); host.addEventListener('pointermove', pointerMove); host.addEventListener('pointerup', pointerUp); host.addEventListener('pointercancel', blur);
  window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', blur);
  get<HTMLButtonElement>('#restart').onclick = restart;
  get<HTMLButtonElement>('#again').onclick = () => { restart(); begin(); };
  get<HTMLButtonElement>('#retry').onclick = () => { restart(); void load(); };
  get<HTMLButtonElement>('#report').onclick = () => {
    const record = {
        version: '场景2.0', source: options.hike ? forest?.scene.userData.hikeSource : exploring ? navigationSource : 'simulated', visualAcceptance: 'not-reviewed', cameraImplemented: options.hike && forest?.scene.userData.hikeSource === 'camera',
        cameraInputConnected: !!attention || (options.hike && forest?.scene.userData.hikeSource === 'camera'),
      weather: weatherSelect.value, audioEnabled: soundsOn, audioVolume:forestVolume(), audioSource: 'local credited forest recordings + original Web Audio weather / HRTF',
      scenery: forest?.scenery(), bodyPosition: forest?.position(), mode: planning ? 'route' : 'free',
      sceneRevision:'forest-weather-ecology-rig-1',ecology:forest?.scene.userData.ecology,wildlife:forest?.scene.userData.wildlife,
      trackStatus:trackStatus.textContent,mapFollow:followMap,
      exploration: exploring, cameraPosition: forest?.camera.position.toArray(), cameraRotation: forest?.camera.rotation.toArray(), walkingDistance: walker?.distance ?? 0,
      browser: navigator.userAgent, gpu, loadedMs, cssViewport: [host.clientWidth, host.clientHeight],
      drawingBuffer: forest ? [forest.renderer.domElement.width, forest.renderer.domElement.height] : null,
      frameTimesMs: frameTimes, renderInfo: forest?.renderer.info.render,
      assets: forest?.manifest, recordedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'focus-hiking-run.json'; link.click(); URL.revokeObjectURL(url);
  };
  get<HTMLButtonElement>('#end-report').onclick = () => get<HTMLButtonElement>('#report').click();
  const resize = () => forest?.resize();
  const suspend = () => { suspended = true; last = 0; keys.clear(); drag = null; cancelAnimationFrame(frame); frame = 0; forest?.mute(true); };
  const resume = () => { if (disposed || document.hidden) return; suspended = false; last = 0; keys.clear(); if (!frame && forest) frame = requestAnimationFrame(render); if (soundWanted) void enableSound(); };
  const visibility = () => { if (document.hidden) suspend(); };
  window.addEventListener('exhibit:pause', suspend);
  window.addEventListener('exhibit:resumed', resume);
  const contextLost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(frame); tour.pause(); error.hidden = false; error.querySelector('p')!.textContent = '图形上下文已丢失，请重新加载。'; };
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visibility);
  host.addEventListener('webglcontextlost', contextLost, true);
  void load();
  const port: ScenePort = {
    subscribeEvents(listener) { sceneListeners.add(listener); return () => { sceneListeners.delete(listener); }; },
    handleCommand() { throw new Error('M1 自动游览尚不支持训练命令；请在 M4 契约审查后接入。'); },
  };
  return { ...port, suspend, resume, dispose() { disposed = true; window.removeEventListener('exhibit:pause', suspend); window.removeEventListener('exhibit:resumed', resume); attempt++; offSamples?.(); offEvents?.(); attention?.setTargets([]); cancelAnimationFrame(frame); forest?.dispose(); sceneListeners.clear(); app.removeEventListener('pointerdown',audioGesture,true);app.removeEventListener('keydown',audioGesture,true);window.removeEventListener('resize', resize); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', visibility); host.removeEventListener('pointerdown', pointerDown); host.removeEventListener('pointermove', pointerMove); host.removeEventListener('pointerup', pointerUp); host.removeEventListener('pointercancel', blur); host.removeEventListener('webglcontextlost', contextLost, true); app.replaceChildren(); } };
}

