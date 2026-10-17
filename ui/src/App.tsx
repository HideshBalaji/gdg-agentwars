import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Ghost, Play, Power, ThumbsDown, ThumbsUp, Zap } from 'lucide-react';
import clsx from 'clsx';
import { STAGES, type AgentId, type SystemId } from './lib/contract';
import { AGENTS, AGENT_ORDER, SYSTEMS, SYSTEM_ORDER } from './lib/meta';
import { HUBS, PLACES, ROADS } from './lib/fleet';
import { MAP_H, MAP_W, pathD, project } from './lib/geo';
import { fmtClock, fmtCountdown, fmtDur, fmtInr, fmtTime, uid } from './lib/format';
import { apply, nowIso, nowMs, recordRating, resetAll, setHealth, useStore } from './lib/store';
import { makeCtx, type Run } from './lib/demo/engine';
import { breakdown } from './lib/demo/breakdown';
import { liveHealth, liveRate, liveSend, liveStart, liveToggleCarrier } from './lib/live';

let run: Run | null = null;
const isLive = () => useStore.getState().mode === 'live';
function startBreakdown() {
  if (isLive()) return void liveStart();
  run?.cleanups.forEach((c) => c());
  if (run) run.cancelled = true;
  run = { cancelled: false, cleanups: [] };
  breakdown(run);
}
async function rate(thumbs: 'up' | 'down', reason: string) {
  if (isLive()) {
    apply({ type: 'message', message: { id: uid('m'), at: nowIso(), role: 'user', text: `${thumbs === 'up' ? '👍' : '👎'} ${reason}` } });
    return liveRate(thumbs, reason);
  }
  recordRating({ thumbs, reason });
  apply({ type: 'message', message: { id: uid('m'), at: nowIso(), role: 'user', text: `${thumbs === 'up' ? '👍' : '👎'} ${reason}` } });
  const ctx = makeCtx({ cancelled: false, cleanups: [] });
  await ctx.handover('critic', 'Learn from the rating');
  await ctx.tool('critic', 'gemini', 'derive_preference', `"${reason}"`, { ms: 900, summary: 'Ranking-only rule' });
  const cost = /expens|cost|cheap|price/i.test(reason);
  const p = {
    id: `P-00${useStore.getState().preferences.length + 1}`,
    rule: cost ? 'When rescue slack > 60 min, prefer the lowest-cost feasible carrier' : `Reviewed feedback: "${reason}"`,
    condition: 'slack_min > 60', effect: cost ? 'rank_by: cost_inr asc' : 'none',
    source_incident: useStore.getState().incident?.id ?? '', reason, status: cost ? ('active' as const) : ('review' as const),
    created_at: nowIso(), applied_count: 0,
  };
  await ctx.tool('critic', 'memory', 'save_preference', p.id, { ms: 500, summary: 'Stored' });
  ctx.emit({ type: 'preference', preference: p });
  await ctx.say('critic', cost ? `Learned ${p.id}: ${p.rule}. Hard checks never change. Run the incident again and the cheaper carrier wins.` : 'Stored for human review; unknown feedback never changes ranking automatically.');
}

const glass = 'rounded-2xl border border-white/[0.07] bg-night-800/70 backdrop-blur-xl shadow-panel';

export default function App() {
  const s = useStore();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === '1') startBreakdown();
      if (e.key.toLowerCase() === 'k') toggle('carrier_coldline');
    };
    window.addEventListener('keydown', key);
    return () => (clearInterval(t), window.removeEventListener('keydown', key));
  }, []);
  const toggle = (sys: SystemId) =>
    isLive() ? liveToggleCarrier(sys) : setHealth(sys, useStore.getState().systems[sys].health === 'down' ? 'up' : 'down');
  const switchMode = async () => {
    run && (run.cancelled = true);
    resetAll();
    if (s.mode === 'demo') {
      useStore.setState({ mode: 'live', connection: 'connecting', clockOffset: 0 });
      await liveHealth();
    } else useStore.setState({ mode: 'demo', connection: 'offline' });
  };

  return (
    <div className="relative h-screen overflow-hidden bg-void text-ink font-sans">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[600px] w-[600px] rounded-full bg-ice-500/10 blur-3xl animate-drift" />
        <div className="absolute -bottom-40 right-0 h-[600px] w-[600px] rounded-full bg-ghost-500/10 blur-3xl animate-drift" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(148,180,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(148,180,255,0.04)_1px,transparent_1px)] bg-[size:40px_40px]" />
      </div>
      <AnimatePresence>
        {s.alarm > 0 && (
          <motion.div key={s.alarm} initial={{ opacity: 0.7 }} animate={{ opacity: 0 }} transition={{ duration: 1.4 }}
            className="pointer-events-none absolute inset-0 z-50 shadow-[inset_0_0_160px_rgba(244,63,94,0.75)]" />
        )}
      </AnimatePresence>

      <header className="relative z-10 flex h-14 items-center gap-4 border-b border-white/5 px-4">
        <Ghost className="h-6 w-6 text-ice-400 animate-float" />
        <div>
          <div className="font-display text-lg font-semibold tracking-tight">Ghost Dispatcher</div>
          <div className="-mt-1 text-[11px] text-ink-dim">Cold-chain control room</div>
        </div>
        <button onClick={switchMode} title="Switch between scripted demo and the live backend"
          className={clsx('rounded-full border px-2 py-0.5 text-[11px]', s.mode === 'live' ? (s.connection === 'online' ? 'border-mint-500/40 bg-mint-500/10 text-mint-400' : 'border-alarm-500/40 bg-alarm-500/10 text-alarm-400') : 'border-ghost-400/30 bg-ghost-500/10 text-ghost-300')}>
          {s.mode === 'live' ? `LIVE · backend ${s.connection}` : 'DEMO · scripted'} ⇄
        </button>
        <div className="ml-auto flex items-center gap-2">
          {(['carrier_coldline', 'carrier_frostfleet', 'carrier_polar'] as SystemId[]).map((sys) => {
            const down = s.systems[sys].health === 'down';
            const hot = s.chaos?.system === sys;
            return (
              <button key={sys} onClick={() => toggle(sys)}
                className={clsx('flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition',
                  down ? 'border-alarm-500/50 bg-alarm-500/15 text-alarm-400' : 'border-white/10 bg-white/5 hover:bg-white/10',
                  hot && 'animate-pulse ring-2 ring-alarm-500')}>
                <Power className="h-3 w-3" />{SYSTEMS[sys].name} {down ? 'DOWN' : hot ? 'KILL NOW' : 'up'}
              </button>
            );
          })}
          <button onClick={() => useStore.setState({ speed: s.speed === 1 ? 2 : 1 })} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs">{s.speed}×</button>
          <button onClick={() => { run && (run.cancelled = true); resetAll(); }} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs">Reset</button>
          <button onClick={startBreakdown} className="flex items-center gap-1.5 rounded-lg bg-ice-500 px-3 py-1.5 text-xs font-semibold text-void shadow-glow hover:bg-ice-400">
            <Play className="h-3.5 w-3.5" /> Truck breakdown
          </button>
          <div className="ml-2 font-mono text-sm tabular-nums text-ice-300">{fmtClock(nowMs())} IST</div>
        </div>
      </header>

      <main className="relative z-10 grid h-[calc(100vh-3.5rem)] grid-cols-[300px_1fr_400px] gap-3 p-3">
        <section className="flex min-h-0 flex-col gap-3">
          <RescueWindow />
          <div className={clsx(glass, 'min-h-0 flex-1 overflow-auto p-4')}>
            <div className="mb-2 text-[11px] uppercase tracking-widest text-ink-dim">Incident</div>
            {s.incident ? (
              <>
                <div className="font-display text-base font-semibold">{s.incident.title}</div>
                <div className="mb-3 font-mono text-xs text-ink-dim">{s.incident.id} · {s.incident.status}</div>
                <AnimatePresence>
                  {s.incident.facts.map((f) => (
                    <motion.div key={f.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="mb-2 rounded-lg bg-white/[0.03] p-2">
                      <div className="flex justify-between text-[11px] text-ink-dim"><span>{f.label}</span><span className="font-mono">{f.source}{f.confidence ? ` · ${Math.round(f.confidence * 100)}%` : ''}</span></div>
                      <div className={clsx('text-sm', f.tone === 'bad' && 'text-alarm-400', f.tone === 'warn' && 'text-ember-400')}>{f.value}</div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </>
            ) : (
              <div className="text-sm text-ink-muted">All quiet. 10 trucks on the corridor. Press <b>Truck breakdown</b> or key <kbd className="font-mono">1</kbd>.</div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col gap-3">
          <div className={clsx(glass, 'flex items-center gap-1 p-2')}>
            {STAGES.map((st) => {
              const done = s.stagesDone.includes(st.id);
              const cur = s.stage === st.id;
              return (
                <div key={st.id} className="relative flex-1 overflow-hidden rounded-lg px-2 py-1.5 text-center text-xs">
                  {(done || cur) && <motion.div layoutId={cur ? 'stage' : undefined} className={clsx('absolute inset-0', cur ? 'bg-ice-500/25' : 'bg-white/5')} />}
                  <span className={clsx('relative', cur ? 'text-ice-300 font-semibold' : done ? 'text-ink-muted' : 'text-ink-faint')}>{st.label}</span>
                </div>
              );
            })}
          </div>
          <FleetMap />
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
            <div className={clsx(glass, 'min-h-0 overflow-auto p-3')}>
              <div className="mb-2 text-[11px] uppercase tracking-widest text-ink-dim">Plans · validator</div>
              <AnimatePresence>
                {s.plans.map((p) => {
                  const v = s.verdicts[p.id];
                  const sel = s.selected?.plan_id === p.id;
                  return (
                    <motion.div key={p.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: v?.verdict === 'rejected' ? 0.45 : 1, y: 0, x: v?.verdict === 'rejected' ? [0, -6, 6, 0] : 0 }}
                      className={clsx('mb-2 rounded-xl border p-2.5 text-xs', sel ? 'border-ice-400 bg-ice-500/10 shadow-glow' : 'border-white/5 bg-white/[0.03]')}>
                      <div className="flex justify-between"><b className={clsx(v?.verdict === 'rejected' && 'line-through')}>{p.id} · {p.label}</b><span className="font-mono">{fmtInr(p.cost_inr)}</span></div>
                      <div className="mt-0.5 text-ink-dim">{p.eta_to_site_min} min to site · arrives {fmtTime(p.arrival_at)} · slack {fmtDur(p.slack_min)}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(s.checks[p.id] ?? []).map((c) => (
                          <span key={c.id} title={c.detail} className={clsx('rounded px-1.5 py-0.5', c.status === 'pass' ? 'bg-mint-500/15 text-mint-400' : c.status === 'fail' ? 'bg-alarm-500/15 text-alarm-400' : 'bg-white/5 text-ink-dim')}>
                            {c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '…'} {c.label}
                          </span>
                        ))}
                      </div>
                      {v?.reason && <div className="mt-1 text-alarm-400">{v.reason}</div>}
                      {sel && <div className="mt-1 text-ice-300">★ {s.selected?.reason}</div>}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
            <div className={clsx(glass, 'min-h-0 overflow-auto p-3')}>
              <div className="mb-2 text-[11px] uppercase tracking-widest text-ink-dim">Healing log · actions · memory</div>
              <AnimatePresence>
                {s.healing.map((h) => (
                  <motion.div key={h.id} layout initial={{ opacity: 0, backgroundColor: 'rgba(244,63,94,0.35)' }} animate={{ opacity: 1, backgroundColor: 'rgba(255,255,255,0.03)' }}
                    className="mb-1.5 rounded-lg p-2 font-mono text-[11px]">
                    <span className={clsx('mr-1.5 rounded px-1 uppercase', h.result === 'recovered' ? 'bg-mint-500/20 text-mint-400' : h.result === 'failed' ? 'bg-alarm-500/20 text-alarm-400' : 'bg-ember-500/20 text-ember-400')}>{h.level}</span>
                    {h.tool}{h.provider ? ` · ${h.provider}` : ''}<div className="text-ink-dim">{h.failure} → {h.remedy}</div>
                  </motion.div>
                ))}
                {s.actions.map((a) => (
                  <motion.div key={a.id} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="mb-1.5 rounded-lg bg-white/[0.03] p-2 text-[11px]">
                    <span className={clsx('mr-1.5', a.status === 'confirmed' ? 'text-mint-400' : 'text-ember-400')}>●</span>{a.title}<span className="ml-1 text-ink-dim">· {a.detail} · simulated</span>
                  </motion.div>
                ))}
                {[...s.preferences, ...s.workarounds.map((w) => ({ id: w.id, rule: `${w.provider}: ${w.note}` }))].map((p) => (
                  <motion.div key={p.id} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mb-1.5 rounded-lg border border-ghost-400/30 bg-ghost-500/10 p-2 text-[11px] text-ghost-300">🧠 {p.id.startsWith('P-') ? `${p.id} · ` : ''}{p.rule}</motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col gap-3">
          <Constellation />
          <Chat />
        </section>
      </main>
      <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 space-y-2">
        <AnimatePresence>
          {s.toasts.map((t) => (
            <motion.div key={t.id} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}
              className={clsx('rounded-xl border px-4 py-2 text-sm backdrop-blur-xl', t.tone === 'bad' ? 'border-alarm-500/40 bg-alarm-500/20' : t.tone === 'learn' ? 'border-ghost-400/40 bg-ghost-500/20' : 'border-mint-500/40 bg-mint-500/15')}>
              <b>{t.title}</b> <span className="text-ink-muted">{t.body}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function RescueWindow() {
  const inc = useStore((s) => s.incident);
  const telemetry = useStore((s) => s.telemetry);
  const left = inc?.rescue_deadline ? Date.parse(inc.rescue_deadline) - nowMs() : 0;
  const frac = inc?.rescue_deadline ? Math.max(0, Math.min(1, left / (240 * 60_000))) : 1;
  const color = frac > 0.5 ? '#22d3ee' : frac > 0.25 ? '#fbbf24' : '#f43f5e';
  const R = 70;
  const C = 2 * Math.PI * R;
  const last = telemetry[telemetry.length - 1];
  return (
    <div className={clsx(glass, 'flex flex-col items-center p-4')}>
      <div className="self-start text-[11px] uppercase tracking-widest text-ink-dim">Rescue window</div>
      <svg viewBox="0 0 180 180" className="h-44 w-44">
        <circle cx="90" cy="90" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
        <motion.circle cx="90" cy="90" r={R} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" transform="rotate(-90 90 90)"
          strokeDasharray={C} animate={{ strokeDashoffset: C * (1 - frac) }} transition={{ duration: 1 }} style={{ filter: `drop-shadow(0 0 8px ${color})` }} />
        <text x="90" y="88" textAnchor="middle" className="fill-ink font-mono text-[20px]">{inc?.rescue_deadline ? fmtCountdown(left) : '--:--:--'}</text>
        <text x="90" y="108" textAnchor="middle" className="fill-ink-dim text-[9px]">{inc?.rescue_deadline ? 'demo estimate' : 'standby'}</text>
      </svg>
      {last && (
        <div className="w-full">
          <div className="flex justify-between text-xs"><span className="text-ink-dim">Cargo temp</span><span className="font-mono text-ember-400">{last.temp_c.toFixed(2)} °C / 8 °C max</span></div>
          <svg viewBox="0 0 200 40" className="mt-1 h-10 w-full">
            <line x1="0" x2="200" y1={40 - (8 - 3) * 6} y2={40 - (8 - 3) * 6} stroke="#f43f5e" strokeDasharray="3 3" strokeWidth="0.8" />
            <polyline fill="none" stroke="#fbbf24" strokeWidth="1.5" points={telemetry.map((r, i) => `${(i / Math.max(1, telemetry.length - 1)) * 200},${40 - (r.temp_c - 3) * 6}`).join(' ')} />
          </svg>
        </div>
      )}
    </div>
  );
}

function FleetMap() {
  const { trucks, routes, incident, focus, plans, verdicts, selected, sweepAt } = useStore();
  const c = project(focus.center);
  const w = MAP_W / focus.zoom;
  const h = MAP_H / focus.zoom;
  const vb = `${c.x - w / 2} ${c.y - h / 2} ${w} ${h}`;
  const planTruck = Object.fromEntries(plans.map((p) => [p.truck_id, p]));
  return (
    <div className={clsx(glass, 'relative min-h-0 flex-[1.3] overflow-hidden')}>
      <motion.svg className="h-full w-full" preserveAspectRatio="xMidYMid slice" initial={{ viewBox: vb }} animate={{ viewBox: vb }} transition={{ duration: 1.6, ease: 'easeInOut' }}>
        {ROADS.map((r) => <path key={r.id} d={pathD(r.path)} fill="none" stroke={r.major ? 'rgba(103,232,249,0.35)' : 'rgba(148,180,255,0.12)'} strokeWidth={r.major ? 3 : 1.5} />)}
        {PLACES.map((p) => { const q = project(p); return <g key={p.id}><circle cx={q.x} cy={q.y} r="3" fill="#5b6a84" /><text x={q.x + 6} y={q.y - 6} className="fill-ink-dim text-[13px]">{p.name}</text></g>; })}
        {HUBS.map((hb) => { const q = project(hb); return <g key={hb.id}><rect x={q.x - 6} y={q.y - 6} width="12" height="12" rx="3" fill="#8b74f8" opacity="0.8" /><text x={q.x + 9} y={q.y + 4} className="fill-ghost-300 text-[10px]">{hb.name}</text></g>; })}
        {routes.map((r) => (
          <motion.path key={r.id} d={pathD(r.path)} fill="none" stroke={r.kind === 'rescue' ? '#4ade80' : '#22d3ee'} strokeWidth="4" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: r.duration_s ?? 3 }} style={{ filter: 'drop-shadow(0 0 6px #22d3ee)' }} />
        ))}
        {incident?.location && (() => {
          const q = project(incident.location);
          return (
            <g>
              {[0, 1, 2].map((i) => <motion.circle key={i} cx={q.x} cy={q.y} r="10" fill="none" stroke="#f43f5e" strokeWidth="2" animate={{ r: [10, 60], opacity: [0.8, 0] }} transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8 }} />)}
              <motion.circle key={sweepAt} cx={q.x} cy={q.y} fill="rgba(34,211,238,0.08)" stroke="#22d3ee" initial={{ r: 0, opacity: 1 }} animate={{ r: 260, opacity: 0 }} transition={{ duration: 2 }} />
            </g>
          );
        })()}
        {Object.values(trucks).map((t) => {
          const route = [...routes].reverse().find((r) => r.truck_id === t.id);
          const p = planTruck[t.id];
          const rejected = p && verdicts[p.id]?.verdict === 'rejected';
          const sel = p && selected?.plan_id === p.id;
          const color = t.status === 'broken' ? '#f43f5e' : sel ? '#4ade80' : rejected ? '#5b6a84' : p ? '#fbbf24' : t.reefer ? '#67e8f9' : '#93a3bd';
          const pts = route ? route.path.map(project) : [project(t)];
          return (
            <motion.g key={t.id + (route?.id ?? '')} initial={{ x: pts[0].x, y: pts[0].y }} animate={{ x: pts.map((q) => q.x), y: pts.map((q) => q.y) }} transition={{ duration: route?.duration_s ?? 0, ease: 'linear' }}>
              <circle r={sel || t.status === 'broken' ? 9 : 6} fill={color} stroke="#04060c" strokeWidth="2" style={{ filter: `drop-shadow(0 0 6px ${color})` }} />
              <text x="11" y="4" className="font-mono text-[11px]" fill={color}>{t.id}{rejected ? ' ✗' : ''}</text>
            </motion.g>
          );
        })}
      </motion.svg>
      <div className="absolute left-3 top-3 text-[11px] uppercase tracking-widest text-ink-dim">NH-48 corridor · Bengaluru ↔ Hosur</div>
    </div>
  );
}

function Constellation() {
  const { owner, agentStatus, handoverSeq, lastHandover, systems } = useStore();
  const pos = (id: AgentId) => {
    if (id === 'dispatcher') return { x: 50, y: 50 };
    const i = AGENT_ORDER.indexOf(id);
    const a = (i / AGENT_ORDER.length) * Math.PI * 2 - Math.PI / 2;
    return { x: 50 + Math.cos(a) * 38, y: 50 + Math.sin(a) * 38 };
  };
  return (
    <div className={clsx(glass, 'p-3')}>
      <div className="text-[11px] uppercase tracking-widest text-ink-dim">Agents · {AGENTS[owner].name} owns the conversation</div>
      <div className="relative mx-auto aspect-square w-full max-w-[250px]">
        <svg viewBox="0 0 100 100" className="absolute inset-0">
          <motion.circle cx="50" cy="50" r="38" fill="none" stroke="rgba(148,180,255,0.12)" strokeDasharray="1 2" animate={{ rotate: 360 }} transition={{ duration: 60, repeat: Infinity, ease: 'linear' }} style={{ originX: '50px', originY: '50px' }} />
          {AGENT_ORDER.map((id) => { const p = pos(id); return <line key={id} x1="50" y1="50" x2={p.x} y2={p.y} stroke="rgba(148,180,255,0.1)" strokeWidth="0.4" />; })}
          {lastHandover && (() => {
            const a = pos(lastHandover.from); const b = pos(lastHandover.to);
            return <motion.circle key={handoverSeq} r="1.8" fill={AGENTS[lastHandover.to].color} initial={{ cx: a.x, cy: a.y, opacity: 1 }} animate={{ cx: b.x, cy: b.y, opacity: [1, 1, 0] }} transition={{ duration: 0.8 }} style={{ filter: `drop-shadow(0 0 2px ${AGENTS[lastHandover.to].color})` }} />;
          })()}
        </svg>
        {(['dispatcher', ...AGENT_ORDER] as AgentId[]).map((id) => {
          const a = AGENTS[id]; const p = pos(id); const Icon = a.icon;
          const active = owner === id; const busy = agentStatus[id]?.status && agentStatus[id]?.status !== 'idle';
          return (
            <div key={id} className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
              <motion.div animate={{ scale: active ? 1.2 : 1, boxShadow: active || busy ? `0 0 22px ${a.color}` : '0 0 0px transparent' }}
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border bg-night-900" style={{ borderColor: active || busy ? a.color : 'rgba(255,255,255,0.1)' }}>
                <Icon className="h-4 w-4" style={{ color: a.color }} />
              </motion.div>
              <div className="mt-0.5 whitespace-nowrap text-[9px] text-ink-muted">{a.name}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {SYSTEM_ORDER.map((id) => (
          <motion.span key={id + systems[id].pulse} initial={{ backgroundColor: 'rgba(34,211,238,0.4)' }} animate={{ backgroundColor: 'rgba(255,255,255,0.04)' }} transition={{ duration: 1 }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]">
            <span className={clsx('h-1.5 w-1.5 rounded-full', systems[id].health === 'down' ? 'bg-alarm-500 animate-blink' : 'bg-mint-400')} />{SYSTEMS[id].name}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

function Chat() {
  const { feed, tools, typing, ratingRequested } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState('Too expensive — we had 2 h of slack, prefer the cheaper carrier');
  const [draft, setDraft] = useState('');
  const send = () => {
    if (!draft.trim()) return;
    if (useStore.getState().mode === 'live') liveSend(draft.trim());
    else apply({ type: 'message', message: { id: uid('m'), at: nowIso(), role: 'user', text: draft.trim() } });
    setDraft('');
  };
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' }); }, [feed.length, typing, ratingRequested]);
  return (
    <div className={clsx(glass, 'flex min-h-0 flex-1 flex-col')}>
      <div className="border-b border-white/5 px-4 py-2 text-[11px] uppercase tracking-widest text-ink-dim">Conversation</div>
      <div ref={ref} className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        <AnimatePresence initial={false}>
          {feed.map((f) => {
            if (f.kind === 'handover') return (
              <motion.div key={f.id} initial={{ opacity: 0, scaleX: 0.6 }} animate={{ opacity: 1, scaleX: 1 }} className="py-1 text-center text-[10px] text-ink-dim">
                <span style={{ color: AGENTS[f.from].color }}>{AGENTS[f.from].name}</span> → <span style={{ color: AGENTS[f.to].color }}>{AGENTS[f.to].name}</span> · {f.reason}
              </motion.div>
            );
            if (f.kind === 'tool') {
              const t = tools[f.id];
              return (
                <motion.div key={f.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="rounded-md bg-black/30 px-2 py-1 font-mono text-[10px]">
                  <span className={t.status === 'error' ? 'text-alarm-400' : t.status === 'ok' ? 'text-mint-400' : 'text-ember-400'}>{t.status === 'running' ? '⟳' : t.status === 'ok' ? '✓' : '✗'}</span>{' '}
                  <span style={{ color: AGENTS[t.agent].color }}>{t.agent}</span> → {SYSTEMS[t.system].name}.{t.tool}({t.args}) <span className="text-ink-dim">{t.summary}{t.latency_ms ? ` · ${t.latency_ms}ms` : ''}</span>
                </motion.div>
              );
            }
            const m = f.message;
            const a = m.agent ? AGENTS[m.agent] : null;
            return (
              <motion.div key={f.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className={clsx('rounded-xl p-2.5 text-sm', m.role === 'system' ? 'border border-alarm-500/30 bg-alarm-500/10 text-alarm-400' : m.role === 'user' ? 'ml-8 bg-ice-500/15' : m.role === 'external' ? 'mr-8 bg-white/[0.05]' : 'mr-4 bg-white/[0.03]')}>
                <div className="mb-0.5 text-[10px]" style={{ color: a?.color }}>{a ? `${a.name} · ${a.model}` : m.author ?? (m.role === 'user' ? 'You' : 'System')} · {fmtTime(m.at)}</div>
                {m.text}
                {m.attachments?.map((ev) => ev.kind === 'photo'
                  ? <img key={ev.id} src={ev.url} alt={ev.name} className="mt-2 w-full rounded-lg border border-white/10" />
                  : <div key={ev.id} className="mt-2 rounded-lg bg-black/30 p-2 text-xs"><audio controls src={ev.url} className="h-8 w-full" /><div className="mt-1 italic text-ink-muted">“{ev.transcript}”</div></div>)}
              </motion.div>
            );
          })}
        </AnimatePresence>
        {typing && <div className="text-xs text-ink-dim"><span style={{ color: AGENTS[typing].color }}>{AGENTS[typing].name}</span> is thinking<span className="animate-blink">…</span></div>}
      </div>
      <AnimatePresence>
        {ratingRequested && (
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} className="border-t border-white/5 p-3">
            <div className="mb-1 text-xs text-ink-muted">Rate this decision</div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="mb-2 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs outline-none" />
            <div className="flex gap-2">
              <button onClick={() => rate('up', reason)} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-mint-500/20 py-1.5 text-xs text-mint-400"><ThumbsUp className="h-3.5 w-3.5" /> Good call</button>
              <button onClick={() => rate('down', reason)} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-alarm-500/20 py-1.5 text-xs text-alarm-400"><ThumbsDown className="h-3.5 w-3.5" /> Needs work</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border-t border-white/5 p-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message the active agent… e.g. Why this vehicle?"
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs outline-none focus:border-ice-400/50" />
      </form>
      <div className="flex items-center gap-1 border-t border-white/5 px-3 py-2 text-[10px] text-ink-dim"><Zap className="h-3 w-3" /> Keys: 1 = breakdown · K = kill/revive ColdLine · badge ⇄ switches demo/live</div>
    </div>
  );
}
