/**
 * User-facing commands, shared by buttons, keyboard shortcuts and the ⌘K menu.
 * Each one routes to the scripted demo engine or the live backend.
 */
import { create } from 'zustand';
import type { SystemId } from './contract';
import { uid } from './format';
import { CARRIER_SYSTEMS } from './meta';
import { apply, nowIso, recordRating, resetAll, resetIncident, setHealth, useStore } from './store';
import { makeCtx, type Run } from './demo/engine';
import { breakdown } from './demo/breakdown';
import { COMPARABLE, liveComparable, liveHealth, liveRate, liveStart, liveToggleCarrier } from './live';

export { COMPARABLE };

let run: Run | null = null;
const isLive = () => useStore.getState().mode === 'live';

function stopRun() {
  run?.cleanups.forEach((c) => c());
  if (run) run.cancelled = true;
  run = null;
}

export function startBreakdown() {
  if (isLive()) return void liveStart();
  stopRun();
  run = { cancelled: false, cleanups: [] };
  breakdown(run);
}

export function runComparable() {
  if (isLive()) return void liveComparable();
  // Same conditions as the rated run: every carrier healthy, no stored workarounds.
  for (const system of CARRIER_SYSTEMS) setHealth(system, 'up');
  useStore.setState({ workarounds: [] });
  startBreakdown();
}

export function toggleCarrier(system: SystemId) {
  if (isLive()) return void liveToggleCarrier(system);
  setHealth(system, useStore.getState().systems[system].health === 'down' ? 'up' : 'down');
}

export async function switchMode(mode?: 'demo' | 'live') {
  const next = mode ?? (useStore.getState().mode === 'demo' ? 'live' : 'demo');
  stopRun();
  resetAll();
  if (next === 'live') {
    useStore.setState({ mode: 'live', connection: 'connecting', clockOffset: 0 });
    await liveHealth();
  } else {
    useStore.setState({ mode: 'demo', connection: 'offline' });
  }
}

export function resetView() {
  stopRun();
  if (isLive()) {
    resetIncident();
    void liveHealth();
  } else resetAll();
}

export const toggleSpeed = () => useStore.setState((s) => ({ speed: s.speed === 1 ? 2 : 1 }));

export async function rate(thumbs: 'up' | 'down', reason: string) {
  apply({ type: 'message', message: { id: uid('m'), at: nowIso(), role: 'user', text: `${thumbs === 'up' ? 'Good call' : 'Needs work'}: ${reason}` } });
  if (isLive()) return liveRate(thumbs, reason);
  recordRating({ thumbs, reason });
  const ctx = makeCtx({ cancelled: false, cleanups: [] });
  await ctx.handover('critic', 'Learn from the rating');
  await ctx.tool('critic', 'gemini', 'derive_preference', `"${reason}"`, { ms: 900, summary: 'Ranking-only rule' });
  const cost = /expens|cost|cheap|price/i.test(reason);
  const p = {
    id: `P-00${useStore.getState().preferences.length + 1}`,
    rule: cost ? 'When rescue slack > 60 min, prefer the lowest-cost feasible carrier' : `Reviewed feedback: "${reason}"`,
    condition: 'slack_min > 60',
    effect: cost ? 'rank_by: cost_inr asc' : 'none',
    source_incident: useStore.getState().incident?.id ?? '',
    reason,
    status: cost ? ('active' as const) : ('review' as const),
    created_at: nowIso(),
    applied_count: 0,
  };
  await ctx.tool('critic', 'memory', 'save_preference', p.id, { ms: 500, summary: 'Stored' });
  ctx.emit({ type: 'preference', preference: p });
  await ctx.say(
    'critic',
    cost
      ? `Learned ${p.id}: ${p.rule}. Hard checks never change. Run a comparable incident to see the decision change.`
      : 'Stored for human review; unknown feedback never changes ranking automatically.',
    cost ? [COMPARABLE] : undefined,
  );
}

/* ---------- theme ---------- */

export type Theme = 'dark' | 'light';

function storedTheme(): Theme {
  try {
    const t = localStorage.getItem('gd-theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* storage unavailable */
  }
  return 'dark';
}

export const useTheme = create<{ theme: Theme }>(() => ({ theme: storedTheme() }));

export function applyTheme(theme: Theme = useTheme.getState().theme) {
  document.documentElement.dataset.theme = theme;
}

export function toggleTheme() {
  const theme: Theme = useTheme.getState().theme === 'dark' ? 'light' : 'dark';
  useTheme.setState({ theme });
  applyTheme(theme);
  try {
    localStorage.setItem('gd-theme', theme);
  } catch {
    /* storage unavailable */
  }
}
