import test from 'node:test';
import assert from 'node:assert/strict';
import { HikeSession } from '../src/training/hike-session';
import { HikeArchive, hikeProgress } from '../src/training/hike-archive';
import type { GazeSample } from '../src/contracts';
const sample=(t:number,state:'inside'|'outside'|'invalid',source:GazeSample['source']='camera'):GazeSample=>({timestampMs:t,x:state==='inside'?.7:null,y:state==='inside'?.5:null,valid:state==='inside',invalidReason:state==='outside'?'off-screen':state==='invalid'?'eyes-unavailable':null,source});
function session(){const h=new HikeSession(5,'simulated','unit-fixture');h.start(0,'2026-10-03T00:00:00Z');return h;}
test('camera-accepted 300ms delayed samples drive hiking, but expire at 500ms and invalid signals stop immediately',()=>{
 const h=session();h.accept(sample(0,'inside'),300);assert.equal(h.isWalking(300),true);
 assert.equal(h.isWalking(500),true);assert.equal(h.isWalking(501),false);
 h.accept(sample(600,'inside'),900);assert.equal(h.isWalking(900),true);
 h.accept(sample(901,'invalid'),901);assert.equal(h.isWalking(901),false);assert.equal(h.departures,0);
 h.accept(sample(1000,'inside'),1501);assert.equal(h.isWalking(1501),false);
});
test('timed gaze hiking starts only once and rejects unsupported durations',()=>{const h=session();assert.equal(h.start(1),false);assert.throws(()=>new HikeSession(6 as 5));assert.equal(h.remainingMs,300000);});
test('on-screen camera moves; stable off-screen stops and feedback lasts at most 30 seconds',()=>{
 const h=session();h.accept(sample(0,'inside'),0);assert.equal(h.isWalking(1),true);h.accept(sample(100,'outside'),100);assert.equal(h.isWalking(100),false);assert.equal(h.isStorm(100),true);
 for(let t=200;t<=31000;t+=100)h.accept(sample(t,'outside'),t);
 assert.equal(h.isStorm(30100),false);assert.equal(h.isWalking(31000),false);assert.equal(h.departures,1);
 h.accept(sample(31100,'inside'),31100);assert.equal(h.isStorm(31100),false);assert.equal(h.isWalking(31100),true);assert.equal(h.recoveries,1);
});
test('returning before 30 seconds immediately restores sunshine and walking',()=>{const h=session();h.accept(sample(0,'outside'),0);h.accept(sample(100,'inside'),100);assert.equal(h.isStorm(100),false);assert.equal(h.isWalking(100),true);});
test('a camera gap during verified absence cannot flicker or restart its weather deadline',()=>{const h=session();h.accept(sample(0,'outside'),0);h.accept(sample(100,'invalid'),100);assert.equal(h.isStorm(1000),true);assert.equal(h.departures,1);assert.equal(h.isWalking(1000),false);assert.equal(h.isStorm(30000),false);h.accept(sample(30100,'outside'),30100);assert.equal(h.departures,1);assert.equal(h.isStorm(30100),false);});
test('blink, camera failure, simulated samples and stale coordinates never trigger distraction or motion',()=>{
 const h=session();for(let t=0;t<=1000;t+=100)h.accept(sample(t,'invalid'),t);assert.equal(h.departures,0);assert.equal(h.isStorm(1000),false);
 h.accept(sample(1100,'inside','simulated'),1100);assert.equal(h.isWalking(1100),false);
 h.accept(sample(1200,'inside'),1200);assert.equal(h.isWalking(1701),false);h.tick(2200);const r=h.stop(2200)!;
 assert.equal(r.onScreenMs,500);assert.equal(r.offScreenMs,0);assert.equal(r.unknownMs,1700);assert.equal(r.focusRatio,1);assert.ok(r.coverageRatio<.25);
});
test('out-of-order, future and malformed samples do not replace fresh valid camera data',()=>{
 const h=session();h.accept(sample(100,'inside'),100);h.accept(sample(99,'outside'),101);h.accept(sample(200,'outside'),102);assert.equal(h.departures,0);assert.equal(h.isWalking(102),true);
 h.accept({...sample(103,'inside'),x:NaN},103);assert.equal(h.isWalking(103),false);assert.equal(h.departures,0);
});
test('pause and background gaps exclude elapsed time and resume needs a fresh frame',()=>{const h=session();h.accept(sample(0,'inside'),0);h.pause(100);h.tick(60000);assert.equal(h.elapsedMs,100);h.resume(60000);assert.equal(h.isWalking(60000),false);h.accept(sample(60000,'inside'),60000);h.tick(60100);assert.equal(h.elapsedMs,200);assert.equal(h.onScreenMs,200);});
test('5, 10 and 15 minute journeys complete exactly once, and early stop remains stopped',()=>{
 for(const minutes of [5,10,15] as const){const h=new HikeSession(minutes,'simulated',`fixture-${minutes}`);h.start(0);h.tick(minutes*60000+50);assert.equal(h.phase,'completed');assert.equal(h.summary()!.elapsedMs,minutes*60000);assert.deepEqual(h.stop(minutes*60000+100),h.summary());}
 const h=session();h.tick(120);const r=h.stop(120);h.tick(300000);assert.equal(h.phase,'stopped');assert.deepEqual(h.stop(300000),r);
});
test('archive survives reload, deduplicates end events, preserves corrupt data and reports quota errors',()=>{
 let value:string|null=null;const storage={getItem:()=>value,setItem:(_k:string,v:string)=>{value=v;}};const h=session();h.accept(sample(0,'inside'),0);const r=h.stop(100)!;
 const archive=new HikeArchive(storage);assert.equal(archive.save(r),null);assert.equal(archive.save(r),null);assert.equal(new HikeArchive(storage).read().records.length,1);
 assert.ok(!value!.includes('timestampMs'));value='damaged';assert.ok(archive.save(r));assert.equal(value,'damaged');
 assert.ok(new HikeArchive({getItem:()=>null,setItem:()=>{throw new Error('quota');}}).save(r));
});
test('progress never treats synthetic fixtures or low-coverage sessions as measured improvement',()=>{
 const h=session();const r=h.stop(100)!;assert.equal(hikeProgress([r]).count,0);
 const good={...r,source:'camera' as const,id:'a',elapsedMs:60000,onScreenMs:48000,offScreenMs:12000,unknownMs:0,coverageRatio:1,focusRatio:.8};
 const current={...good,id:'b',onScreenMs:54000,offScreenMs:6000,focusRatio:.9};assert.ok(Math.abs(hikeProgress([good],current).change!-.1)<1e-8);
 assert.equal(hikeProgress([good],{...current,coverageRatio:.1}).change,null);assert.equal(hikeProgress([good],{...current,plannedMinutes:10}).change,null);
});

test('background time does not consume remaining weather feedback',()=>{const h=session();h.accept(sample(0,'outside'),0);h.pause(1000);assert(h.isStorm(100000));h.resume(100000);assert(h.isStorm(128999));assert(!h.isStorm(129000));assert.equal(h.elapsedMs,1000);});
