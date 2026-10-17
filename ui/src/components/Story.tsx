import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, FileText, FolderOpen, Loader2, Mic, Paperclip, Play, RotateCcw, ScrollText, ShieldCheck, Sparkles, TriangleAlert, X } from 'lucide-react';
import { STAGES, type AgentId, type ChatMessage, type Stage } from '../lib/contract';
import { AGENTS, SYSTEMS } from '../lib/meta';
import { fmtDur, fmtInr, fmtTime } from '../lib/format';
import { nowMs, useStore, type State } from '../lib/store';
import { runComparable, startBreakdown, switchMode } from '../lib/actions';
import { ACCEPT_ATTR, addFiles, addSamples, fmtBytes, removePending, toggleRecording } from '../lib/evidence';
import { ActionRow, Attachment, ChaosCallout, HealingRow, QualityBadge, RatingCard } from './Activity';
import { Comparison, Plans } from './Panels';
import { MapPanel } from './MapView';
import { CHAT_REPLY } from '../lib/demo/chat';
import { MetricsCard, useTick } from './Metrics';
import { AgentAvatar, Button, Kbd, Pill } from './ui';

/* ---------- step copy ---------- */

const STEP: Record<Stage, { title: string; agents: AgentId[]; now: string }> = {
  detect: { title: 'Detect', agents: ['dispatcher'], now: 'A truck has reported a breakdown. Ghost Dispatcher is opening a rescue.' },
  understand: { title: 'Understand', agents: ['intake'], now: "Reading the driver's photo, voice note and sensor data to work out what happened." },
  replan: { title: 'Find options', agents: ['route_risk'], now: 'Looking for refrigerated trucks that can reach the cargo before it spoils.' },
  validate: { title: 'Check and choose', agents: ['validator', 'dispatcher'], now: 'Checking every option against hard rules, then choosing the best one.' },
  act: { title: 'Book the rescue', agents: ['negotiator', 'watchdog'], now: 'Booking the rescue truck and moving the cargo onto it.' },
  notify: { title: 'Notify', agents: ['comms'], now: 'Telling the receiver, rebooking the dock and updating the fleet sheet.' },
  learn: { title: 'Learn', agents: ['critic'], now: 'Rescue complete. Rate the decision so the system can learn from it.' },
};

const NOTIFY_KINDS = new Set(['dock', 'sheet', 'email', 'calendar']);
const ACT_KINDS = new Set(['booking', 'assign', 'reroute', 'claim']);

/* ---------- Now banner ---------- */

export function NowBanner({ onLog }: { onLog: () => void }) {
  useTick();
  const s = useStore();
  const inc = s.incident!;
  const stage = s.stage ?? 'detect';
  const idx = STAGES.findIndex((x) => x.id === stage);
  const resolved = inc.status === 'resolved';
  const recovering = s.healing.some((h) => h.result === 'in_progress' && h.level !== 'validation');
  const running = Object.values(s.tools).filter((t) => t.status === 'running').pop();

  const headline = recovering
    ? 'A provider failed. Ghost Dispatcher is recovering on its own.'
    : s.chaos
      ? 'Booking the rescue truck. This is the moment to inject a failure.'
      : resolved && s.comparison
        ? 'Same incident, cheaper decision, learned from your feedback.'
        : resolved && s.ratingRequested
          ? 'Rescue complete. Rate the decision so the system can learn from it.'
          : resolved
            ? 'Rescue complete.'
            : STEP[stage].now;

  const actor: AgentId = running?.agent ?? s.typing ?? s.owner;
  const detail = running
    ? <>calling <span className="font-mono text-fg-2">{SYSTEMS[running.system].name}.{running.tool}</span></>
    : s.typing
      ? 'is thinking…'
      : 'has the conversation';
  const elapsed = (nowMs() - Date.parse(inc.detected_at)) / 60_000;
  const tone = recovering || s.chaos ? 'amber' : resolved ? 'green' : 'accent';

  return (
    <section className={clsx('rounded-lg border bg-surface p-4', tone === 'amber' ? 'border-amber/40' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-3">
        <span className="flex items-center gap-1.5 font-medium uppercase tracking-wide">
          <span className={clsx('h-1.5 w-1.5 rounded-full', tone === 'amber' ? 'bg-amber' : tone === 'green' ? 'bg-green' : 'bg-accent', !resolved && 'animate-pulse')} />
          {resolved ? 'Done' : 'Now'}
        </span>
        <span>Step {idx + 1} of {STAGES.length} · {STEP[stage].title}</span>
        <span className="font-mono">{fmtDur(elapsed)} since detection</span>
        <button type="button" onClick={onLog} className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-fg-3 hover:bg-surface-2 hover:text-fg">
          <ScrollText className="h-3.5 w-3.5" /> Agent log <Kbd>L</Kbd>
        </button>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={headline} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
          className="mt-2 text-lg font-semibold leading-snug tracking-tight text-fg">
          {headline}
        </motion.p>
      </AnimatePresence>
      <div className={clsx(s.chaos && 'mt-3')}><ChaosCallout /></div>
      {s.comparison && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-violet/30 bg-violet/[0.06] px-2.5 py-1.5 text-xs">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet" />
          <span className="text-fg-2">Learned from your rating:</span>
          <span className="text-fg-3 line-through">{s.comparison.before.truck_id} · {s.comparison.before.carrier_id} {fmtInr(s.comparison.before.cost)}</span>
          <span className="text-fg-4">→</span>
          <span className="font-medium text-fg">{s.comparison.after.truck_id} · {s.comparison.after.carrier_id} {fmtInr(s.comparison.after.cost)}</span>
          {s.comparison.before.cost > s.comparison.after.cost && <span className="font-medium text-green">saves {fmtInr(s.comparison.before.cost - s.comparison.after.cost)}</span>}
        </div>
      )}
      {!resolved && (
        <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-fg-3">
          <AgentAvatar agent={actor} size={18} />
          <span className="font-medium text-fg-2">{AGENTS[actor].name}</span>
          <span className="truncate">{detail}</span>
          {(running || s.typing) && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
        </div>
      )}
      <div className="mt-3 flex gap-1" aria-hidden>
        {STAGES.map((st, i) => (
          <span key={st.id} className={clsx('h-1 flex-1 rounded-full transition-colors duration-300', i < idx || resolved ? 'bg-green/70' : i === idx ? (tone === 'amber' ? 'bg-amber' : 'bg-accent') : 'bg-surface-3')} />
        ))}
      </div>
    </section>
  );
}

/* ---------- step list ---------- */

export function StepList() {
  const s = useStore();
  const stage = s.stage ?? 'detect';
  const idx = STAGES.findIndex((x) => x.id === stage);
  const resolved = s.incident?.status === 'resolved';
  const [open, setOpen] = useState<Set<Stage>>(new Set());
  // A new incident starts with everything folded except the live step.
  useEffect(() => setOpen(new Set()), [s.incident?.id]);

  return (
    <ol className="relative">
      {STAGES.map((st, i) => {
        const state: 'done' | 'active' | 'pending' = i < idx || (resolved && i < STAGES.length - 1) ? 'done' : i === idx ? 'active' : 'pending';
        const expanded = state === 'active' || open.has(st.id);
        const toggle = () => state === 'done' && setOpen((o) => {
          const n = new Set(o);
          if (n.has(st.id)) n.delete(st.id);
          else n.add(st.id);
          return n;
        });
        return (
          <li key={st.id} className="relative pb-1 pl-9">
            {i < STAGES.length - 1 && <span className={clsx('absolute bottom-0 left-[11px] top-7 w-px', state === 'done' ? 'bg-green/40' : 'bg-line')} />}
            <StepDot state={state} n={i + 1} recovering={st.id === 'act' && s.healing.some((h) => h.result === 'in_progress' && h.level !== 'validation')} />
            <button type="button" onClick={toggle} disabled={state !== 'done'}
              className={clsx('flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left', state === 'done' && 'hover:bg-surface-2/60', state === 'pending' && 'cursor-default')}>
              <span className={clsx('shrink-0 text-sm font-medium', state === 'pending' ? 'text-fg-4' : 'text-fg')}>{STEP[st.id].title}</span>
              {state === 'done' && !expanded && <span className="min-w-0 truncate text-xs text-fg-3">{summary(st.id, s)}</span>}
              <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
                {state !== 'pending' && (
                  <span className="flex -space-x-1">{STEP[st.id].agents.map((a) => <AgentAvatar key={a} agent={a} size={16} />)}</span>
                )}
                {s.stageTimes[st.id] && <time className="font-mono text-[10px] text-fg-4">{fmtTime(s.stageTimes[st.id])}</time>}
                {state === 'done' && <ChevronDown className={clsx('h-3.5 w-3.5 text-fg-4 transition-transform', expanded && 'rotate-180')} />}
              </span>
            </button>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="overflow-hidden">
                  <div className="space-y-2.5 pb-4 pt-1.5">
                    <StepBody stage={st.id} live={state === 'active'} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        );
      })}
    </ol>
  );
}

function StepDot({ state, n, recovering }: { state: 'done' | 'active' | 'pending'; n: number; recovering?: boolean }) {
  return (
    <span className={clsx('absolute left-0 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium',
      state === 'done' ? 'bg-green/15 text-green' : state === 'active' ? (recovering ? 'bg-amber text-white' : 'bg-accent text-white') : 'border border-dashed border-line-strong text-fg-4')}>
      {state === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : state === 'active' ? (
        <>
          <span className={clsx('absolute inset-0 animate-ping2 rounded-full', recovering ? 'bg-amber/40' : 'bg-accent/40')} />
          <span className="relative">{n}</span>
        </>
      ) : n}
    </span>
  );
}

/** One-line summaries for finished steps. */
function summary(stage: Stage, s: State): string {
  const inc = s.incident;
  if (!inc) return '';
  const plan = s.plans.find((p) => p.id === s.selected?.plan_id);
  switch (stage) {
    case 'detect':
      return `${inc.truck_id ?? 'Truck'} reported a breakdown${inc.location ? ` at ${inc.location.name}` : ''}${inc.evidence.length ? ` · ${inc.evidence.length} evidence file${inc.evidence.length > 1 ? 's' : ''}` : ''}`;
    case 'understand': {
      const keys = ['Failure', 'Cargo', 'Rescue window', 'Cold-restore deadline'];
      const facts = keys.map((k) => inc.facts.find((f) => f.label === k)).filter(Boolean).map((f) => f!.value);
      return facts.length ? facts.slice(0, 3).join(' · ') : `${inc.facts.length} facts extracted`;
    }
    case 'replan':
      return `${s.plans.length} option${s.plans.length === 1 ? '' : 's'} considered`;
    case 'validate': {
      const rejected = s.plans.filter((p) => s.verdicts[p.id]?.verdict === 'rejected').length;
      return `${rejected} ruled out${plan ? ` · chose ${plan.label}` : ''}${s.comparison ? ` · changed by feedback (${s.comparison.preferences.join(', ') || 'learned'})` : ''}`;
    }
    case 'act': {
      const booking = [...s.actions].reverse().find((a) => a.kind === 'booking' && a.status === 'confirmed');
      const fell = s.healing.some((h) => h.level === 'fallback');
      return booking ? `${booking.title}${fell ? ' · recovered from a provider failure' : ''}` : 'Booking attempted';
    }
    case 'notify': {
      const n = s.actions.filter((a) => NOTIFY_KINDS.has(a.kind)).length;
      return `${n} update${n === 1 ? '' : 's'} sent: dock, fleet sheet, receiver`;
    }
    case 'learn':
      return s.outcome?.headline ?? '';
  }
}

function windowOf(stage: Stage, s: State): [number, number] {
  const i = STAGES.findIndex((x) => x.id === stage);
  const start = s.stageTimes[stage] ? Date.parse(s.stageTimes[stage]!) : -Infinity;
  const later = STAGES.slice(i + 1).map((x) => s.stageTimes[x.id]).filter(Boolean).map((t) => Date.parse(t!));
  return [start, later.length ? Math.min(...later) : Infinity];
}

function messagesIn(stage: Stage, s: State, pick: (m: ChatMessage) => boolean): ChatMessage[] {
  const [a, b] = windowOf(stage, s);
  return s.feed
    .filter((f) => f.kind === 'message')
    .map((f) => (f as { message: ChatMessage }).message)
    .filter((m) => pick(m) && Date.parse(m.at) >= a - 1 && Date.parse(m.at) < b);
}

function StepBody({ stage, live }: { stage: Stage; live: boolean }) {
  const s = useStore();
  const inc = s.incident!;
  const quote = (agents: AgentId[]) => {
    const msgs = messagesIn(stage, s, (m) => m.role === 'agent' && !!m.agent && agents.includes(m.agent) && m.author !== CHAT_REPLY);
    const m = msgs[msgs.length - 1];
    return m ? <Quote message={m} /> : live ? <Waiting /> : null;
  };

  switch (stage) {
    case 'detect': {
      const reports = messagesIn(stage, s, (m) => m.role === 'external' || m.role === 'system');
      return (
        <>
          {reports.map((m) => <Report key={m.id} message={m} />)}
          {!reports.length && <Waiting />}
        </>
      );
    }
    case 'understand':
      return (
        <>
          {quote(['intake'])}
          <PrivacyNote />
          {inc.facts.length > 0 && (
            <dl className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {inc.facts.map((f) => (
                <div key={f.id} className="grid grid-cols-[minmax(110px,30%)_1fr_auto] items-baseline gap-3 px-3 py-1.5 text-xs">
                  <dt className="text-fg-3">{f.label}</dt>
                  <dd className={clsx(f.tone === 'bad' ? 'text-red' : f.tone === 'warn' ? 'text-amber' : 'text-fg')}>{f.value}</dd>
                  <span className="font-mono text-[10px] text-fg-4">{f.source}{f.confidence ? ` ${Math.round(f.confidence * 100)}%` : ''}</span>
                </div>
              ))}
            </dl>
          )}
        </>
      );
    case 'replan':
      return (
        <>
          {quote(['route_risk'])}
          {s.plans.length > 0 && <div className="overflow-hidden rounded-lg border border-line bg-surface"><Plans /></div>}
        </>
      );
    case 'validate': {
      const rejected = s.plans.filter((p) => s.verdicts[p.id]?.verdict === 'rejected');
      const plan = s.plans.find((p) => p.id === s.selected?.plan_id);
      return (
        <>
          {rejected.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-line bg-surface p-3 text-xs">
              {rejected.map((p) => (
                <li key={p.id} className="flex gap-2"><X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red" /><span><span className="font-medium text-fg-2">{p.label}</span> <span className="text-fg-3">· {s.verdicts[p.id]?.reason}</span></span></li>
              ))}
            </ul>
          )}
          {plan ? (
            <div className="rounded-lg border border-accent/30 bg-accent/[0.05] p-3 text-xs">
              <div className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-accent" /><span className="font-medium text-fg">Chose {plan.label}</span>
                {!!s.selected?.preferences?.length && <Pill tone="violet"><Sparkles className="h-3 w-3" />{s.selected.preferences.join(', ')}</Pill>}</div>
              <p className="mt-1 text-fg-3">{s.selected?.reason}</p>
            </div>
          ) : live ? <Waiting /> : null}
          {s.comparison && <Comparison />}
        </>
      );
    }
    case 'act': {
      const acts = s.actions.filter((a) => ACT_KINDS.has(a.kind));
      const heals = s.healing.filter((h) => h.level !== 'validation' && !(h.tool === 'compute_routes'));
      return (
        <>
          {quote(['negotiator', 'watchdog'])}
          {heals.length > 0 && <div>{heals.map((h) => <HealingRow key={h.id} id={h.id} indent={false} />)}</div>}
          {acts.length > 0 && <div className="rounded-lg border border-line bg-surface px-3 py-1.5">{acts.map((a) => <ActionRow key={a.id} id={a.id} indent={false} />)}</div>}
        </>
      );
    }
    case 'notify': {
      const acts = s.actions.filter((a) => NOTIFY_KINDS.has(a.kind));
      const replies = messagesIn(stage, s, (m) => m.role === 'external');
      return (
        <>
          {acts.length > 0 ? <div className="rounded-lg border border-line bg-surface px-3 py-1.5">{acts.map((a) => <ActionRow key={a.id} id={a.id} indent={false} />)}</div> : live ? <Waiting /> : null}
          {replies.map((m) => <Report key={m.id} message={m} />)}
        </>
      );
    }
    case 'learn':
      return <LearnBody />;
  }
}

function LearnBody() {
  const s = useStore();
  const pref = [...s.preferences].reverse().find((p) => p.status === 'active');
  const critic = messagesIn('learn', s, (m) => m.role === 'agent' && m.agent === 'critic').pop();
  return (
    <>
      {s.outcome && (
        <div className="rounded-lg border border-green/30 bg-green/[0.05] p-3 text-xs">
          <div className="flex items-center gap-2 font-medium text-fg"><Check className="h-3.5 w-3.5 text-green" />{s.outcome.headline}</div>
          <p className="mt-1 text-fg-3">{s.outcome.actions} actions · {s.outcome.healed} recovery steps · all simulated</p>
        </div>
      )}
      <SafetySummary />
      <RatingCard />
      {s.comparison && <Comparison />}
      {critic && <Quote message={critic} />}
      {pref && !s.comparison && s.rating && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-violet/30 bg-violet/[0.05] p-3 text-xs">
          <Sparkles className="h-4 w-4 text-violet" />
          <div className="min-w-0 flex-1"><span className="font-mono font-medium">{pref.id}</span> <span className="text-fg-2">{pref.rule}</span></div>
          <Button variant="primary" size="sm" icon={RotateCcw} onClick={runComparable} kbd="C">Run comparable incident</Button>
        </div>
      )}
    </>
  );
}

function Quote({ message }: { message: ChatMessage }) {
  const a = message.agent ? AGENTS[message.agent] : null;
  return (
    <div className="flex gap-2.5 rounded-lg border border-line bg-surface p-3">
      {message.agent && <AgentAvatar agent={message.agent} size={20} />}
      <div className="min-w-0 text-xs">
        <div className="flex flex-wrap items-center gap-1.5"><span className="font-medium text-fg">{a?.name}</span><span className="text-fg-4">{a?.model}</span>{message.evaluation && <QualityBadge evaluation={message.evaluation} />}</div>
        <p className="mt-0.5 text-sm text-fg-2">{message.text}</p>
      </div>
    </div>
  );
}

function Report({ message }: { message: ChatMessage }) {
  const system = message.role === 'system';
  const alert = system && /^Driver app/.test(message.text);
  return (
    <div className={clsx('rounded-lg border p-3 text-xs', alert ? 'border-amber/30 bg-amber/[0.05]' : 'border-line bg-surface')}>
      <div className="flex items-center gap-1.5 font-medium text-fg">
        {alert && <TriangleAlert className="h-3.5 w-3.5 text-amber" />}
        {system ? (alert ? 'Driver app alert' : 'System') : message.author}
        <time className="ml-auto font-mono text-[10px] font-normal text-fg-4">{fmtTime(message.at)}</time>
      </div>
      <p className="mt-1 text-sm text-fg-2">{message.text.replace(/^Driver app:\s*/, '')}</p>
      {message.attachments && (
        <div className="grid gap-2 sm:grid-cols-2">{message.attachments.map((ev) => <Attachment key={ev.id} ev={ev} />)}</div>
      )}
    </div>
  );
}

function Waiting() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-fg-3">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working on it…
    </div>
  );
}

/* ---------- incident view ---------- */

export function IncidentView({ onLog }: { onLog: () => void }) {
  const stage = useStore((s) => s.stage);
  const scroller = useRef<HTMLDivElement>(null);
  // Keep the live step in view as the incident advances.
  useEffect(() => {
    const el = scroller.current?.querySelector('li:has(> span.bg-accent), li:has(> span.bg-amber)');
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [stage]);
  return (
    <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-4 p-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_minmax(400px,0.82fr)] lg:p-5">
      <div className="flex min-h-0 flex-col gap-4">
        <NowBanner onLog={onLog} />
        <div ref={scroller} className="min-h-0 flex-1 lg:overflow-y-auto lg:pr-1">
          <StepList />
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-4">
        <MetricsCard />
        <MapPanel className="h-[380px] lg:h-auto lg:min-h-[320px] lg:flex-1" />
      </div>
    </div>
  );
}

/* ---------- start screen ---------- */

export function StartScreen() {
  const mode = useStore((s) => s.mode);
  const connection = useStore((s) => s.connection);
  const prefs = useStore((s) => s.preferences.filter((p) => p.status === 'active'));
  const last = useStore((s) => s.history[0]);
  return (
    <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-5 p-4 lg:h-full lg:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)] lg:p-6">
      <div className="flex min-h-0 flex-col gap-6 lg:overflow-y-auto lg:pr-2">
        <div>
          <Pill tone={mode === 'demo' ? 'violet' : connection === 'online' ? 'green' : 'amber'} dot>
            {mode === 'demo' ? 'Demo mode · scripted, no backend' : `Live mode · backend ${connection}`}
          </Pill>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">When a cold-chain truck breaks down, Ghost Dispatcher handles it.</h1>
          <p className="mt-2 max-w-xl text-sm text-fg-3">
            Specialist agents read the evidence, find a refrigerated rescue truck, check it against hard rules, book it, recover if a provider fails, notify everyone, and learn from your rating.
          </p>
        </div>

        <ol className="space-y-4">
          <HowStep n={1} title="Attach driver evidence" hint="Optional. A photo and a voice note, as a driver would send them.">
            <EvidencePicker />
          </HowStep>
          <HowStep n={2} title="Simulate a breakdown" hint="Truck TN-07 stops near Hosur with vaccines on board.">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={Play} kbd="1" onClick={startBreakdown}>Simulate breakdown</Button>
              {mode === 'demo' && <Button onClick={() => void switchMode('live')}>Use the live backend instead</Button>}
            </div>
          </HowStep>
          <HowStep n={3} title="Watch, break it, rate it" hint="Follow each step as it happens. During booking, kill the carrier to watch self-healing, then rate the decision." />
        </ol>

        {(prefs.length > 0 || last) && (
          <div className="space-y-2 rounded-lg border border-line bg-surface p-3 text-xs">
            {last && <div className="flex gap-2"><span className="w-24 shrink-0 text-fg-3">Last incident</span><span className="text-fg-2">{last.outcome ?? last.title}</span></div>}
            {prefs.map((p) => (
              <div key={p.id} className="flex gap-2"><span className="w-24 shrink-0 text-fg-3">Learned {p.id}</span><span className="text-fg-2">{p.rule}</span></div>
            ))}
            {prefs.length > 0 && <Button size="sm" icon={RotateCcw} onClick={runComparable} kbd="C">Run comparable incident</Button>}
          </div>
        )}
      </div>
      <MapPanel className="h-[380px] lg:h-auto" />
    </div>
  );
}

function HowStep({ n, title, hint, children }: { n: number; title: string; hint: string; children?: ReactNode }) {
  return (
    <li className="relative pl-9">
      <span className="absolute left-0 top-0 inline-flex h-6 w-6 items-center justify-center rounded-full border border-line-strong text-[11px] font-medium text-fg-2">{n}</span>
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-fg-3">{hint}</div>
      {children && <div className="mt-2.5">{children}</div>}
    </li>
  );
}

/** Pick evidence before starting: samples from data/, your own files, or a recording. */
export function EvidencePicker() {
  const pending = useStore((s) => s.pendingEvidence);
  const recording = useStore((s) => s.recording);
  const mode = useStore((s) => s.mode);
  const file = useRef<HTMLInputElement>(null);
  const sizes = useMemo(() => pending.reduce((n, e) => n + e.size, 0), [pending]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={FolderOpen} onClick={() => void addSamples()}>Use sample evidence</Button>
        <input ref={file} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <Button size="sm" icon={Paperclip} onClick={() => file.current?.click()}>Attach files</Button>
        <Button size="sm" variant={recording ? 'danger' : 'secondary'} icon={Mic} onClick={() => void toggleRecording()}>{recording ? 'Stop recording' : 'Record voice note'}</Button>
      </div>
      {pending.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pending.map((ev) => (
            <span key={ev.id} className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface pl-1 pr-1.5 text-2xs">
              {ev.kind === 'photo' && ev.url ? <img src={ev.url} alt="" className="h-6 w-6 rounded object-cover" /> : ev.kind === 'voice' ? <Mic className="h-3.5 w-3.5 text-violet" /> : <FileText className="h-3.5 w-3.5 text-fg-3" />}
              <span className="max-w-[140px] truncate text-fg-2" title={ev.name}>{ev.name}</span>
              <span className="text-fg-4">{fmtBytes(ev.size)}</span>
              {ev.status === 'uploading' ? <Loader2 className="h-3 w-3 animate-spin text-fg-3" /> : ev.status === 'ready' ? <Check className="h-3 w-3 text-green" strokeWidth={2.5} /> : <span title={ev.error}><TriangleAlert className="h-3 w-3 text-red" /></span>}
              <button type="button" aria-label={`Remove ${ev.name}`} onClick={() => removePending(ev.id)} className="text-fg-4 hover:text-fg"><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}
      {pending.length > 0 && (
        <p className="text-2xs text-fg-4">
          {fmtBytes(sizes)} ready · {mode === 'live' ? 'uploaded to the backend and attached when the incident opens' : 'used as the driver report when the demo starts'}
        </p>
      )}
    </div>
  );
}

/** Live backend only: what the PII guardrail did on this incident (types and counts, never values). */
function PrivacyNote() {
  const guardrails = useStore((s) => s.guardrails);
  if (!guardrails.length) return null;
  const types = [...new Set(guardrails.flatMap((g) => g.types))];
  const blocked = guardrails.filter((g) => g.action === 'blocked').length;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-xs">
      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green" />
      <span className="text-fg-2">
        PII guardrail: {guardrails.length} event{guardrails.length === 1 ? '' : 's'} ({types.join(', ') || 'personal data'}){blocked ? `, ${blocked} blocked at entry` : ''}. Nothing personal was stored or sent to Gemini; only types and counts are logged.
      </span>
    </div>
  );
}

/** Live backend only: deterministic quality checks over every agent reply, plus guardrail activity. */
function SafetySummary() {
  const evaluations = useStore((s) => s.evaluations);
  const guardrails = useStore((s) => s.guardrails);
  if (!evaluations.length && !guardrails.length) return null;
  const avg = (k: 'groundedness' | 'truthfulness') => evaluations.length ? Math.round((evaluations.reduce((n, e) => n + e[k], 0) / evaluations.length) * 100) : 100;
  const flagged = evaluations.filter((e) => e.hallucinated).length;
  const simulated = evaluations.some((e) => e.simulated);
  if (!evaluations.length) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-xs">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green" />
        <span className="text-fg-2">
          PII guardrail: {guardrails.length} event{guardrails.length === 1 ? '' : 's'} ({[...new Set(guardrails.flatMap((g) => g.types))].join(', ')}). Reply quality checks (groundedness, truthfulness) run on the live backend.
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-line bg-surface p-3 text-xs">
      <div className="flex items-center gap-2 font-medium text-fg"><ShieldCheck className="h-3.5 w-3.5 text-green" />Safety and quality</div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <div><dt className="text-fg-3">Replies checked</dt><dd className="font-mono text-fg">{evaluations.length}</dd></div>
        <div><dt className="text-fg-3">Groundedness</dt><dd className="font-mono text-fg">{avg('groundedness')}%</dd></div>
        <div><dt className="text-fg-3">Truthfulness</dt><dd className="font-mono text-fg">{avg('truthfulness')}%</dd></div>
        <div><dt className="text-fg-3">Unverified</dt><dd className={clsx('font-mono', flagged ? 'text-amber' : 'text-fg')}>{flagged}</dd></div>
      </dl>
      <p className="mt-2 text-fg-4">
        {guardrails.length ? `${guardrails.length} PII guardrail event${guardrails.length === 1 ? '' : 's'}. ` : 'No personal data detected. '}
        {simulated ? 'Offline run: checks score the deterministic model double, not real Gemini.' : 'Scored against tool results and the operational store.'}
      </p>
    </div>
  );
}
