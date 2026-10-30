import { CameraAttention } from './camera';
import type { Mapping, CameraUpdate } from './camera';
import { eyeDisplay } from './features';
import type { EyeFeatures } from './features';
import { neutralFeatures, poseCoverage, stableSamples } from './calibration';
import { chooseRidge } from './regression';
import type { CalibrationRow } from './regression';
import { fitScreen } from './screen';
import type { ScreenRow, ScreenState } from './screen';
import { measurementsCsv, measurementSummary, percentile, TimeSmoother, screenSummary } from './measurement';
import type { MeasurementRow } from './measurement';
import './test-page.css';
import { entryPolicy, positionEntryPassed, positionCalibrationPlan } from './entry-policy';
import { sameEnvironment } from './environment';
import type { EnvironmentStore } from './environment';

type Task = 'calibration' | 'validation' | 'screen-calibration' | 'screen-validation' | 'drift';
interface Target { id: string; x: number; y: number; round?: number; inside?: boolean; instruction?: string; headMotion?: boolean }
interface ScreenMeasurement { targetId: string; inside: boolean; state: ScreenState; reason: string; timestampMs: number }
const validationTargets: Target[] = [{ id: 'v1', x: .25, y: .25 }, { id: 'v2', x: .75, y: .25 }, { id: 'v3', x: .25, y: .75 }, { id: 'v4', x: .75, y: .75 }, { id: 'v5', x: .5, y: .35 }];
const screenTargets: Target[] = [{ id: 'center', x: .5, y: .5, inside: true }, ...[.05, .95].flatMap((y, row) => [.05, .95].map((x, col) => ({ id: `edge${row}${col}`, x, y, inside: true }))),
  ...['左侧', '右侧', '上方', '下方', '键盘'].map((name, i) => ({ id: `away${i}`, x: .5, y: .5, inside: false,
    instruction: `看向${name === '键盘' ? '键盘中央' : `屏幕${name}外侧约一掌距离的位置`}。保持双眼可见，尽量只转眼；读完后点击开始，持续看该位置直到提示音。` }))];
const reasonText: Record<string, string> = {
  'no-face': '未识别人脸，请正对摄像头', 'eyes-unavailable': '眼部不可用，请睁眼并检查光照', 'eyes-disagree': '双眼信号不一致，请检查遮挡或反光',
  'pose-out-of-range': '头部角度过大，请恢复坐姿', 'face-too-small': '请靠近摄像头',
  'not-calibrated': '方向预览，尚未校准屏幕位置', 'calibration-range': '坐姿超出校准范围，请恢复或重校准',
  'off-screen': '视线估计在屏幕外，交互已暂停', 'stale-frame': '信号过期，交互已暂停', 'background': '页面在后台，交互已暂停',
  'stopped': '摄像头未开启', 'capture-failed': '无法读取摄像头帧', 'bad-landmarks': '眼部关键点不可用', 'bad-pose': '头部姿态不可用',
  'fullscreen-required': '需要全屏才能判断物理屏幕内外', 'screen-not-calibrated': '位置已校准，请完成屏幕内外校准',
  'screen-uncertain': '屏幕边缘或证据不足，无法判断', 'screen-settling': '正在确认视线状态', 'on-screen': '视线估计在屏幕内',
  'position-unverified': '请完成五点位置验证', 'screen-unverified': '请完成屏幕内外独立验证', 'interaction-paused': '注视交互已暂停',
};
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const percent = (v: number | null) => v === null ? '—' : `${(v * 100).toFixed(1)}%`;

export function mountGazeTest(parent: HTMLElement, options: { camera?: CameraAttention; onSceneReady?: (camera: CameraAttention) => void; environment?: { store: EnvironmentStore; id: string } } = {}) {
  document.title = '眼动准备 · 此刻山间 · Here in the Mountains';
  parent.innerHTML = `<main class="gaze-page">
    <div class="gaze-grid" aria-hidden="true"></div>
    <aside class="gaze-eye-panel" aria-label="眼球转动示意"><div class="gaze-eyebrow">LIVE EYE MOVEMENT</div>
      <div class="gaze-eye"><div class="gaze-iris"><i></i></div><div class="gaze-lid"></div></div>
      <div class="gaze-eye-caption">眼球转动示意 <span class="gaze-source">camera</span></div>
      <p class="gaze-eye-status">等待真实摄像头输入</p><strong class="gaze-screen-state" data-state="unknown">无法判断</strong>
      <small>仅在本机处理；眼球图是特征驱动示意。</small></aside>
    <header class="gaze-heading"><a href="${import.meta.env.BASE_URL}">此刻山间 · Here in the Mountains</a><span>校准 → 验证 → 场景交互</span></header>
    <div class="gaze-axis-label gaze-left">向左看</div><div class="gaze-axis-label gaze-right">向右看</div>
    <div class="gaze-crosshair" aria-hidden="true"></div><div class="gaze-ball is-invalid" aria-label="注视跟随球"></div>
    <section class="gaze-intro"><p class="gaze-eyebrow">FOLLOW YOUR GAZE</p><h1>让目光，带动小球。</h1><p>进入全屏 → 开启摄像头 → 连续校准与验证。<br>跟随圆点；切到后台会关闭摄像头；继续后重新执行未完成的校准步骤。</p></section>
    <section class="gaze-controls" aria-label="眼动控制"><div class="gaze-status" role="status" aria-live="polite">进入全屏并开启摄像头，开始校准。</div>
      <div class="gaze-control-row"><button data-action="fullscreen">进入全屏</button><button class="gaze-primary" data-action="start">开启摄像头</button>
      <button class="gaze-primary" data-action="guided" disabled>轻松校准并准备徒步</button><button data-action="calibrate" disabled>位置校准（15项）</button><button data-action="validate" disabled>五点验证</button><button data-action="stop" disabled>停止</button></div>
      <div class="gaze-control-row"><button data-action="screen-calibrate" disabled>屏幕内外校准</button><button data-action="screen-validate" disabled>屏幕状态验证</button>
      <button data-action="drift" disabled>中央复查</button><button data-action="scene" disabled>${options.onSceneReady ? '进入森林交互' : '启用三目标交互'}</button></div>
      <small class="gaze-entry-note">位置15项 + 屏幕内外10项。验证未达标或尚未验证也可进入；结果照实保留，方向和离屏判断可能不准。</small>
      <div class="gaze-control-row" ${options.environment ? '' : 'hidden'}><button data-action="save-environment" disabled>保存成功环境</button><button data-action="retry-entry" disabled>已测试三次，直接体验</button><small class="gaze-environment-status"></small></div>
      <div class="gaze-control-row gaze-secondary"><label>推理 <select data-setting="delegate"><option value="CPU">CPU / WASM</option><option value="GPU">GPU</option></select></label>
      <label>视频 <select data-setting="resolution"><option value="640">640×480</option><option value="1280">1280×720</option></select></label>
      <button data-action="export" disabled>下载验证 CSV</button><button data-action="screen-export" disabled>下载屏幕状态 CSV</button><span class="gaze-mode">camera · 未校准</span></div></section>
    <details class="gaze-metrics"><summary>测量与诊断</summary><output class="gaze-performance">尚无测量数据</output><output class="gaze-coordinates"></output>
      <output class="gaze-report">五点验证尚未执行</output><output class="gaze-screen-report">屏幕状态验证尚未执行</output><output class="gaze-interaction-report"></output>
      <label><input type="checkbox" data-setting="eye-preview"> 显示本地眼部放大（不保存）</label><canvas class="gaze-eye-preview" width="280" height="80" hidden></canvas>
      <p>处理耗时不等于眼睛到画面的端到端延迟。真人精度与多人验收仍需实测。</p></details>
    <div class="gaze-demo-targets" hidden><div data-gaze-target="left">左侧目标</div><div data-gaze-target="center">中央目标</div><div data-gaze-target="right">右侧目标</div></div>
    <div class="gaze-overlay" hidden><div class="gaze-task-instruction"></div><button data-action="cancel">取消</button><button data-action="sample" hidden>开始此项</button><button data-action="retry-entry-overlay" hidden>已测试三次，直接体验</button>
      <div class="gaze-target"><span></span></div><div class="gaze-task-progress"></div></div>
  </main>`;
  const root = parent.querySelector<HTMLElement>('.gaze-page')!;
  const get = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const button = (action: string) => get<HTMLButtonElement>(`[data-action="${action}"]`);
  const status = get('.gaze-status'), mode = get('.gaze-mode'), ball = get('.gaze-ball'), overlay = get('.gaze-overlay'), dot = get('.gaze-target');
  const preview = new TimeSmoother(50);
  let mapping: Mapping | null = null, started = false, starting = false, disposed = false, startOperation = 0;
  let positionPassed = false, screenPassed = false, screenCalibrated = false;
  let task: Task | null = null, queue: Target[] = [], target: Target | null = null, pointIndex = 0, pointStart = 0, taskFrame = 0, waiting = false, retries = 0;
  let rows: CalibrationRow[] = [], allFeatures: EyeFeatures[] = [], screenRows: ScreenRow[] = [], pointFeatures: EyeFeatures[] = [];
  let screenSeeds: ScreenRow[] = [];
  let validationRows: MeasurementRow[] = [], screenMeasurements: ScreenMeasurement[] = [];
  let pointMeasurements = new Map<number, MeasurementRow>(), pointScreen = new Map<number, ScreenMeasurement>();
  let processingTimes: number[] = [], pipelineTimes: number[] = [], sampleTimes: number[] = [], lastPaint = 0;
  let audio: AudioContext | null = null;
  let guided = false, suspended = false;
  // Evaluate coverage at the supported 10 Hz floor, not the 15 Hz scheduler target.
  // Empty time bins still count as invalid; errors and accuracy gates are unchanged.
  const samplePeriodMs = 100;
  let attemptToken = crypto.randomUUID();
  const newAttempt = () => { attemptToken = crypto.randomUUID(); };
  const retryAllowed = () => {
    const session = options.environment; if (!session || !camera.environment) return false;
    const profile = session.store.get(session.id);
    return profile.attempts >= 3 && sameEnvironment(profile.signature, camera.environment);
  };
  const recordAttempt = () => {
    const session = options.environment; if (!session || !camera.environment) return;
    try { session.store.recordAttempt(session.id, attemptToken, camera.environment, camera.exportCalibration()); }
    catch (error) { status.textContent = error instanceof Error ? error.message : '本次测试计数未保存'; }
    controls();
  };
  const settleMs = () => task === 'screen-validation' || target?.inside === false ? 800 : 400;
  const durationMs = () => task === 'screen-validation' || target?.inside === false ? 2600 : 1500;
  const slots = () => Math.ceil((durationMs() - settleMs()) / samplePeriodMs);
  const controls = () => {
    button('fullscreen').textContent = document.fullscreenElement ? '退出全屏' : '进入全屏';
    button('start').disabled = starting || started;
    button('stop').disabled = !(starting || started);
    button('calibrate').disabled = !started || !!task;
    button('guided').disabled = !started || !!task || !document.fullscreenElement;
    button('validate').disabled = !started || !mapping || !!task;
    button('screen-calibrate').disabled = !started || !mapping || !!task || !document.fullscreenElement;
    button('screen-validate').disabled = !started || !screenCalibrated || !!task || !document.fullscreenElement;
    button('drift').disabled = !started || !mapping || !!task;
    button('scene').disabled = !started || !mapping || !screenCalibrated || !!task || !document.fullscreenElement;
    button('scene').textContent = positionPassed && screenPassed ? (options.onSceneReady ? '进入徒步' : '启用三目标交互') : (options.onSceneReady ? '未达标或未验证，仍进入徒步' : '未达标或未验证，仍启用交互');
    button('scene').classList.toggle('gaze-primary', !button('scene').disabled);
    button('save-environment').disabled = !started || !!task || !positionPassed || !screenPassed || !options.environment;
    button('retry-entry').disabled = !started || (!!task && !suspended) || !document.fullscreenElement || !retryAllowed();
    button('retry-entry-overlay').hidden = !suspended || button('retry-entry').disabled;
    if (options.environment) { const p = options.environment.store.get(options.environment.id); get('.gaze-environment-status').textContent = `${p.name} · 已测试 ${p.attempts} 次。${options.environment.store.warning || '环境参数仅保存在本浏览器，不保存图像。'}`; }
    button('export').disabled = !validationRows.length || !!task;
    button('screen-export').disabled = !screenMeasurements.length || !!task;
    root.querySelectorAll<HTMLSelectElement>('select').forEach(s => { s.disabled = starting || started; });
  };
  function resetCalibration() {
    mapping = null; positionPassed = false; screenPassed = false; screenCalibrated = false;
    get('.gaze-demo-targets').hidden = true; rows = []; allFeatures = []; screenRows = []; screenSeeds = []; pointFeatures = [];
  }
  const onCameraUpdate = (update: CameraUpdate) => {
    // The camera continues publishing to the game; the hidden setup needs no DOM work.
    if (parent.hidden) return;
    const { sample, features, position, screen } = update;
    if (!features) camera.drawEyePreview(get<HTMLCanvasElement>('.gaze-eye-preview'), null);
    root.classList.toggle('has-eyes', !!features);
    get('.gaze-lid').style.transform = sample.invalidReason === 'eyes-unavailable' ? 'scaleY(1)' : 'scaleY(0)';
    if (features) { const p = eyeDisplay(features); get('.gaze-iris').style.transform = `translate(${clamp((p.x - .5) * 100, -28, 28)}px,${clamp((p.y - .5) * 40, -15, 15)}px)`; }
    get('.gaze-eye-status').textContent = reasonText[sample.invalidReason ?? screen.reason] ?? '信号不可用';
    const label = get('.gaze-screen-state'); label.dataset.state = screen.state;
    label.textContent = screen.state === 'on-screen' ? '屏幕内' : screen.state === 'off-screen' ? '屏幕外' : '无法判断';
    if (features && !mapping && !task && sample.invalidReason === 'not-calibrated') {
      const eye = eyeDisplay(features), p = preview.update(.5 + (eye.x - .5) * 3, .5 + (eye.y - .5) * 1.5, sample.timestampMs);
      positionBall(clamp(p.x), clamp(p.y)); ball.classList.remove('is-invalid'); ball.classList.add('is-preview'); mode.textContent = 'camera · 未校准方向预览';
    } else if (position && (screen.state === 'on-screen' || !screenCalibrated) && position.x >= 0 && position.x <= 1 && position.y >= 0 && position.y <= 1) {
      positionBall(position.x, position.y); ball.classList.remove('is-invalid'); ball.classList.toggle('is-preview', !sample.valid);
      mode.textContent = sample.valid ? 'camera · 注视交互可用' : positionPassed && screenPassed ? 'camera · 验证完成，待启用交互' : 'camera · 位置预览，交互待验证';
    } else { ball.classList.add('is-invalid'); preview.reset(); }
    collect(update);
    if (update.processingMs > 0) { processingTimes.push(update.processingMs); pipelineTimes.push(update.pipelineMs); sampleTimes.push(sample.timestampMs); if (processingTimes.length > 300) { processingTimes.shift(); pipelineTimes.shift(); sampleTimes.shift(); } }
    if (performance.now() - lastPaint > 250) {
      lastPaint = performance.now(); const rate = sampleTimes.length > 1 ? (sampleTimes.length - 1) * 1000 / (sampleTimes.at(-1)! - sampleTimes[0]) : 0;
      get('.gaze-performance').textContent = `推理 ${rate.toFixed(1)} Hz · 处理 P95 ${percentile(processingTimes, .95)?.toFixed(1) ?? '—'} ms\n帧提交至结果 P95 ${percentile(pipelineTimes, .95)?.toFixed(1) ?? '—'} ms`;
      get('.gaze-coordinates').textContent = `原始 x/y ${update.raw ? `${update.raw.x.toFixed(3)} / ${update.raw.y.toFixed(3)}` : '—'}\n屏幕内倾向分数 ${screen.score?.toFixed(2) ?? '—'}（非准确率）\n${features ? `头姿 ${features.yaw.toFixed(1)}° / ${features.pitch.toFixed(1)}°` : '暂无有效眼部特征'}`;
      const canvas = get<HTMLCanvasElement>('.gaze-eye-preview'); canvas.hidden = !get<HTMLInputElement>('[data-setting="eye-preview"]').checked;
      camera.drawEyePreview(canvas, canvas.hidden ? null : features);
    }
  };
  const camera = options.camera ?? new CameraAttention(onCameraUpdate, message => { status.textContent = message; if (!camera.running && !starting) { guided = false; started = false; resetCalibration(); cancelTask(); } controls(); });
  const offCameraUpdates = options.camera ? camera.subscribeUpdates(onCameraUpdate) : () => {};
  if (options.camera) started = camera.running;
  const offEvents = camera.subscribeEvents(event => {
    if (parent.hidden) return;
    get('.gaze-interaction-report').textContent = `${event.type} · ${event.targetId ?? '—'} · ${Math.round(event.progress * 100)}%`;
    root.querySelectorAll<HTMLElement>('[data-gaze-target]').forEach(el => { el.style.setProperty('--dwell', `${el.dataset.gazeTarget === event.targetId ? event.progress * 100 : 0}%`); el.classList.toggle('confirmed', event.type === 'targetConfirmed' && el.dataset.gazeTarget === event.targetId); });
  });
  function collect(update: CameraUpdate) {
    if (!task || !target || waiting || document.hidden) return;
    const elapsed = update.sample.timestampMs - pointStart;
    if (elapsed < settleMs() || elapsed > durationMs()) return;
    const slot = Math.floor((elapsed - settleMs()) / samplePeriodMs);
    if (task === 'calibration' || task === 'screen-calibration') {
      if (update.features && update.sensorValid) pointFeatures.push(update.features);
    } else if (task === 'screen-validation') {
      if (!pointScreen.has(slot)) pointScreen.set(slot, { targetId: target.id, inside: target.inside!, state: update.screen.state, reason: update.screen.reason, timestampMs: update.sample.timestampMs });
    } else {
      const p = update.position;
      if (!pointMeasurements.has(slot)) pointMeasurements.set(slot, { timestampMs: update.sample.timestampMs, targetId: target.id, targetX: target.x, targetY: target.y,
        x: p?.x ?? null, y: p?.y ?? null, valid: !!p, reason: p ? null : update.sample.invalidReason, width: root.clientWidth, height: root.clientHeight, processingMs: update.processingMs, pipelineMs: update.pipelineMs });
    }
  }
  function positionBall(x: number, y: number) { ball.style.left = `${x * root.clientWidth}px`; ball.style.top = `${y * root.clientHeight}px`; }
  function cancelTask() { cancelAnimationFrame(taskFrame); taskFrame = 0; task = null; target = null; waiting = false; suspended = false; overlay.hidden = true; root.classList.remove('is-task'); pointFeatures = []; controls(); }
  function pausePoint(message: string) {
    cancelAnimationFrame(taskFrame); taskFrame = 0; waiting = true; suspended = true;
    pointFeatures = []; pointMeasurements.clear(); pointScreen.clear();
    get('.gaze-task-instruction').textContent = message;
    button('sample').textContent = '重试当前点'; button('sample').hidden = false;
  }
  function tone() { if (!audio || audio.state !== 'running') return; const osc = audio.createOscillator(), gain = audio.createGain(); gain.gain.value = .035; osc.frequency.value = 660; osc.connect(gain).connect(audio.destination); osc.start(); osc.stop(audio.currentTime + .12); }
  function beginPoint() {
    target = queue[pointIndex]; pointFeatures = []; pointMeasurements = new Map(); pointScreen = new Map();
    dot.dataset.targetId = target.id; dot.dataset.inside = String(target.inside ?? true); overlay.dataset.task = task ?? '';
    dot.hidden = target.inside === false; dot.style.left = `${target.x * 100}%`; dot.style.top = `${target.y * 100}%`;
    get('.gaze-task-instruction').textContent = target.instruction ?? (task === 'calibration' ? '注视圆点，保持头部基本稳定。' : '独立采样：持续注视圆点。');
    get('.gaze-task-progress').textContent = `${pointIndex + 1} / ${queue.length}${retries ? ` · 本点重试 ${retries}/2` : ''}`;
    waiting = !!target.instruction; button('sample').textContent = '开始此项'; button('sample').hidden = !waiting; pointStart = performance.now();
    if (!waiting) taskFrame = requestAnimationFrame(advanceTask);
  }
  button('sample').onclick = () => { if (!task || !waiting || document.hidden) return; if (suspended) { suspended = false; retries = 0; beginPoint(); if (!waiting) return; } waiting = false; button('sample').hidden = true; pointStart = performance.now(); taskFrame = requestAnimationFrame(advanceTask); };
  function advanceTask() {
    if (!task || !target) return;
    const progress = clamp((performance.now() - pointStart) / durationMs()); dot.style.setProperty('--point-progress', `${progress * 360}deg`);
    if (progress < 1) { taskFrame = requestAnimationFrame(advanceTask); return; }
    if (task === 'calibration' || task === 'screen-calibration') {
      const indices = stableSamples(pointFeatures, !!target.headMotion);
      if (indices.length < entryPolicy.stableSamples || indices.length / pointFeatures.length < entryPolicy.retainedFraction) {
        if (retries++ < 2) { tone(); beginPoint(); return; }
        pausePoint('该点样本不足或不稳定。请检查光照、坐姿和眼部遮挡，再重试当前点；之前的进度已保留。'); recordAttempt(); return;
      }
      const selected = indices.map(i => pointFeatures[i]);
      if (task === 'calibration') { rows.push(...selected.map(f => ({ features: [...f.vector], x: target!.x, y: target!.y, targetId: target!.id, round: target!.round }))); allFeatures.push(...selected); }
      else screenRows.push(...selected.map(features => ({ features, targetId: target!.id, round: target!.round!, inside: target!.inside! })));
    } else if (task === 'screen-validation') {
      for (let i = 0; i < slots(); i++) screenMeasurements.push(pointScreen.get(i) ?? { targetId: target.id, inside: target.inside!, state: 'unknown', reason: 'missing-sample', timestampMs: pointStart + settleMs() + i * samplePeriodMs });
    } else for (let i = 0; i < slots(); i++) validationRows.push(pointMeasurements.get(i) ?? { timestampMs: pointStart + settleMs() + i * samplePeriodMs, targetId: target.id, targetX: target.x, targetY: target.y,
      x: null, y: null, valid: false, reason: 'missing-sample', width: root.clientWidth, height: root.clientHeight, processingMs: 0, pipelineMs: 0 });
    tone(); retries = 0; pointIndex++;
    if (pointIndex < queue.length) { beginPoint(); return; }
    const completed = task; cancelTask();
    try {
      if (completed === 'calibration') {
        const model = chooseRidge(rows); mapping = { model, baseline: neutralFeatures(allFeatures), coverage: poseCoverage(allFeatures) }; camera.setMapping(mapping);
        screenSeeds = rows.map((r, i) => ({ features: allFeatures[i], targetId: r.targetId, round: r.round ?? 0, inside: true }));
        status.textContent = `15项位置校准完成（${model.basis}）。请执行五点独立验证。`;
      } else if (completed === 'screen-calibration') {
        const model = fitScreen(screenRows); camera.setScreenMapping(model); screenCalibrated = true;
        status.textContent = `屏幕内外校准完成。请执行独立屏幕状态验证；校准分组区分率 ${percent(model.balancedAccuracy)} 不是验收准确率。`;
      } else if (completed === 'screen-validation') {
        const summary = screenSummary(screenMeasurements); screenPassed = summary.passed; camera.verifyScreen(screenPassed);
        get('.gaze-screen-report').textContent = `独立屏幕状态验证 ${screenMeasurements.length} 计划样本\n离屏误报屏内 ${percent(summary.falseOn)} · 屏内误报离屏 ${percent(summary.falseOff)}\n离屏召回 ${percent(summary.offRecall)} · 屏内召回 ${percent(summary.onRecall)} · 无法判断 ${percent(summary.unknown)}\n${screenPassed ? '本次达到交互启用条件，仍待多人验收。' : '本次未达到验证门槛，仍可进入游戏，也可重新校准。'}`;
        get('.gaze-screen-report').textContent += '\n' + [...new Set(screenMeasurements.map(r => r.targetId))].map(id => {
          const group = screenMeasurements.filter(r => r.targetId === id);
          return `${id} 正确 ${percent(group.filter(r => r.state === (r.inside ? 'on-screen' : 'off-screen')).length / group.length)} / 未知 ${percent(group.filter(r => r.state === 'unknown').length / group.length)}`;
        }).join('\n');
        status.textContent = '屏幕状态验证完成。可下载匿名状态 CSV。';
      } else {
        const summary = measurementSummary(validationRows);
        const passed = positionEntryPassed(summary);
        if (completed === 'validation') { positionPassed = passed; camera.verifyPosition(passed); }
        else if (!passed) { positionPassed = false; camera.verifyPosition(false); }
        get('.gaze-report').textContent = `${completed === 'drift' ? '中央复查' : '独立五点验证'}：${summary.valid}/${summary.total} 有效（${percent(summary.validRate)}）\n中位误差 ${percent(summary.median)} · P90 ${percent(summary.p90)} 对角线\n轻松验证门槛：有效≥${percent(entryPolicy.position.validRate)}，中位≤${percent(entryPolicy.position.median)}，P90≤${percent(entryPolicy.position.p90)}\n${passed ? '达到位置门槛，可继续准备游戏；不代表原精度验收通过。' : '本次未达门槛，仍可完成屏幕校准后进入，也可重试。'}`;
        status.textContent = completed === 'drift' ? '中央复查完成。复查不会自动训练或修改校准。' : '五点验证完成。可下载匿名测量 CSV。';
      }
    } catch (error) { guided = false; status.textContent = error instanceof Error ? error.message : String(error); recordAttempt(); }
    if (completed === 'screen-validation' || (completed === 'validation' && !guided)) recordAttempt();
    rows = []; allFeatures = []; screenRows = []; pointFeatures = []; get<HTMLDetailsElement>('.gaze-metrics').open = true; controls();
    if (guided) {
      if (completed === 'calibration' && mapping) beginTask('validation');
      else if (completed === 'validation' && mapping) beginTask('screen-calibration');
      else if (completed === 'screen-calibration' && screenCalibrated) beginTask('screen-validation');
      else {
        guided = false;
        status.textContent = positionPassed && screenPassed ? '校准与独立验证已通过，点击“进入徒步”开始。' : '验证未达标，仍可点击进入徒步，也可重试验证；测量结果保持不变。';
        if (mapping && screenCalibrated) button('scene').focus();
      }
    }
  }
  function beginTask(kind: Task) {
    if (!started || (kind !== 'calibration' && !mapping) || (kind.startsWith('screen') && !document.fullscreenElement)) return;
    if (kind === 'screen-validation' && !screenCalibrated) return;
    if (!guided) newAttempt();
    cancelTask(); camera.revokeUnverifiedEntry(); camera.setInteractionEnabled(false); camera.setTargets([]); get('.gaze-demo-targets').hidden = true;
    task = kind; pointIndex = 0; retries = 0; rows = []; allFeatures = []; screenRows = [];
    audio ??= new AudioContext(); void audio.resume().catch(() => {});
    if (kind === 'calibration') {
      resetCalibration(); camera.setMapping(null);
      const plan = positionCalibrationPlan();
      queue = [0, 1].flatMap(round => shuffle(plan.filter(t => t.round === round)));
    } else if (kind === 'screen-calibration') { screenPassed = false; screenCalibrated = false; screenRows = [...screenSeeds]; camera.setScreenMapping(null); queue = [0, 1].flatMap(round => shuffle(screenTargets.filter(t => !t.inside)).map(t => ({ ...t, round }))); }
    else if (kind === 'screen-validation') { screenPassed = false; camera.verifyScreen(false); screenMeasurements = []; queue = shuffle(screenTargets.map(t => t.inside ? { ...t, x: .5 + (t.x - .5) * .8, y: .5 + (t.y - .5) * .8 } : { ...t })); }
    else { validationRows = []; if (kind === 'validation') { positionPassed = false; camera.verifyPosition(false); } queue = kind === 'drift' ? [{ id: 'drift', x: .5, y: .5 }] : shuffle(validationTargets); }
    overlay.hidden = false; root.classList.add('is-task'); controls(); beginPoint();
  }
  button('fullscreen').onclick = () => { void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => { status.textContent = '无法进入全屏，请使用支持全屏的桌面浏览器。'; }); };
  button('start').onclick = async () => {
    const operation = ++startOperation; starting = true; controls(); resetCalibration();
    processingTimes = []; pipelineTimes = []; sampleTimes = [];
    try { await camera.start(get<HTMLSelectElement>('[data-setting="delegate"]').value as 'CPU' | 'GPU', get<HTMLSelectElement>('[data-setting="resolution"]').value as '640' | '1280'); if (operation === startOperation && !disposed) started = camera.running; }
    catch (error) { if (operation !== startOperation || disposed) return; status.textContent = error instanceof DOMException && error.name === 'NotAllowedError' ? '摄像头权限被拒绝，请在地址栏允许后重试。' : error instanceof Error ? error.message : String(error); }
    finally { if (operation === startOperation) { starting = false; if (!disposed) controls(); } }
  };
  const stopCamera = () => { guided = false; startOperation++; cancelTask(); camera.stop(); resetCalibration(); started = false; starting = false; status.textContent = '摄像头已停止，校准参数已清除。'; controls(); };
  button('stop').onclick = stopCamera;
  button('calibrate').onclick = () => beginTask('calibration'); button('validate').onclick = () => beginTask('validation');
  button('guided').onclick = () => { newAttempt(); guided = true; beginTask(mapping ? !positionPassed ? 'validation' : !screenCalibrated ? 'screen-calibration' : 'screen-validation' : 'calibration'); };
  button('screen-calibrate').onclick = () => beginTask('screen-calibration'); button('screen-validate').onclick = () => beginTask('screen-validation'); button('drift').onclick = () => beginTask('drift');
  button('cancel').onclick = () => { guided = false; cancelTask(); rows = []; allFeatures = []; screenRows = []; status.textContent = '本轮采样已取消，未形成完整验证报告。'; };
  button('scene').onclick = () => {
    if (!started || !mapping || !screenCalibrated || !document.fullscreenElement || task) return;
    if ((!positionPassed || !screenPassed) && !camera.allowUnverifiedEntry()) return;
    camera.setInteractionEnabled(true);
    if (options.onSceneReady) { options.onSceneReady(camera); return; }
    const container = get('.gaze-demo-targets'); container.hidden = false;
    camera.setTargets([]);
    camera.setTargets([...container.querySelectorAll<HTMLElement>('[data-gaze-target]')].map(el => { const r = el.getBoundingClientRect(), v = root.getBoundingClientRect(); return { id: el.dataset.gazeTarget!, x: (r.left - v.left) / v.width, y: (r.top - v.top) / v.height, width: r.width / v.width, height: r.height / v.height, enabled: true }; }));
    status.textContent = '注视任一目标约 1.2 秒确认。每个目标只确认一次；再次点击启用可重置。';
  };
  button('save-environment').onclick = () => {
    const session = options.environment;
    if (!session || !camera.environment || task) return;
    try { session.store.saveSuccess(session.id, camera.environment, camera.exportCalibration()); status.textContent = session.store.warning || '成功环境已保存在本机。下次从首页点击此档案即可进入，无需重复验证。'; }
    catch (error) { status.textContent = error instanceof Error ? error.message : '环境保存失败'; }
    controls();
  };
  button('retry-entry').onclick = () => {
    if (!retryAllowed() || !document.fullscreenElement) return;
    guided = false; cancelTask();
    if (!camera.allowBasicEntry()) return;
    camera.setInteractionEnabled(true);
    options.onSceneReady?.(camera);
  };
  button('retry-entry-overlay').onclick = () => button('retry-entry').click();
  function download(text: string, filename: string) { const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  button('export').onclick = () => download(measurementsCsv(validationRows), 'gaze-position-camera.csv');
  button('screen-export').onclick = () => download('\uFEFFsource,entryPolicy,targetId,expected,state,reason,timestampMs\r\n' + screenMeasurements.map(r => ['camera', entryPolicy.id, r.targetId, r.inside ? 'on-screen' : 'off-screen', r.state, r.reason, r.timestampMs].join(',')).join('\r\n'), 'gaze-screen-camera.csv');
  const resize = () => { guided = false; cancelTask(); resetCalibration(); mode.textContent = '显示区域变化，请重新校准'; controls(); };
  const visibility = () => { if (document.hidden && task) pausePoint('采样已暂停。回到页面后重试当前点，已完成的采样保留。'); };
  window.addEventListener('resize', resize); document.addEventListener('fullscreenchange', resize); document.addEventListener('visibilitychange', visibility); window.addEventListener('exhibit:before-pause', suspendCalibration); window.addEventListener('exhibit:camera-restored', restoreCalibrationUI);
  function suspendCalibration() { startOperation++; starting=false; guided=false; cancelTask(); void audio?.suspend(); }
  function restoreCalibrationUI(event: Event) {
    const detail=(event as CustomEvent<{camera:CameraAttention;recalibrate:boolean}>).detail;
    if(detail.camera!==camera)return;
    started=camera.running;starting=false;
    if(!detail.recalibrate){const saved=camera.exportCalibration();mapping=saved.mapping;positionPassed=saved.positionVerified;screenPassed=saved.screenVerified;screenCalibrated=!!saved.screenModel;}
    if(detail.recalibrate){resetCalibration();parent.hidden=false;status.textContent='请重新校准，原徒步位置与进度已保留。';}
    controls();
  }
  controls();
  return () => { disposed = true; startOperation++; cancelTask(); offEvents(); offCameraUpdates(); camera.dispose(); void audio?.close(); window.removeEventListener('resize', resize); document.removeEventListener('fullscreenchange', resize); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('exhibit:before-pause', suspendCalibration); window.removeEventListener('exhibit:camera-restored', restoreCalibrationUI); root.remove(); };
}
