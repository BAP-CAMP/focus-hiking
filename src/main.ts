import './style.css';

let disposeCurrent: (() => void) | undefined;
addEventListener('exhibit:pause', () => disposeCurrent?.());
addEventListener('exhibit:resume', () => location.reload());
addEventListener('pagehide', () => disposeCurrent?.());
const app = document.querySelector<HTMLElement>('#app')!;
const search=new URLSearchParams(location.search),mode=search.get('mode');
if (mode==='hike'||(!mode&&!search.has('view'))) {
  const {mountHikeExperience}=await import('./hike-experience');
  const dispose=mountHikeExperience(app);
  disposeCurrent=dispose;
  if(import.meta.hot)import.meta.hot.dispose(dispose);
} else if (mode === 'gaze-scene') {
  const { mountGazeScene } = await import('./attention/scene-session');
  const dispose = mountGazeScene(app);
  disposeCurrent=dispose;
  if (import.meta.hot) import.meta.hot.dispose(dispose);
} else if (new URLSearchParams(location.search).get('mode') === 'gaze-test') {
  const { mountGazeTest } = await import('./attention/test-page');
  const dispose = mountGazeTest(app);
  disposeCurrent=dispose;
  if (import.meta.hot) import.meta.hot.dispose(dispose);
} else if (mode === 'explore') {
  const { mountGame } = await import('./game/app');
  const game = mountGame(app);
  disposeCurrent = () => game.dispose();
  if (import.meta.hot) import.meta.hot.dispose(disposeCurrent);
} else {
  const [{ SimulatedAttention }, { mountDiagnostics }, { mountGame }] = await Promise.all([
    import('./attention/simulated'), import('./attention/diagnostics'), import('./game/app'),
  ]);
  const attention = new SimulatedAttention();
  attention.setTargets([{ id: 'diagnostic-only', x: .3, y: .3, width: .4, height: .4, enabled: true }]);
  const game = mountGame(app);
  const off = mountDiagnostics(app, attention);
  disposeCurrent = () => { game.dispose(); off(); attention.dispose(); };
  if (import.meta.hot) import.meta.hot.dispose(disposeCurrent);
}

// A visibility transition may happen while a lazy module is still importing.
if (document.documentElement.dataset.exhibitPaused) disposeCurrent?.();
