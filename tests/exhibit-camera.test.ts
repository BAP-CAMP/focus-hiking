import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraAttention } from '../src/attention/camera';

// Synthetic devices and worker responses: no real camera or eye-accuracy acceptance.
const win=new EventTarget(),doc=Object.assign(new EventTarget(),{hidden:false,fullscreenElement:{},documentElement:{dataset:{} as Record<string,string>,requestFullscreen:async()=>{}},createElement:()=>({muted:false,playsInline:false,srcObject:null,readyState:2,currentTime:0,videoWidth:640,videoHeight:480,play:async()=>{},pause(){}})});
Object.assign(globalThis,{location:{href:'https://camera-test.invalid/'},window:win,document:doc,innerWidth:1440,innerHeight:1000,devicePixelRatio:1,screen:{width:1440,height:1000}});
let requests=0,stops=0,terminations=0,deny=false,device='test-camera',pending:((s:any)=>void)|null=null,delay=false;
const stream=()=>({getTracks:()=>[{stop(){stops++;}}],getVideoTracks:()=>[{getSettings:()=>({width:640,height:480,deviceId:device,frameRate:30}),addEventListener(){}}]});
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:async()=>{requests++;if(deny)throw new DOMException('Permission denied','NotAllowedError');if(delay)return new Promise(resolve=>{pending=resolve;});return stream();}}},configurable:true});
Object.defineProperty(globalThis,'Worker',{value:class {onmessage:((e:any)=>void)|null=null;onerror=null;postMessage(m:any){if(m.type==='init')queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));}terminate(){terminations++;}},configurable:true});
const pause=()=>win.dispatchEvent(new Event('exhibit:pause'));
async function resume(){const jobs:Promise<void>[]=[];win.dispatchEvent(new CustomEvent('exhibit:resume',{detail:{waitUntil:(p:Promise<void>)=>jobs.push(p)}}));await Promise.all(jobs);}
test('camera release, explicit restore, denied permission, changed environment and cancelled acquisition',async()=>{
 const camera=new CameraAttention();await camera.start();camera.allowBasicEntry();const first=requests;pause();assert(!camera.running);assert(stops>0&&terminations>0);doc.dispatchEvent(new Event('visibilitychange'));assert.equal(requests,first);
 await resume();assert(camera.interactionReady);assert.equal(requests,first+1);
 pause();deny=true;await assert.rejects(resume(),/Permission denied/);assert(!camera.running);deny=false;await resume();assert(camera.interactionReady);
 pause();device='changed-camera';let recalibrate=false;const restored=(e:Event)=>{recalibrate=(e as CustomEvent).detail.recalibrate;};win.addEventListener('exhibit:camera-restored',restored);await resume();assert(recalibrate);assert(!camera.interactionReady);camera.allowBasicEntry();
 pause();delay=true;const restoring=resume();await new Promise(r=>setTimeout(r,0));const before=stops;pause();pending!(stream());await restoring;assert(stops>before);assert(!camera.running);delay=false;
 camera.dispose();win.removeEventListener('exhibit:camera-restored',restored);const after=requests;await resume();assert.equal(requests,after);
});
