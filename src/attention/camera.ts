import type { AttentionPort, GazeEvent, GazeSample, TargetRegion } from '../contracts';
import { DwellTracker } from './dwell';
import type { EyeFeatures, FeatureResult } from './features';
import { GazePipeline } from './pipeline';
import type { Mapping, GazeResult } from './pipeline';
import type { ScreenModel, ScreenStatus } from './screen';
export type { Mapping } from './pipeline';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { gazeFreshMs } from './sample-timing';
import { calibrationVersion, cleanSnapshot, sameEnvironment } from './environment';
import type { CalibrationSnapshot, EnvironmentSignature } from './environment';

export interface CameraUpdate extends GazeResult {
  processingMs: number;
  pipelineMs: number;
}
export class CameraAttention implements AttentionPort {
  private sampleListeners = new Set<(sample: GazeSample) => void>();
  private eventListeners = new Set<(event: GazeEvent) => void>();
  private tracker = new DwellTracker();
  private pipeline = new GazePipeline();
  private statusListeners = new Set<(status: ScreenStatus) => void>();
  private updateListeners = new Set<(update: CameraUpdate) => void>();
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private video = document.createElement('video');
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private busy = false;
  private lastVideoTime = -1;
  private lastResultMs = 0;
  private sentAt = 0;
  private pendingReject: ((error: Error) => void) | null = null;
  private visibilityEpoch = 0;
  private frameEpoch = 0;
  private deviceKey = '';
  private disposed = false;
  private requested = false;
  private resumeOperation = 0;
  private resolution: '640' | '1280' = '640';
  private suspended: { snapshot: CalibrationSnapshot; signature: EnvironmentSignature | null; unverified: boolean; ready: boolean } | null = null;
  private suspendExhibit = () => {
    this.resumeOperation++;
    if (!this.suspended && (this.requested || this.running)) {
      this.suspended = { snapshot: this.exportCalibration(), signature: this.environment, unverified: this.unverifiedEntry, ready: this.interactionReady };
      document.documentElement.dataset.exhibitCamera = 'true';
    }
    if (this.suspended) this.stop();
  };
  private resumeExhibit = (event: Event) => {
    if (!this.suspended || this.disposed) return;
    (event as CustomEvent<{waitUntil:(promise:Promise<void>)=>void}>).detail?.waitUntil(this.restoreExhibit());
  };
  private async restoreExhibit() {
    const saved = this.suspended, operation = ++this.resumeOperation;
    if (!saved) return;
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    if (this.disposed || operation !== this.resumeOperation || document.hidden) return;
    await this.start('CPU', this.resolution);
    if (this.disposed || operation !== this.resumeOperation || document.hidden) { this.stop(); return; }
    if (!this.running) throw new Error('摄像头未能恢复，请重试');
    const matches = !!saved.signature && sameEnvironment(saved.signature, this.environment);
    if (matches && saved.ready) {
      this.restoreCalibration(saved.snapshot, saved.signature!);
      if (saved.unverified) { if(saved.snapshot.mapping && saved.snapshot.screenModel)this.allowUnverifiedEntry();else this.allowBasicEntry(); }
      this.setInteractionEnabled(true);
    } else {
      this.clearCalibration();
      this.onStatus('摄像头已恢复，请重新完成校准；徒步进度已保留。');
    }
    this.suspended = null; delete document.documentElement.dataset.exhibitCamera;
    window.dispatchEvent(new CustomEvent('exhibit:camera-restored', {detail:{camera:this, recalibrate:!matches || !saved.ready}}));
  }
  private visibility = () => {
    this.visibilityEpoch++;
    if (document.hidden) this.invalidate('background');
    else { this.pipeline.reset(); this.tracker.reset(); this.lastVideoTime = -1; this.lastResultMs = performance.now(); }
  };
  private viewportKey = this.displayKey();
  private displayKey() { return `${innerWidth}:${innerHeight}:${devicePixelRatio}:${screen.width}:${screen.height}:${!!document.fullscreenElement}`; }
  private viewportChange = () => {
    const next = this.displayKey();
    if (next === this.viewportKey) return;
    this.viewportKey = next;
    this.clearCalibration(); this.onStatus('显示区域变化，已清除校准，请重新校准');
  };
  constructor(private onUpdate: (update: CameraUpdate) => void = () => {}, private onStatus: (status: string) => void = () => {}) {
    this.video.muted = true; this.video.playsInline = true;
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('exhibit:pause', this.suspendExhibit);
    window.addEventListener('exhibit:resume', this.resumeExhibit);
    window.addEventListener('resize', this.viewportChange);
    document.addEventListener('fullscreenchange', this.viewportChange);
  }
  subscribeSamples(fn: (sample: GazeSample) => void) { this.sampleListeners.add(fn); return () => { this.sampleListeners.delete(fn); }; }
  subscribeEvents(fn: (event: GazeEvent) => void) { this.eventListeners.add(fn); return () => { this.eventListeners.delete(fn); }; }
  setTargets(targets: TargetRegion[]) { this.tracker.setTargets(targets.filter(t => t.width > 0 && t.height > 0 && [t.x, t.y, t.width, t.height].every(Number.isFinite))); }
  get running() { return this.stream !== null && this.worker !== null; }
  get interactionReady() { return this.running && this.pipeline.entryReady && !!document.fullscreenElement; }
  get unverifiedEntry() { return this.pipeline.unverifiedEntry; }
  get environment(): EnvironmentSignature | null {
    const settings = this.stream?.getVideoTracks()[0]?.getSettings();
    if (!settings || !this.deviceKey) return null;
    return { screenWidth: screen.width, screenHeight: screen.height, width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio, videoWidth: settings.width || this.video.videoWidth, videoHeight: settings.height || this.video.videoHeight, deviceKey: this.deviceKey };
  }
  exportCalibration(): CalibrationSnapshot { return cleanSnapshot({ version: calibrationVersion, mapping: this.pipeline.mapping, screenModel: this.pipeline.screenModel, positionVerified: this.pipeline.positionVerified, screenVerified: this.pipeline.screenVerified }); }
  restoreCalibration(snapshot: CalibrationSnapshot, signature: EnvironmentSignature) {
    if (!this.running || !document.fullscreenElement || !sameEnvironment(signature, this.environment)) throw new Error('摄像头或显示环境与存档不同，请重新校准或选择对应环境');
    const saved = cleanSnapshot(snapshot); this.pipeline.clear();
    this.pipeline.mapping = saved.mapping; this.pipeline.screenModel = saved.screenModel;
    this.pipeline.positionVerified = saved.positionVerified; this.pipeline.screenVerified = saved.screenVerified;
    this.invalidate('screen-settling');
  }
  allowBasicEntry() {
    if (!this.running || !document.fullscreenElement) return false;
    this.pipeline.basicEntry = true; this.pipeline.unverifiedEntry = true; this.invalidate('screen-settling'); return true;
  }
  allowUnverifiedEntry() {
    if (!this.running || !document.fullscreenElement || !this.pipeline.mapping || !this.pipeline.screenModel) return false;
    this.pipeline.unverifiedEntry = true;
    this.invalidate('screen-settling');
    return true;
  }
  revokeUnverifiedEntry() { this.pipeline.unverifiedEntry = false; this.pipeline.basicEntry = false; this.invalidate('interaction-paused'); }
  drawEyePreview(canvas: HTMLCanvasElement, features: EyeFeatures | null) {
    const context = canvas.getContext('2d'); if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!features || this.video.readyState < 2) return;
    [features.left, features.right].forEach((eye, i) => {
      const r = eye.preview; if (!r) return;
      const w = canvas.width / 2;
      context.drawImage(this.video, r.x * this.video.videoWidth, r.y * this.video.videoHeight, r.width * this.video.videoWidth, r.height * this.video.videoHeight, i * w, 0, w, canvas.height);
      context.strokeStyle = '#d2e3ac'; context.lineWidth = 1.5; context.beginPath();
      context.arc(i * w + (r.irisX - r.x) / r.width * w, (r.irisY - r.y) / r.height * canvas.height, 5, 0, Math.PI * 2); context.stroke();
    });
  }
  subscribeUpdates(fn: (update: CameraUpdate) => void) { this.updateListeners.add(fn); return () => { this.updateListeners.delete(fn); }; }
  subscribeScreenStatus(fn: (status: ScreenStatus) => void) { this.statusListeners.add(fn); return () => { this.statusListeners.delete(fn); }; }
  setMapping(mapping: Mapping | null) { this.pipeline.clear(); this.pipeline.mapping = mapping; this.invalidate('not-calibrated'); }
  setScreenMapping(model: ScreenModel | null) { this.pipeline.basicEntry = false; this.pipeline.unverifiedEntry = false; this.pipeline.screenModel = model; this.pipeline.screenVerified = false; this.invalidate('screen-unverified'); }
  verifyPosition(passed: boolean) { this.pipeline.basicEntry = false; this.pipeline.unverifiedEntry = false; this.pipeline.positionVerified = passed; if (!passed) this.invalidate('position-unverified'); }
  verifyScreen(passed: boolean) { this.pipeline.basicEntry = false; this.pipeline.unverifiedEntry = false; this.pipeline.screenVerified = passed; if (!passed) this.invalidate('screen-unverified'); }
  setInteractionEnabled(enabled: boolean) { this.pipeline.interactionEnabled = enabled; this.invalidate(enabled ? 'screen-settling' : 'interaction-paused'); }
  clearCalibration() { this.pipeline.clear(); this.invalidate('not-calibrated'); }
  private publish(update: CameraUpdate) {
    this.onUpdate(update);
    this.updateListeners.forEach(fn => fn(update));
    this.statusListeners.forEach(fn => fn(update.screen));
    this.sampleListeners.forEach(fn => fn(update.sample));
    this.tracker.process(update.sample).forEach(event => this.eventListeners.forEach(fn => fn(event)));
  }
  private invalidate(reason: string, timestampMs = performance.now(), features: EyeFeatures | null = null, processingMs = 0, pipelineMs = 0) {
    this.pipeline.reset();
    const result = this.pipeline.process({ valid: false, reason }, timestampMs, !!document.fullscreenElement);
    this.publish({ ...result, features, processingMs, pipelineMs });
  }
  async start(delegate: 'CPU' | 'GPU' = 'CPU', resolution: '640' | '1280' = '640') {
    this.stop();
    this.requested = true; this.resolution = resolution;
    const generation = this.generation;
    if (document.hidden || document.documentElement.dataset.exhibitPaused) { this.suspendExhibit(); return; }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法使用摄像头，请用本机 localhost 或 HTTPS 打开');
    this.onStatus('等待摄像头授权');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: Number(resolution) }, height: { ideal: resolution === '1280' ? 720 : 480 }, frameRate: { ideal: 30 } }, audio: false });
    if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
    this.stream = stream; this.video.srcObject = stream;
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (generation === this.generation) { this.stop(); this.onStatus('摄像头已断开，请重新开启'); } });
    try {
      await this.video.play();
      if (generation !== this.generation) return;
      this.onStatus('正在加载本地眼部模型');
      const worker = new Worker(new URL('./gaze.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { this.pendingReject = null; reject(new Error('模型加载超时，请停止后重试')); }, 45000);
        const finish = () => { clearTimeout(timeout); this.pendingReject = null; };
        this.pendingReject = error => { finish(); reject(error); };
        worker.onerror = event => { finish(); const error = new Error(event.message || 'Worker 无法启动'); reject(error); this.stop(); this.onStatus(error.message); };
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          if (generation !== this.generation) return;
          const message = event.data;
          if (message.type === 'ready') { finish(); resolve(); }
          else if (message.type === 'error') { finish(); reject(new Error(message.message)); this.stop(); this.onStatus(`模型错误：${message.message}`); }
          else {
            this.busy = false; this.lastResultMs = performance.now();
            if (this.frameEpoch !== this.visibilityEpoch) { this.invalidate(document.hidden ? 'background' : 'stale-frame'); return; }
            this.process(message.result, message.timestampMs, message.processingMs, performance.now() - this.sentAt);
          }
        };
        const message: WorkerRequest = { type: 'init', baseUrl: new URL(import.meta.env?.BASE_URL ?? '/', location.href).href, delegate };
        worker.postMessage(message);
      });
      if (generation !== this.generation) return;
      this.lastResultMs = performance.now();
      const settings = stream.getVideoTracks()[0].getSettings();
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(settings.deviceId || settings.facingMode || 'default-camera'));
      if (generation !== this.generation) return;
      this.deviceKey = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
      this.onStatus(`摄像头已开启 · ${settings.width}×${settings.height} · ${Math.round(settings.frameRate ?? 0)} FPS · ${delegate}`);
      this.timer = setInterval(() => {
        if (document.hidden) return;
        if (performance.now() - this.lastResultMs > gazeFreshMs) this.invalidate('stale-frame');
        if (this.busy && performance.now() - this.sentAt > 10000) { this.stop(); this.onStatus('推理超时，请重新开启摄像头'); return; }
        void this.capture(generation);
      }, 1000 / 15);
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop();
      throw error;
    }
  }
  private async capture(generation: number) {
    if (this.busy || !this.worker || this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return;
    this.busy = true; this.lastVideoTime = this.video.currentTime;
    const timestampMs = performance.now(); this.sentAt = timestampMs;
    const epoch = this.visibilityEpoch; this.frameEpoch = epoch;
    try {
      const bitmap = await createImageBitmap(this.video);
      if (generation !== this.generation || epoch !== this.visibilityEpoch || !this.worker || document.hidden) { bitmap.close(); if (generation === this.generation) this.busy = false; return; }
      const message: WorkerRequest = { type: 'frame', bitmap, timestampMs };
      this.worker.postMessage(message, [bitmap]);
    } catch {
      if (generation === this.generation) { this.busy = false; this.invalidate('capture-failed'); }
    }
  }
  private process(result: FeatureResult, timestampMs: number, processingMs: number, pipelineMs: number) {
    if (document.hidden) { this.invalidate('background'); return; }
    if (performance.now() - timestampMs > gazeFreshMs) { this.invalidate('stale-frame', timestampMs, null, processingMs, pipelineMs); return; }
    this.publish({ ...this.pipeline.process(result, timestampMs, !!document.fullscreenElement), processingMs, pipelineMs });
  }
  stop() {
    this.requested = false;
    this.deviceKey = '';
    this.generation++;
    this.pendingReject?.(new Error('摄像头启动已取消')); this.pendingReject = null;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    this.worker?.terminate(); this.worker = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.video.pause(); this.video.srcObject = null;
    this.busy = false; this.lastVideoTime = -1; this.pipeline.clear();
    this.invalidate('stopped');
  }
  dispose() { if(this.disposed)return;this.disposed = true; this.resumeOperation++; this.suspended = null; delete document.documentElement.dataset.exhibitCamera; window.removeEventListener('exhibit:pause', this.suspendExhibit); window.removeEventListener('exhibit:resume', this.resumeExhibit); this.stop(); document.removeEventListener('visibilitychange', this.visibility); window.removeEventListener('resize', this.viewportChange); document.removeEventListener('fullscreenchange', this.viewportChange); this.sampleListeners.clear(); this.eventListeners.clear(); this.statusListeners.clear(); this.updateListeners.clear(); }
}
