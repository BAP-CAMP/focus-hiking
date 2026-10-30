import type { GazeSample } from '../contracts';
import { gazeFreshMs as freshMs } from '../attention/sample-timing';

export type HikePhase = 'idle' | 'running' | 'paused' | 'completed' | 'stopped';
export type GazeState = 'on-screen' | 'off-screen' | 'unknown';
export interface HikeRecord {
  version: 1; id: string; source: 'camera' | 'simulated'; startedAt: string;
  plannedMinutes: 5 | 10 | 15; outcome: 'completed' | 'stopped';
  elapsedMs: number; onScreenMs: number; offScreenMs: number; unknownMs: number;
  departures: number; recoveries: number; distanceM: number;
  focusRatio: number | null; coverageRatio: number; averageFps: number | null;
}
/** Uses the existing AttentionPort samples. Only an explicit stable off-screen
 * reason is an absence; invalid camera/pose/blink samples remain unknown. */
export class HikeSession {
  phase: HikePhase = 'idle';
  elapsedMs = 0; onScreenMs = 0; offScreenMs = 0; unknownMs = 0;
  departures = 0; recoveries = 0; distanceM = 0;
  private lastNow = 0;
  private sample: GazeSample | null = null;
  private latestTimestamp = -Infinity;
  private away = false;
  private stormUntil = 0;
  private pausedStormMs = 0;
  private record: HikeRecord | null = null;
  private startedAt = '';
  private frameMs = 0;
  private frameCount = 0;
  constructor(readonly plannedMinutes: 5 | 10 | 15, readonly source: 'camera' | 'simulated' = 'camera', readonly id = crypto.randomUUID()) {
    if (![5, 10, 15].includes(plannedMinutes)) throw new Error('选择 5、10 或 15 分钟');
  }
  start(now: number, wallTime = new Date().toISOString()) {
    if (this.phase !== 'idle' || !Number.isFinite(now)) return false;
    this.lastNow = now; this.startedAt = wallTime; this.phase = 'running'; return true;
  }
  gazeState(now: number): GazeState {
    const sample = this.sample;
    if (!sample || now < sample.timestampMs || now - sample.timestampMs > freshMs || sample.source !== 'camera') return 'unknown';
    if (sample.valid && sample.x !== null && sample.y !== null && Number.isFinite(sample.x) && Number.isFinite(sample.y) && sample.x >= 0 && sample.x <= 1 && sample.y >= 0 && sample.y <= 1) return 'on-screen';
    return !sample.valid && sample.invalidReason === 'off-screen' ? 'off-screen' : 'unknown';
  }
  accept(sample: GazeSample, now: number) {
    if (this.phase !== 'running' || !Number.isFinite(now)) return;
    this.tick(now);
    if (this.phase !== 'running') return;
    if (!Number.isFinite(sample.timestampMs) || sample.timestampMs <= this.latestTimestamp || sample.timestampMs > now || now - sample.timestampMs > freshMs) return;
    this.latestTimestamp = sample.timestampMs; this.sample = { ...sample };
    const state = this.gazeState(now);
    if (state === 'off-screen' && !this.away) { this.away = true; this.departures++; this.stormUntil = now + 30_000; }
    if (state === 'on-screen' && this.away) { this.away = false; this.recoveries++; this.stormUntil = 0; }
  }
  tick(now: number) {
    if (!Number.isFinite(now) || now < this.lastNow) return;
    if (this.phase !== 'running') { this.lastNow = now; return; }
    const dt = Math.min(now - this.lastNow, this.plannedMinutes * 60_000 - this.elapsedMs);
    const end = this.lastNow + dt;
    const state = this.gazeState(this.lastNow);
    const validMs = state === 'unknown' ? 0 : Math.max(0, Math.min(end, this.sample!.timestampMs + freshMs) - this.lastNow);
    if (state === 'on-screen') this.onScreenMs += validMs;
    if (state === 'off-screen') this.offScreenMs += validMs;
    this.unknownMs += dt - validMs; this.elapsedMs += dt; this.lastNow = now;
    if (this.elapsedMs >= this.plannedMinutes * 60_000) this.finish('completed');
  }
  get remainingMs() { return Math.max(0, this.plannedMinutes * 60_000 - this.elapsedMs); }
  isWalking(now: number) { return this.phase === 'running' && this.gazeState(now) === 'on-screen'; }
  // Once a verified absence starts feedback, a brief camera/renderer gap cannot
  // restart thunder repeatedly. Only a confirmed return or the deadline ends it.
  isStorm(now: number) { return this.away && (this.phase === 'paused' ? this.pausedStormMs > 0 : this.phase === 'running' && now < this.stormUntil); }
  direction(now: number) {
    if (!this.isWalking(now)) return null;
    // Screen ray projected onto horizontal camera space. Vertical gaze changes
    // look elevation; the walker never teleports to a distant gaze intersection.
    return { x: this.sample!.x!, y: this.sample!.y! };
  }
  pause(now: number) { this.tick(now); if (this.phase === 'running') { this.pausedStormMs = Math.max(0, this.stormUntil-now); this.phase = 'paused'; this.sample = null; } }
  resume(now: number) { if (this.phase === 'paused' && Number.isFinite(now)) { this.stormUntil = now + this.pausedStormMs; this.phase = 'running'; this.lastNow = now; this.sample = null; } }
  stop(now: number) { this.tick(now); if (this.phase === 'running' || this.phase === 'paused') this.finish('stopped'); return this.summary(); }
  addMovement(distance: number, dtMs: number) {
    if (this.phase !== 'running') return;
    if (Number.isFinite(distance) && distance >= 0 && distance < 1) this.distanceM += distance;
    if (Number.isFinite(dtMs) && dtMs > 0 && dtMs < 1000) { this.frameCount++; this.frameMs += dtMs; }
  }
  private finish(outcome: 'completed' | 'stopped') {
    if (this.record) return;
    this.phase = outcome; const validMs = this.onScreenMs + this.offScreenMs;
    this.record = { version: 1, id: this.id, source: this.source, startedAt: this.startedAt, plannedMinutes: this.plannedMinutes, outcome,
      elapsedMs: this.elapsedMs, onScreenMs: this.onScreenMs, offScreenMs: this.offScreenMs, unknownMs: this.unknownMs,
      departures: this.departures, recoveries: this.recoveries, distanceM: this.distanceM,
      focusRatio: validMs ? this.onScreenMs / validMs : null, coverageRatio: this.elapsedMs ? validMs / this.elapsedMs : 0,
      averageFps: this.frameMs ? 1000 * this.frameCount / this.frameMs : null };
  }
  summary(): HikeRecord | null { return this.record ? { ...this.record } : null; }
}
