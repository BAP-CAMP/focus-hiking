/* Collective entry chrome. Each app owns its pause/resume implementation. */
(() => {
 const root=new URL('.',document.currentScript.src), meta={"title": "此刻山间", "slug": "focus-hiking", "upstream": "https://github.com/llllllir/focus-hiking", "fork": "https://github.com/BAP-CAMP/focus-hiking", "base": "69400dbb391cc91b4f702773d3b6d66f2797940d", "authors": ["llllllir", "RUI-TW"], "device": "摄像头体验需要电脑、摄像头和 HTTPS。", "note": "注视与登山交互演示，不代表注意力训练效果。", "adoptedBranch": "codex/m3-attention-calibration-fix", "repositoryVisibility": "public", "team": "山间野人小组", "attributionType": "Camp001 参赛小组"};

 let ready=false, seen=!document.hidden, paused=document.hidden, reason='background', operation=0, restoring=false, focusBefore=null;
 if(document.hidden)document.documentElement.dataset.exhibitPaused='true';
 const style=document.createElement('style');style.textContent=`
 .exhibit-nav{position:fixed;z-index:10000;right:12px;bottom:12px;display:flex;gap:12px;align-items:center;background:#151816;color:#f5f5f1;padding:10px 16px;border:1px solid #647068;border-radius:6px;font:14px/1.4 system-ui;max-width:calc(100vw - 24px);box-sizing:border-box;flex-wrap:wrap}
 .exhibit-nav a,.exhibit-status a{color:inherit;text-decoration:none}.exhibit-nav button,.exhibit-status button{font:inherit;color:inherit;cursor:pointer;border:1px solid #a7b8ad;border-radius:4px;background:#263a30;padding:6px 12px}.exhibit-nav button:disabled,.exhibit-status button:disabled{opacity:.6;cursor:wait}
 .exhibit-nav :focus-visible,.exhibit-status :focus-visible{outline:3px solid #abcbd2;outline-offset:3px}
 .exhibit-status{position:fixed;z-index:10001;bottom:76px;right:12px;max-width:min(640px,calc(100vw - 24px));box-sizing:border-box;display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;color:#f5f5f1;background:#202b27;border:1px solid #82988b;border-radius:8px;font:14px/1.5 system-ui;box-shadow:0 3px 16px #0003}
 .exhibit-status[hidden]{display:none!important}.exhibit-status p{margin:0;flex:1 1 180px;overflow-wrap:anywhere}.exhibit-status a{padding:6px}.exhibit-nav button{background:transparent}
 @media(max-width:600px){.exhibit-nav{font-size:12px;gap:8px;bottom:6px;right:6px;padding:8px;max-width:calc(100vw - 12px)}.exhibit-status{bottom:66px;right:6px;max-width:calc(100vw - 12px);padding:10px;font-size:13px}}
 `;document.head.append(style);
 const nav=document.createElement('nav');nav.className='exhibit-nav';nav.setAttribute('aria-label','作品导航');
 const back=document.createElement('a');back.href='/practices/collective/';back.textContent='返回 Collective';
 const about=document.createElement('a');about.href=new URL('about.html',root);about.textContent='作者：'+meta.team;about.setAttribute('aria-label',meta.team+'，查看原作与说明');
 const pauseButton=document.createElement('button');pauseButton.type='button';pauseButton.textContent='正在加载';pauseButton.disabled=true;nav.append(back,about,pauseButton);document.body.append(nav);
 if(meta.slug==='elder-protecter'&&matchMedia('(max-width:700px)').matches){
  const hint=document.createElement('aside');hint.style.cssText='position:fixed;inset:20% 20px auto;z-index:15000;padding:24px;background:#f4f5ef;color:#173a3d;border:1px solid #78999b;border-radius:12px;font:17px/1.6 system-ui;box-shadow:0 12px 100px #0009';
  hint.innerHTML='<h2>在大屏上体验居家场景</h2><p>完整操作建议使用电脑或平板。手机可浏览预览，控制台和家属界面需要更宽的屏幕。</p><button type="button" style="padding:10px 18px;font:inherit">继续查看预览</button>';hint.querySelector('button').onclick=()=>hint.remove();document.body.append(hint);
 }
 const bar=document.createElement('section');bar.className='exhibit-status';bar.hidden=true;bar.setAttribute('aria-label','体验状态');
 bar.innerHTML='<p role="status" aria-live="polite" aria-atomic="true"></p><button type="button">继续体验</button><a href="/practices/collective/">返回 Collective</a>';document.body.append(bar);
 const message=bar.querySelector('p'),button=bar.querySelector('button');
 const state=value=>{document.documentElement.dataset.exhibitState=value;};state('loading');
 function announce(){bar.hidden=!seen;pauseButton.hidden=true;message.textContent=reason==='manual'?'已暂停，画面与进度已保留。':'页面切换后已暂停，画面与进度已保留。';button.textContent=document.documentElement.dataset.exhibitCamera==='true'?'重新启用摄像头并继续':'继续体验';button.disabled=!ready;pauseButton.textContent='继续体验';}
 function pause(cause='background'){
  if(paused&&!restoring)return;
  operation++;restoring=false;focusBefore=document.activeElement;paused=true;reason=cause;
  document.documentElement.dataset.exhibitPaused='true';
  window.dispatchEvent(new CustomEvent('exhibit:before-pause',{detail:{reason:cause}}));
  window.dispatchEvent(new CustomEvent('exhibit:pause',{detail:{reason:cause}}));
  document.querySelectorAll('video,audio').forEach(m=>m.pause());window.speechSynthesis?.cancel();state(ready?'paused':'loading');announce();
 }
 async function resume(initial=false){
  if(document.hidden||restoring||!ready||!paused)return;
  const restoreFocus=document.activeElement===button||document.activeElement===pauseButton;
  const id=++operation;restoring=true;button.disabled=true;pauseButton.disabled=true;state('resuming');message.textContent='正在恢复…';
  const tasks=[];delete document.documentElement.dataset.exhibitPaused;
  try{
   window.dispatchEvent(new CustomEvent('exhibit:resume',{detail:{initial,waitUntil:promise=>tasks.push(Promise.resolve(promise))}}));
   await Promise.all(tasks);
   if(id!==operation||document.hidden)return;
   paused=false;restoring=false;bar.hidden=true;pauseButton.hidden=false;state('ready');
   window.dispatchEvent(new Event('exhibit:resumed'));
   if(!initial&&restoreFocus&&(document.activeElement===document.body||document.activeElement===button||document.activeElement===pauseButton)) (focusBefore?.isConnected&&focusBefore!==document.body?focusBefore:pauseButton).focus({preventScroll:true});
  }catch(error){
   if(id!==operation)return;
   restoring=false;document.documentElement.dataset.exhibitPaused='true';window.dispatchEvent(new Event('exhibit:pause'));state('error');bar.hidden=false;message.textContent='恢复未完成：'+(error?.message||'请重试');button.textContent='重试继续';
  }finally{if(id===operation){button.disabled=false;pauseButton.disabled=false;pauseButton.textContent=paused?'继续体验':'暂停体验';}}
 }
 pauseButton.onclick=()=>paused?resume():pause('manual');button.onclick=()=>resume();
 const markReady=()=>{ready=true;pauseButton.disabled=false;pauseButton.textContent=paused?'继续体验':'暂停体验';state(paused?'paused':'ready');if(paused){announce();if(!seen&&!document.hidden){seen=true;void resume(true);}}};
 addEventListener('exhibit:ready',markReady);if(document.documentElement.dataset.exhibitReady)markReady();
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden)pause();
  else if(!seen){if(!ready)return;seen=true;if(paused)void resume(true);else{delete document.documentElement.dataset.exhibitPaused;}}
  else if(paused)announce();
 });
 addEventListener('pagehide',()=>pause());
 addEventListener('pageshow',e=>{if(e.persisted&&paused)announce();});
})();
