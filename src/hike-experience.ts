import { mountGazeTest } from './attention/test-page';
import { CameraAttention } from './attention/camera';
import { browserEnvironments, quickEntryKind, sameEnvironment } from './attention/environment';
import { browserArchive, renderArchive, mountHikeGame } from './game/hike-game';
import './mountains-home.css';
import { sitePath } from './site-path';
import { retainForestAudio, unlockForestAudio } from './scene/audio-context';

/** Page composition; environment storage and camera parameters stay in A's module. */
export function mountHikeExperience(parent: HTMLElement) {
  const releaseAudio = retainForestAudio();
  const unlockAudio = (event: Event) => { if (event.isTrusted) void unlockForestAudio().catch(() => {}); };
  parent.addEventListener('pointerdown', unlockAudio, true);
  parent.addEventListener('keydown', unlockAudio, true);
  const archive = browserArchive(), environments = browserEnvironments();
  let disposed = false, setupDispose: (() => void) | null = null, gameDispose: (() => void) | null = null, entering = false, epoch = 0;
  let minutes: 5 | 10 | 15 = 5;
  let selectedId = environments.list()[0]?.id ?? environments.create('我的常用环境').id;
  const clear = () => { epoch++; gameDispose?.(); gameDispose = null; setupDispose?.(); setupDispose = null; };
  const home = () => {
    if (disposed) return;
    clear(); document.title = '此刻山间 · Here in the Mountains';
    parent.innerHTML = `<main class="hike-landing mountains-home">
      <section class="hike-home-copy"><a class="brand" href="${sitePath()}">此刻山间<span>Here in the Mountains</span></a>
        <p class="eyebrow">A MOMENT TO WANDER. A PLACE TO BE.</p><h1>目光慢下来，<br>此刻在山间。</h1>
        <p>把片刻留给自己，把目光交给山林。<br>沿着视线缓缓前行，在一段安静的山路上，回到此刻。</p>
        <fieldset class="hike-duration"><legend>给自己留一点时间</legend>${[5, 10, 15].map(m => `<label><input type="radio" name="duration" value="${m}" ${m === minutes ? 'checked' : ''}>${m} 分钟</label>`).join('')}</fieldset>
        <label class="environment-select">本次使用的环境<select id="environment-select" aria-label="本次使用的环境"></select></label>
        <button class="primary" id="hike-setup">校准并开始</button>
        <p class="hike-note">完整体验请使用电脑。注视交互需要摄像头与 HTTPS；仅在本机处理图像，不上传、不保存。<br>也可选择下方鼠标与键盘模式。</p>
        <a class="mountains-explore" href="${sitePath('?mode=explore')}">暂不开摄像头，用鼠标与键盘漫步</a>
        <details><summary>我的徒步记录</summary><div class="hike-home-archive"></div></details>
      </section>
      <section class="environment-panel" aria-labelledby="environment-title"><p class="eyebrow">YOUR FAMILIAR PLACE</p><h2 id="environment-title">从熟悉的环境出发</h2>
        <p>使用同一台电脑与摄像头，保持原来的坐姿、屏幕位置和光照。点击存档即可加载，不再重复眼动测试。</p>
        <div id="environment-list"></div>
        <form id="environment-create"><label for="environment-name">新环境名称</label><div><input id="environment-name" maxlength="40" placeholder="例如：书桌 · 日间" required><button type="submit">新建环境</button></div></form>
        <p class="environment-privacy">仅在本浏览器保存校准参数与测试次数，不保存摄像头图像。直接进入仍需允许摄像头，用于实时眼动交互。</p>
        <p id="environment-message" role="status"></p><button id="environment-clear" type="button">清除全部环境存档</button>
      </section></main>`;
    renderArchive(parent.querySelector<HTMLElement>('.hike-home-archive')!, archive);
    const status = parent.querySelector<HTMLElement>('#environment-message')!;
    const select = parent.querySelector<HTMLSelectElement>('#environment-select')!;
    const refresh = () => {
      const profiles = environments.list();
      if (!profiles.some(p => p.id === selectedId)) selectedId = profiles[0]?.id ?? '';
      select.replaceChildren(...profiles.map(p => { const option = document.createElement('option'); option.value = p.id; option.textContent = p.name; return option; })); select.value = selectedId;
      parent.querySelector<HTMLButtonElement>('#hike-setup')!.disabled = !selectedId;
      const list = parent.querySelector<HTMLElement>('#environment-list')!; list.replaceChildren();
      for (const profile of profiles) {
        const card = document.createElement('article'); card.className = 'environment-card'; card.dataset.environmentId = profile.id;
        const title = document.createElement('h3'); title.textContent = profile.name;
        const detail = document.createElement('p'), kind = quickEntryKind(profile);
        detail.textContent = kind === 'saved' ? `已通过验证 · ${profile.savedAt ? new Date(profile.savedAt).toLocaleDateString() : ''} 保存` : kind === 'retry' ? `已测试 ${profile.attempts} 次 · 可免测体验，精度未达标` : `已测试 ${profile.attempts} / 3 次 · 验证通过后可保存成功档案`;
        const row = document.createElement('div'); row.className = 'environment-actions';
        const enter = document.createElement('button'); enter.className = 'environment-enter'; enter.disabled = !kind;
        enter.textContent = kind === 'saved' ? '同一环境，直接进入' : kind === 'retry' ? '不再测试，直接体验' : '等待首次测试';
        enter.onclick = () => { selectedId = profile.id; readMinutes(); setup(true); };
        const remove = document.createElement('button'); remove.className = 'environment-delete'; remove.textContent = '删除'; remove.setAttribute('aria-label', `删除环境 ${profile.name}`);
        remove.onclick = () => { environments.remove(profile.id); refresh(); };
        row.append(enter, remove); card.append(title, detail, row); list.append(card);
      }
      status.textContent = environments.warning;
    };
    const readMinutes = () => { minutes = Number(parent.querySelector<HTMLInputElement>('input[name="duration"]:checked')!.value) as 5 | 10 | 15; };
    select.onchange = () => { selectedId = select.value; };
    parent.querySelector<HTMLButtonElement>('#hike-setup')!.onclick = () => { readMinutes(); setup(); };
    parent.querySelector<HTMLFormElement>('#environment-create')!.onsubmit = event => {
      event.preventDefault(); const input = parent.querySelector<HTMLInputElement>('#environment-name')!;
      try { selectedId = environments.create(input.value).id; input.value = ''; refresh(); } catch (error) { status.textContent = error instanceof Error ? error.message : '无法新建环境'; }
    };
    parent.querySelector<HTMLButtonElement>('#environment-clear')!.onclick = () => {
      if (window.confirm('清除本浏览器的全部环境校准存档和测试次数？徒步记录不会删除。')) { environments.clear(); refresh(); }
    };
    refresh();
  };
  const setup = (quick = false) => {
    clear(); const operation = epoch;
    const calibration = document.createElement('div'), scene = document.createElement('div');
    calibration.className = 'gaze-session-layer'; scene.className = 'gaze-session-layer gaze-scene-root'; scene.hidden = true; parent.replaceChildren(calibration, scene);
    const enter = (camera: CameraAttention) => {
      if (entering || disposed || operation !== epoch || !camera.interactionReady) return;
      entering = true;
      try {
        calibration.hidden = true; scene.hidden = false;
        const game = mountHikeGame(scene, camera, { minutes, archive, isReady: () => camera.interactionReady, onExit: home, onRecalibrate: () => {
          if (quick) { setup(); return; }
          gameDispose?.(); gameDispose = null; camera.setInteractionEnabled(false); scene.hidden = true; calibration.hidden = false;
        } });
        if (camera.unverifiedEntry || quick) { const note = document.createElement('p'); note.className = 'gaze-unverified-notice'; note.textContent = camera.unverifiedEntry ? '免测体验 · 尚未通过精度验证，方向与离屏判断可能不准。' : '已加载本机成功环境存档 · 本次未重新验证'; scene.append(note); }
        gameDispose = () => game.dispose(); camera.setInteractionEnabled(true);
      } catch (error) { scene.hidden = true; calibration.hidden = false; const status = calibration.querySelector('.gaze-status'); if (status) status.textContent = error instanceof Error ? error.message : '暂时无法进入森林，请重试'; }
      finally { entering = false; }
    };
    if (!quick) {
      setupDispose = mountGazeTest(calibration, { onSceneReady: enter, environment: { store: environments, id: selectedId } });
      const title = calibration.querySelector('.gaze-intro h1'); if (title) title.textContent = `准备 ${minutes} 分钟的山间漫步`;
    } else {
      calibration.innerHTML = `<main class="environment-loading"><a class="brand" href="${sitePath()}">此刻山间 · Here in the Mountains</a><h1>回到熟悉的山间。</h1><p class="gaze-status" role="status">正在开启全屏与摄像头，加载环境存档…</p><button id="environment-retry">重试加载</button><button id="environment-recalibrate">重新校准此环境</button><p>不会重复眼动测试。坐姿或光照改变时，请重新校准。</p></main>`;
      const status = calibration.querySelector<HTMLElement>('.gaze-status')!;
      const camera = new CameraAttention(() => {}, message => { status.textContent = message; });
      setupDispose = () => camera.dispose();
      calibration.querySelector<HTMLButtonElement>('#environment-retry')!.onclick = () => setup(true);
      calibration.querySelector<HTMLButtonElement>('#environment-recalibrate')!.onclick = () => setup();
      void (async () => {
        try {
          if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
          if (disposed || operation !== epoch) return;
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          if (disposed || operation !== epoch) return;
          const savedProfile = environments.get(selectedId);
          await camera.start('CPU', (savedProfile.signature?.videoWidth ?? 640) >= 1000 ? '1280' : '640'); if (disposed || operation !== epoch) { camera.dispose(); return; }
          const profile = environments.get(selectedId), kind = quickEntryKind(profile);
          if (!kind || !sameEnvironment(profile.signature, camera.environment)) throw new Error('摄像头或显示环境与存档不同，请返回首页选择对应环境或新建环境');
          const saved = kind === 'saved' ? profile.saved : profile.latest;
          if (saved && profile.signature) camera.restoreCalibration(saved, profile.signature);
          if (kind === 'retry') camera.allowBasicEntry();
          enter(camera);
        } catch (error) {
          if (disposed || operation !== epoch) return;
          camera.stop(); status.textContent = error instanceof DOMException && error.name === 'NotAllowedError' ? '需要允许摄像头权限才能进行眼动交互；无需重新做校准测试。' : error instanceof Error ? error.message : '环境加载失败，请重试';
        }
      })();
    }
    const back = document.createElement('button'); back.className = 'hike-setup-back'; back.textContent = '返回首页'; back.onclick = home; calibration.append(back);
  };
  home(); return () => { if (disposed) return; disposed = true; clear(); parent.removeEventListener('pointerdown', unlockAudio, true); parent.removeEventListener('keydown', unlockAudio, true); releaseAudio(); parent.replaceChildren(); };
}
