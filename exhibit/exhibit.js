/* Collective entry chrome. Each app owns its pause/resume implementation. */
(() => {
 const root=new URL('.',document.currentScript.src), meta={"title": "此刻山间", "slug": "focus-hiking", "upstream": "https://github.com/llllllir/focus-hiking", "fork": "https://github.com/BAP-CAMP/focus-hiking", "base": "69400dbb391cc91b4f702773d3b6d66f2797940d", "authors": ["llllllir", "RUI-TW"], "device": "摄像头体验需要电脑、摄像头和 HTTPS。", "note": "注视与登山交互演示，不代表注意力训练效果。", "adoptedBranch": "codex/m3-attention-calibration-fix", "repositoryVisibility": "public", "team": "山间野人小组", "attributionType": "Camp001 参赛小组"};
 let paused=false;
 const style=document.createElement('style');style.textContent=`
 .exhibit-nav{position:fixed;z-index:10000;right:12px;bottom:12px;display:flex;gap:12px;align-items:center;background:#151816;color:#f5f5f1;padding:10px 16px;border:1px solid #647068;border-radius:6px;font:14px/1.4 system-ui;box-shadow:0 2px 16px #0003}
 .exhibit-nav a{color:inherit;text-decoration:none}.exhibit-nav a:focus-visible,.exhibit-nav button:focus-visible{outline:3px solid #abcbd2;outline-offset:3px}
 .exhibit-nav button{font:inherit;background:none;border:0;color:inherit;cursor:pointer;padding:0}
 .exhibit-overlay{position:fixed;inset:0;z-index:20000;background:#101715dd;display:grid;place-items:center;padding:24px;color:#fff;font:17px/1.6 system-ui}.exhibit-overlay[hidden]{display:none}
 .exhibit-panel{max-width:540px;background:#202b27;border:1px solid #63776e;border-radius:12px;padding:32px}.exhibit-panel button,.exhibit-panel a{font:inherit;display:inline-block;margin:8px 10px 0 0;background:#eaf0ec;color:#19261e;padding:10px 20px;border:0;border-radius:4px;cursor:pointer;text-decoration:none}
 @media(max-width:600px){.exhibit-nav{font-size:12px;gap:10px;bottom:6px;right:6px}.exhibit-panel{padding:20px}}
 `;document.head.append(style);
 const nav=document.createElement('nav');nav.className='exhibit-nav';nav.setAttribute('aria-label','作品导航');
 const back=document.createElement('a');back.href='/practices/collective/';back.textContent='返回 Collective';
 const about=document.createElement('a');about.href=new URL('about.html',root);about.textContent='作者：'+meta.team;about.setAttribute('aria-label',meta.team+'，查看原作与说明');
 const pauseButton=document.createElement('button');pauseButton.textContent='暂停体验';nav.append(back,about,pauseButton);document.body.append(nav);
 if(meta.slug==='elder-protecter'&&matchMedia('(max-width:700px)').matches){
  const hint=document.createElement('aside');hint.style.cssText='position:fixed;inset:20% 20px auto;z-index:15000;padding:24px;background:#f4f5ef;color:#173a3d;border:1px solid #78999b;border-radius:12px;font:17px/1.6 system-ui;box-shadow:0 12px 100px #0009';
  hint.innerHTML='<h2>在大屏上体验居家场景</h2><p>完整操作建议使用电脑或平板。手机可浏览预览，控制台和家属界面需要更宽的屏幕。</p><button type="button" style="padding:10px 18px;font:inherit">继续查看预览</button>';hint.querySelector('button').onclick=()=>hint.remove();document.body.append(hint);
 }
 const overlay=document.createElement('section');overlay.className='exhibit-overlay';overlay.hidden=true;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','体验已暂停');
 overlay.innerHTML='<div class="exhibit-panel"><h2>体验已暂停</h2><p>切换页面后已停止动态展示。点击继续，由你决定何时重新开始。</p><button type="button">继续体验</button><a href="/practices/collective/">返回 Collective</a></div>';document.body.append(overlay);
 if(meta.slug==='focus-hiking')overlay.querySelector('p').textContent='摄像头和声音已释放。继续后回到入口，可重新选择眼动体验或鼠标与键盘漫步。';
 function pause(){if(paused)return;paused=true;document.documentElement.dataset.exhibitPaused='true';window.dispatchEvent(new Event('exhibit:pause'));document.querySelectorAll('video,audio').forEach(m=>m.pause());window.speechSynthesis?.cancel();overlay.hidden=false;if(!document.hidden)overlay.querySelector('button').focus();}
 function resume(){if(document.hidden)return;paused=false;delete document.documentElement.dataset.exhibitPaused;overlay.hidden=true;window.dispatchEvent(new Event('exhibit:resume'));pauseButton.focus();}
 pauseButton.onclick=pause;overlay.querySelector('button').onclick=resume;
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else if(paused)overlay.querySelector('button').focus();});
 addEventListener('pagehide',pause);
 addEventListener('keydown',e=>{if(!paused)return;if(e.key==='Escape'){e.preventDefault();return;}if(e.key==='Tab'){const items=[...overlay.querySelectorAll('button,a')],first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
})();
