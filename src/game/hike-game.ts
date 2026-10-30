import { mountGame } from './app';
import type { ForestView } from '../scene/forest';
import type { AttentionPort, GazeSample } from '../contracts';
import { HikeSession } from '../training/hike-session';
import type { HikeRecord } from '../training/hike-session';
import { HikeArchive, hikeProgress } from '../training/hike-archive';
import './hike.css';
import { gazeFreshMs } from '../attention/sample-timing';

const gazeIssue: Record<string,string> = {
  'fullscreen-required':'已退出全屏 · 请重新校准',
  'not-calibrated':'校准已失效 · 请重新校准',
  'position-unverified':'位置验证尚未解锁 · 请返回选择免测体验',
  'screen-unverified':'屏幕验证尚未解锁 · 请返回选择免测体验',
  'screen-not-calibrated':'缺少屏幕映射 · 请重新校准',
  'screen-uncertain':'眼部已识别 · 屏幕内外尚不能确定',
  'screen-settling':'眼部已识别 · 正在稳定视线',
  'calibration-range':'坐姿超出校准范围 · 请回到原坐姿',
  'eyes-unavailable':'眼部暂不可见 · 请睁眼并调整光照',
  'eyes-disagree':'双眼估计不一致 · 请调整光照或眼镜反光',
  'no-face':'未识别人脸 · 请检查摄像头位置',
  'pose-out-of-range':'头部偏转过大 · 请面向屏幕',
  'face-too-small':'距离摄像头过远 · 请稍靠近',
  'stale-frame':'眼动处理延迟 · 等待新画面',
  'interaction-paused':'眼动交互未启用 · 请重新进入',
  'stopped':'摄像头已停止 · 请重新开启',
};

export const formatTime = (ms: number) => { const s=Math.max(0,Math.floor(ms/1000));return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
const percent = (value:number|null)=>value===null?'—':`${Math.round(value*100)}%`;
export function browserArchive() { return new HikeArchive({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)}); }
export function downloadHikes(records:HikeRecord[]) {
  const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,records},null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='focus-hiking-archive.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function renderArchive(parent:HTMLElement,archive:HikeArchive) {
  const {records,error}=archive.read(),progress=hikeProgress(records);
  parent.replaceChildren();const heading=document.createElement('h2');heading.textContent='我的林间足迹';parent.append(heading);
  const summary=document.createElement('p');summary.textContent=error??`${progress.count} 次真实体验 · 完成 ${progress.completed} 次 · 累计 ${progress.totalMinutes.toFixed(1)} 分钟`;parent.append(summary);
  if(progress.badges.length){const badges=document.createElement('p');badges.className='hike-badges';badges.textContent=progress.badges.join(' · ');parent.append(badges);}
  if(!records.length){const empty=document.createElement('p');empty.textContent=error?'原存档未被修改。':'完成第一段徒步后，这里会留下你的记录。';parent.append(empty);return;}
  const real=records.filter(r=>r.source==='camera'&&r.focusRatio!==null&&r.coverageRatio>=.7&&r.onScreenMs+r.offScreenMs>=60000).slice(-12);
  if(real.length>1){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 360 100');svg.setAttribute('role','img');svg.setAttribute('aria-label','最近最多十二次、有效覆盖足够的屏内保持率趋势。时长不同，不能直接解释为提升。');svg.classList.add('hike-trend');
    svg.innerHTML='<path d="M 10 10 V 90 H 350" fill="none" stroke="#ffffff30"/><polyline fill="none" stroke="#b6cf95" stroke-width="2" points="'+real.map((r,i)=>`${10+i*340/(real.length-1)},${90-r.focusRatio!*80}`).join(' ')+'"/>';
    parent.append(svg);const note=document.createElement('small');note.textContent='屏内保持率趋势 · 不同时长与低覆盖体验不用于提升比较。';parent.append(note);
  }
  const table=document.createElement('table');table.innerHTML='<thead><tr><th>日期</th><th>时长</th><th>屏内</th><th>可判断</th><th>结果</th></tr></thead>';
  const body=document.createElement('tbody');
  for(const r of [...records].reverse()){
    const row=document.createElement('tr');for(const value of [new Date(r.startedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),`${formatTime(r.elapsedMs)} / ${r.plannedMinutes}分`,percent(r.coverageRatio>=.7?r.focusRatio:null),percent(r.coverageRatio),r.source==='simulated'?'模拟检查':r.outcome==='completed'?'已完成':'提前结束']){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}body.append(row);
  }
  table.append(body);const scroll=document.createElement('div');scroll.className='hike-history-scroll';scroll.append(table);parent.append(scroll);
  const exportButton=document.createElement('button');exportButton.textContent='导出全部存档';exportButton.onclick=()=>downloadHikes(records);parent.append(exportButton);
}

interface HikeOptions { minutes:5|10|15; archive?:HikeArchive; source?:'camera'|'simulated'; onExit:()=>void; onRecalibrate:()=>void; isReady?:()=>boolean }
export function mountHikeGame(parent:HTMLElement,attention:AttentionPort,options:HikeOptions) {
  const archive=options.archive??browserArchive();
  let session=new HikeSession(options.minutes,options.source??'camera'),forest:ForestView|null=null,latest:GazeSample|null=null,disposed=false,saved=false,shown=false;
  let weather='clear',nextUi=0,frameSum=0,frameCount=0,qualityAt=0,autoLevel=0;
  let qualityWindow:number[]=[];
  const frameTimes:number[]=[];
  const game=mountGame(parent,undefined,{
    hike:true,
    onReady:view=>{forest=view;view.setWeather('clear');view.scene.userData.hikeSource=options.source??'camera';parent.querySelector('.version')!.textContent=options.source==='simulated'?'simulated · 自动化徒步检查':'眼动徒步 · 秋季森林';},
    onError:message=>{panel.querySelector('p')!.textContent=message;},
    onFrame(view,now,dtMs){
      session.tick(now);
      if(session.phase==='completed'||session.phase==='stopped'){save();showResult();}
      const storm=session.isStorm(now),mode=storm?'cloudy':'clear';
      if(mode!==weather){view.setWeather(mode);weather=mode;(parent.querySelector('#weather') as HTMLSelectElement).value=mode;}
      const direction=session.direction(now),dt=Math.min(Math.max(dtMs,0),80)/1000;
      const before=view.position();
      if(direction&&dt){
        const horizontal=direction.x-.5,turn=Math.abs(horizontal)<.08?0:(horizontal-Math.sign(horizontal)*.08)*1.2;
        const desiredPitch=(.5-direction.y)*.35;
        view.look(turn*dt/.003,(view.camera.rotation.x-desiredPitch)*(1-Math.exp(-4*dt))/.003);
        const rayX=horizontal*2*Math.tan(view.camera.fov*Math.PI/360)*view.camera.aspect,length=Math.hypot(rayX,1);
        view.move(rayX/length*1.15*dt,-1/length*1.15*dt);
      }
      const after=view.position();session.addMovement(Math.hypot(after[0]-before[0],after[2]-before[2]),dtMs);
      if(session.phase==='running'&&dtMs>0&&dtMs<1000){
        frameTimes.push(dtMs);if(frameTimes.length>3600)frameTimes.shift();frameSum+=dtMs;frameCount++;qualityWindow.push(dtMs);
        if(frameSum>=5000){
          const quality=parent.querySelector<HTMLSelectElement>('#quality')!;
          qualityWindow.sort((a,b)=>a-b);const p95=qualityWindow[Math.floor(qualityWindow.length*.95)];
          if(quality.value==='auto'&&now-qualityAt>8000&&(frameCount*1000/frameSum<36||p95>34)&&autoLevel<2){autoLevel++;view.setQuality(autoLevel===1?'adaptive-low':'adaptive-min');qualityAt=now;}
          frameSum=0;frameCount=0;qualityWindow=[];
        }
      }
      if(now>=nextUi){updateUi(now);nextUi=now+150;}
      return !!direction;
    },
  });
  const panel=document.createElement('section');panel.className='hike-begin';panel.innerHTML=`<p class="eyebrow">FOLLOW YOUR GAZE</p><h1>请将视线移回屏幕，<br>画面即将开始。</h1><p>森林准备完成后自动进入，无需再次检测视线。<br>进入后，看向哪里，就朝那个方向慢慢走。</p><output id="hike-begin" role="status" aria-live="polite">正在准备森林…</output><button class="hike-exit">返回首页</button>`;
  const hud=document.createElement('section');hud.className='hike-hud';hud.hidden=true;
  hud.innerHTML='<div class="journey"><strong id="hike-state" role="status" aria-live="polite">等待视线</strong><span id="hike-clock"></span></div><progress id="hike-progress" max="1" value="0" aria-label="徒步时间进度"></progress><div class="hike-buttons"><button id="hike-pause">暂停</button><button id="hike-stop">结束本次徒步</button><button id="hike-calibrate">重新校准</button></div><small>闭眼或信号不清时停步；无法判断的时间单独记录。</small>';
  const marker=document.createElement('div');marker.className='hike-gaze-marker';marker.hidden=true;marker.setAttribute('aria-hidden','true');
  const result=document.createElement('section');result.className='hike-result';result.hidden=true;result.setAttribute('role','dialog');result.setAttribute('aria-modal','true');result.setAttribute('aria-label','徒步结果与存档');
  parent.append(panel,hud,marker,result);
  const get=<T extends HTMLElement>(selector:string)=>parent.querySelector<T>(selector)!;
  const save=()=>{const record=session.summary();if(saved||!record)return;const error=archive.save(record);saved=true;if(error)result.dataset.saveError=error;};
  const setText=(element:HTMLElement,text:string)=>{if(element.textContent!==text)element.textContent=text;};
  function updateUi(now:number){
    if(session.phase==='idle'&&forest&&!document.hidden&&!document.documentElement.dataset.exhibitPaused&&(options.isReady?.()??true)) beginJourney(now);
    const state=session.gazeState(now),paused=session.phase==='paused';
    setText(get('#hike-clock'),`${formatTime(session.elapsedMs)} / ${session.plannedMinutes}:00`);
    get<HTMLProgressElement>('#hike-progress').value=session.elapsedMs/(session.plannedMinutes*60000);
    const issue = !latest || now-latest.timestampMs>gazeFreshMs ? '等待新的摄像头眼动信号 · 停步' : gazeIssue[latest.invalidReason??'']??'暂无法判断视线 · 停步';
    setText(get('#hike-state'),paused?`已暂停 · ${latest?.invalidReason&&gazeIssue[latest.invalidReason] ? gazeIssue[latest.invalidReason] : '点击继续'}`:state==='on-screen'?'目光在森林 · 正在行走':state==='off-screen'?session.isStorm(now)?'视线离屏 · 停步，等待你回来':'视线离屏 · 停步':issue);
    hud.dataset.state=paused?'paused':state;
    marker.hidden=!session.isWalking(now);if(!marker.hidden&&latest){marker.style.left=`${latest.x!*100}%`;marker.style.top=`${latest.y!*100}%`;}
    if(forest){forest.scene.userData.hike={phase:session.phase,state,elapsedMs:session.elapsedMs,onScreenMs:session.onScreenMs,offScreenMs:session.offScreenMs,unknownMs:session.unknownMs,departures:session.departures,weather,body:forest.position(),source:options.source??'camera',autoLevel};}
  }
  function showResult(){
    if(shown)return;const record=session.summary();if(!record)return;shown=true;hud.hidden=true;marker.hidden=true;result.hidden=false;
    for(const child of parent.children)if(child instanceof HTMLElement)child.inert=child!==result;
    const progress=hikeProgress(archive.read().records,record);
    result.innerHTML=`<p class="eyebrow">YOUR FOREST WALK</p><h2>${record.outcome==='completed'?'这一段，走完了。':'这一段，也留下了足迹。'}</h2><p class="hike-save-status"></p><div class="hike-stats"><div><strong>${formatTime(record.elapsedMs)}</strong><span>本次徒步</span></div><div><strong>${percent(record.coverageRatio>=.7?record.focusRatio:null)}</strong><span>屏内保持率</span></div><div><strong>${record.distanceM.toFixed(1)} m</strong><span>实际行走</span></div></div><p>可判断时间覆盖 ${percent(record.coverageRatio)} · 无法判断 ${formatTime(record.unknownMs)}，不算离屏。<br>离屏 ${record.departures} 次 · 恢复 ${record.recoveries} 次</p><p class="hike-change"></p><p class="hike-badges"></p><p class="hike-note">屏内保持率只反映本次可判断的注视行为。低覆盖时隐藏比例；历次比较需要相同时长、足够有效数据。</p><fieldset class="hike-duration"><legend>下一段徒步</legend>${[5,10,15].map(m=>`<label><input type="radio" name="next-duration" value="${m}" ${m===record.plannedMinutes?'checked':''}>${m} 分钟</label>`).join('')}</fieldset><div class="hike-buttons"><button class="primary" id="hike-again">再走一段</button><button id="hike-download">下载本次记录</button><button class="hike-exit">返回首页并关闭摄像头</button></div><details><summary>所有体验记录</summary><div class="hike-archive"></div></details>`;
    get('.hike-save-status').textContent=result.dataset.saveError??(record.source==='simulated'?'simulated · 自动化检查记录，不计入真实成就。':'已保存到本浏览器。');
    get('.hike-change').textContent=progress.change===null?'更多同等条件的体验后，可以查看保持率变化。':`相对上次同等时长体验，屏内保持率 ${progress.change>=0?'增加':'减少'} ${Math.abs(progress.change*100).toFixed(1)} 个百分点。`;
    get('.hike-badges').textContent=progress.badges.join(' · ');
    renderArchive(get('.hike-archive'),archive);
    get('#hike-download').onclick=()=>downloadHikes([record]);
    get('#hike-again').onclick=()=>{const minutes=Number(parent.querySelector<HTMLInputElement>('input[name="next-duration"]:checked')!.value) as 5|10|15;session=new HikeSession(minutes,options.source??'camera');saved=false;shown=false;for(const child of parent.children)if(child instanceof HTMLElement)child.inert=false;result.hidden=true;panel.hidden=false;get('#hike-pause').textContent='暂停';panel.querySelector('h1')!.textContent='请将视线移回屏幕，画面即将开始。';nextUi=0;};
    get('.hike-result .hike-exit').onclick=options.onExit;
    get<HTMLButtonElement>('#hike-again').focus();
  }
  const off=attention.subscribeSamples(sample=>{
    latest={...sample};const now=performance.now();
    if(['not-calibrated','fullscreen-required','position-unverified','screen-unverified'].includes(sample.invalidReason??'')){session.pause(now);get('#hike-pause').textContent='继续';}
    else session.accept(sample,now);
  });
  function beginJourney(now:number) {
    if(!forest||disposed||session.phase!=='idle'||document.hidden)return;
    session.start(now);if(latest)session.accept(latest,now);panel.hidden=true;hud.hidden=false;nextUi=0;
    const sound=get<HTMLButtonElement>('#storm-sound');if(sound.getAttribute('aria-pressed')!=='true')sound.click();
  }
  get('.hike-begin .hike-exit').onclick=options.onExit;
  get('#hike-stop').onclick=()=>{session.stop(performance.now());save();forest?.setWeather('clear');weather='clear';get<HTMLSelectElement>('#weather').value='clear';showResult();};
  get('#hike-pause').onclick=()=>{if(session.phase==='running'){session.pause(performance.now());get('#hike-pause').textContent='继续';}else if(session.phase==='paused'&&(options.isReady?.()??true)){const now=performance.now();session.resume(now);if(latest)session.accept(latest,now);get('#hike-pause').textContent='暂停';}nextUi=0;};
  get('#hike-calibrate').onclick=options.onRecalibrate;
  let exhibitSuspended=false, wasRunning=false;
  const suspendExhibit=()=>{if(exhibitSuspended)return;exhibitSuspended=true;wasRunning=session.phase==='running';session.pause(performance.now());get('#hike-pause').textContent='继续';};
  const resumeExhibit=()=>{if(!exhibitSuspended||!(options.isReady?.()??true))return;exhibitSuspended=false;if(wasRunning){session.resume(performance.now());get('#hike-pause').textContent='暂停';}latest=null;nextUi=0;};
  const pauseForBackground=()=>{if(document.hidden)suspendExhibit();};
  const pagehide=(event:PageTransitionEvent)=>{if(!event.persisted){session.stop(performance.now());save();}};
  window.addEventListener('exhibit:before-pause',suspendExhibit);window.addEventListener('exhibit:pause',suspendExhibit);window.addEventListener('exhibit:resumed',resumeExhibit);
  document.addEventListener('visibilitychange',pauseForBackground);window.addEventListener('pagehide',pagehide);
  const modalKeys=(event:KeyboardEvent)=>{if(result.hidden||event.key!=='Tab')return;const controls=[...result.querySelectorAll<HTMLElement>('button:not([disabled]),input,a[href],summary')].filter(el=>el.offsetParent!==null);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
  parent.addEventListener('keydown',modalKeys);
  return {get session(){return session;},get forest(){return forest;},frameTimes, suspend:suspendExhibit, resume:resumeExhibit,
    dispose(){if(disposed)return;disposed=true;window.removeEventListener('exhibit:before-pause',suspendExhibit);window.removeEventListener('exhibit:pause',suspendExhibit);window.removeEventListener('exhibit:resumed',resumeExhibit);session.stop(performance.now());save();off();document.removeEventListener('visibilitychange',pauseForBackground);window.removeEventListener('pagehide',pagehide);parent.removeEventListener('keydown',modalKeys);game.dispose();},
  };
}
