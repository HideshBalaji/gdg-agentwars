import { useEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  HeartPulse,
  Info,
  Loader2,
  Mic,
  Paperclip,
  Power,
  RotateCcw,
  Send,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import type { ActionReceipt, Evaluation, Evidence, HealingEvent, ToolCall } from '../lib/contract';
import { AGENTS, SYSTEMS } from '../lib/meta';
import { fmtTime, uid } from '../lib/format';
import { apply, nowIso, useStore, type FeedItem } from '../lib/store';
import { COMPARABLE, rate, runComparable, startBreakdown, toggleCarrier } from '../lib/actions';
import { liveSend } from '../lib/live';
import { ACCEPT_ATTR, addFiles, addSamples, fmtBytes, removePending, takeReady, toggleRecording } from '../lib/evidence';
import { AgentAvatar, Button, Card, EmptyState, Kbd, Pill, Segmented, type Tone } from './ui';

type Filter = 'all' | 'agents' | 'tools' | 'recovery';

export function Activity({ className }: { className?: string }) {
  const feed = useStore((s) => s.feed);
  const tools = useStore((s) => s.tools);
  const typing = useStore((s) => s.typing);
  const ratingRequested = useStore((s) => s.ratingRequested);
  const owner = useStore((s) => s.owner);
  const hasIncident = useStore((s) => !!s.incident);
  const [filter, setFilter] = useState<Filter>('all');
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);

  const visible = feed.filter((f) => {
    if (filter === 'all') return true;
    if (filter === 'agents') return f.kind === 'message' || f.kind === 'handover';
    if (filter === 'tools') return f.kind === 'tool' || f.kind === 'action';
    return f.kind === 'healing' || f.kind === 'guardrail' || (f.kind === 'tool' && tools[f.id]?.status === 'error');
  });

  // Stay pinned to the newest event; only the reader scrolling up unpins it.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !stuck) return;
    const id = requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
    return () => cancelAnimationFrame(id);
  }, [visible.length, typing, ratingRequested, stuck, filter]);

  // Panels opening above or below shrink the list; keep the bottom in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => stuck && el.scrollTo({ top: el.scrollHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [stuck]);

  const onScroll = () => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 24) setStuck(true);
  };
  const unpin = () => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight > 24) setStuck(false);
  };

  return (
    <Card className={clsx('relative', className)}>
      <div
        className="contents"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles([...e.dataTransfer.files]); }}
      >
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
          <h2 className="text-sm font-medium">Activity</h2>
          {hasIncident && (
            <span className="flex min-w-0 items-center gap-1.5 text-2xs text-fg-3">
              <AgentAvatar agent={owner} size={16} />
              <span className="truncate">{AGENTS[owner].name} has the conversation</span>
            </span>
          )}
          <div className="ml-auto">
            <Segmented
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'agents', label: 'Agents' },
                { value: 'tools', label: 'Tools' },
                { value: 'recovery', label: 'Safety' },
              ]}
            />
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} onWheel={(e) => e.deltaY < 0 && setTimeout(unpin, 50)} onTouchMove={() => setTimeout(unpin, 50)} className="h-full overflow-y-auto">
          {!feed.length ? (
            <EmptyState icon={Zap} title="Nothing happening yet" actions={<Button variant="primary" size="sm" onClick={startBreakdown} kbd="1">Simulate breakdown</Button>}>
              Agent messages, tool calls, recoveries and receipts stream here as one timeline. Attach driver evidence below first to include it.
            </EmptyState>
          ) : (
            <ol className="px-3 py-2">
              {visible.map((item) => (
                <li key={item.id} className="animate-arrive rounded-md">
                  <Item item={item} />
                </li>
              ))}
              {typing && (
                <li className="flex items-center gap-2.5 py-2 pl-0.5">
                  <AgentAvatar agent={typing} size={20} />
                  <span className="bg-gradient-to-r from-fg-4 via-fg-2 to-fg-4 bg-[length:200%_100%] bg-clip-text text-xs text-transparent animate-shimmer">
                    {AGENTS[typing].name} is thinking…
                  </span>
                </li>
              )}
            </ol>
          )}
        </div>
        <AnimatePresence>
          {!stuck && feed.length > 0 && (
            <motion.button initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} type="button"
              onClick={() => setStuck(true)}
              className="absolute bottom-3 left-1/2 z-10 inline-flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface px-2.5 text-2xs text-fg-2 shadow-pop hover:text-fg">
              <ArrowDown className="h-3 w-3" /> Jump to latest
            </motion.button>
          )}
        </AnimatePresence>
        </div>

        <Composer />

        <AnimatePresence>
          {dragging && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-1 z-20 flex items-center justify-center rounded-lg border border-dashed border-accent bg-accent/5 text-xs text-fg-2">
              Drop photos, voice notes or PDFs to attach them
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}

/* ---------- timeline items ---------- */

function Item({ item }: { item: FeedItem }) {
  if (item.kind === 'handover') return <Handover from={item.from} to={item.to} reason={item.reason} />;
  if (item.kind === 'tool') return <ToolRow id={item.id} />;
  if (item.kind === 'healing') return <HealingRow id={item.id} />;
  if (item.kind === 'action') return <ActionRow id={item.id} />;
  if (item.kind === 'guardrail') return <GuardrailRow id={item.id} />;
  const m = item.message;
  if (m.role === 'system') {
    const error = /^Backend:|failed/i.test(m.text);
    const alert = /^Driver app|^PII guardrail/.test(m.text);
    return (
      <div className={clsx('my-1.5 flex gap-2 rounded-md border px-2.5 py-2 text-xs', error ? 'border-red/30 bg-red/[0.06] text-fg' : alert ? 'border-amber/30 bg-amber/[0.06] text-fg' : 'border-line bg-surface-2/50 text-fg-2')}>
        {error ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red" /> : alert ? <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-3" />}
        <span>{m.text}</span>
      </div>
    );
  }
  const author =
    m.role === 'agent' && m.agent ? (
      <>
        <span className="font-medium text-fg">{AGENTS[m.agent].name}</span>
        <span className="text-fg-4">{AGENTS[m.agent].model}</span>
      </>
    ) : (
      <span className="font-medium text-fg">{m.role === 'user' ? 'You' : m.author}</span>
    );
  const avatar =
    m.role === 'agent' && m.agent ? <AgentAvatar agent={m.agent} size={20} /> : (
      <span className={clsx('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold', m.role === 'user' ? 'bg-fg text-bg' : 'bg-surface-3 text-fg-2')}>
        {m.role === 'user' ? 'You'.slice(0, 1) : initials(m.author)}
      </span>
    );
  return (
    <div className="flex gap-2.5 py-2">
      <div className="pt-0.5">{avatar}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 text-xs">
          {author}
          {m.evaluation && <QualityBadge evaluation={m.evaluation} />}
          <time className="ml-auto shrink-0 font-mono text-[10px] text-fg-4">{fmtTime(m.at)}</time>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-fg-2">{m.text}</p>
        {m.attachments?.map((ev) => <Attachment key={ev.id} ev={ev} />)}
        {m.quick_replies && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {m.quick_replies.map((q) => (
              <Button key={q} size="sm" icon={q === COMPARABLE ? RotateCcw : undefined} onClick={() => (q === COMPARABLE ? runComparable() : void liveSend(q))}>{q}</Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function initials(name?: string) {
  return (name ?? '?').split(/[\s·]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
}

function Handover({ from, to, reason }: { from: keyof typeof AGENTS; to: keyof typeof AGENTS; reason: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-2xs text-fg-3">
      <span className="h-px flex-1 bg-line" />
      <AgentAvatar agent={from} size={14} />
      <ArrowRight className="h-3 w-3 text-fg-4" />
      <AgentAvatar agent={to} size={14} />
      <span className="max-w-[60%] truncate"><span className="text-fg-2">{AGENTS[to].name}</span> took over · {reason}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function ToolRow({ id }: { id: string }) {
  const t: ToolCall | undefined = useStore((s) => s.tools[id]);
  const [open, setOpen] = useState(false);
  if (!t) return null;
  const sys = SYSTEMS[t.system];
  return (
    <div className="pl-[30px]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="group flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-fg-3 hover:bg-surface-2">
        <ChevronRight className={clsx('h-3 w-3 shrink-0 text-fg-4 transition-transform', open && 'rotate-90')} />
        {t.status === 'running' ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-fg-3" /> : t.status === 'ok' ? <Check className="h-3 w-3 shrink-0 text-green" strokeWidth={2.5} /> : <X className="h-3 w-3 shrink-0 text-red" strokeWidth={2.5} />}
        <span className="truncate">
          <span className="text-fg-2">{AGENTS[t.agent].name}</span> called <span className="font-mono text-fg-2">{sys.name}.{t.tool}</span>
          {t.status === 'error' && <span className="text-red"> · {t.summary}</span>}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-4">{t.latency_ms ? `${t.latency_ms} ms` : ''}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mb-1.5 ml-5 space-y-1 rounded-md border border-line bg-surface-2/60 p-2 font-mono text-[11px] text-fg-3">
              <div><span className="text-fg-4">args </span>{t.args}</div>
              {t.summary && <div><span className="text-fg-4">{t.status === 'error' ? 'error ' : 'result '}</span><span className={t.status === 'error' ? 'text-red' : 'text-fg-2'}>{t.summary}</span></div>}
              <div><span className="text-fg-4">via </span>{sys.kind === 'mcp' ? 'MCP' : sys.kind === 'model' ? 'Gemini' : sys.kind === 'carrier' ? 'Carrier API' : sys.kind === 'store' ? 'Memory store' : 'Google API'}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const LEVEL: Record<HealingEvent['level'], string> = { retry: 'Retry', fallback: 'Fallback', validation: 'Validation', repair: 'Repair', learned: 'Learned' };
const RESULT: Record<HealingEvent['result'], [string, Tone]> = {
  in_progress: ['Recovering', 'amber'],
  recovered: ['Recovered', 'green'],
  failed: ['Failed', 'red'],
  pending: ['Pending', 'amber'],
};

export function HealingRow({ id, indent = true }: { id: string; indent?: boolean }) {
  const h = useStore((s) => s.healing.find((x) => x.id === id));
  if (!h) return null;
  const [label, tone] = RESULT[h.result];
  const bad = h.result === 'failed' || h.result === 'in_progress';
  return (
    <div className={clsx('my-1.5 rounded-md border px-2.5 py-2 text-xs transition-colors', indent && 'ml-[30px]', bad ? 'border-amber/30 bg-amber/[0.05]' : 'border-line bg-surface')}>
      <div className="flex items-center gap-1.5">
        <HeartPulse className={clsx('h-3.5 w-3.5', tone === 'green' ? 'text-green' : tone === 'red' ? 'text-red' : 'text-amber')} />
        <span className="font-medium text-fg">{LEVEL[h.level]}</span>
        <span className="truncate font-mono text-[11px] text-fg-3">{h.tool}{h.provider ? ` · ${h.provider}` : ''}</span>
        <Pill tone={tone} dot className="ml-auto">{label}</Pill>
      </div>
      <div className="mt-1 text-fg-3">
        {h.failure} <ArrowRight className="mx-0.5 inline h-3 w-3 text-fg-4" /> <span className="text-fg-2">{h.remedy}</span>
      </div>
    </div>
  );
}

export function ActionRow({ id, indent = true }: { id: string; indent?: boolean }) {
  const a: ActionReceipt | undefined = useStore((s) => s.actions.find((x) => x.id === id));
  if (!a) return null;
  const Icon = SYSTEMS[a.system]?.icon ?? Wrench;
  const tone: Tone = a.status === 'confirmed' ? 'green' : a.status === 'pending' ? 'amber' : 'red';
  return (
    <div className={clsx('flex items-center gap-2 py-1 text-xs', indent && 'pl-[30px]')}>
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line bg-surface-2"><Icon className="h-3 w-3 text-fg-3" strokeWidth={1.75} /></span>
      <span className="min-w-0 flex-1 truncate"><span className="text-fg">{a.title}</span> <span className="text-fg-3">· {a.detail}</span></span>
      {a.simulated && <span className="text-[10px] text-fg-4">simulated</span>}
      <Pill tone={tone} dot>{a.status === 'confirmed' ? 'Done' : a.status === 'pending' ? 'Pending' : 'Failed'}</Pill>
    </div>
  );
}

export function Attachment({ ev }: { ev: Evidence }) {
  if (ev.kind === 'photo') {
    return (
      <figure className="mt-2 max-w-sm overflow-hidden rounded-md border border-line">
        <img src={ev.url} alt={ev.name} className="max-h-44 w-full object-cover" />
        {ev.caption && <figcaption className="border-t border-line px-2 py-1 text-[10px] text-fg-3">{ev.caption}</figcaption>}
      </figure>
    );
  }
  if (ev.kind === 'voice') {
    return (
      <div className="mt-2 max-w-sm rounded-md border border-line p-2">
        <audio controls src={ev.url} className="h-8 w-full" />
        {ev.transcript && <p className="mt-1.5 line-clamp-3 text-2xs italic text-fg-3">“{ev.transcript}”</p>}
      </div>
    );
  }
  return (
    <a href={ev.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-fg-2 hover:text-fg">
      <FileText className="h-3.5 w-3.5" /> {ev.name}
    </a>
  );
}

/* ---------- kill-switch callout ---------- */

export function ChaosCallout() {
  const chaos = useStore((s) => s.chaos);
  const names = useStore((s) => s.carrierNames);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!chaos) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [chaos]);
  return (
    <AnimatePresence>
      {chaos && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden rounded-lg border border-amber/40">
          <div className="flex items-center gap-3 bg-amber/[0.07] px-3 py-2.5">
            <Power className="h-4 w-4 shrink-0 text-amber" />
            <div className="min-w-0 flex-1 text-xs">
              <div className="font-medium text-fg">Booking in flight with {names[chaos.system] ?? SYSTEMS[chaos.system].name}</div>
              <div className="text-fg-3">Kill the provider now to watch retry, fallback and recovery.</div>
            </div>
            <span className="font-mono text-2xs tabular-nums text-fg-3">{Math.max(0, Math.ceil((chaos.until - Date.now()) / 1000))}s</span>
            <Button variant="danger" size="sm" icon={Power} kbd="K" onClick={() => toggleCarrier(chaos.system)}>Kill provider</Button>
          </div>
          <div className="h-0.5 bg-amber/15">
            <motion.div className="h-full bg-amber" initial={{ width: '100%' }} animate={{ width: '0%' }} transition={{ duration: Math.max(0, (chaos.until - Date.now()) / 1000), ease: 'linear' }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- rating ---------- */

const PRESETS = ['Too expensive — we had slack, prefer the cheaper carrier', 'Too slow for critical cargo', 'Good call'];

export function RatingCard() {
  const requested = useStore((s) => s.ratingRequested);
  const [reason, setReason] = useState(PRESETS[0]);
  return (
    <AnimatePresence>
      {requested && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="space-y-2 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
              <span className="whitespace-nowrap font-medium">How was this decision?</span>
              <div className="ml-auto flex flex-wrap gap-1">
                {PRESETS.map((p) => (
                  <button key={p} type="button" onClick={() => setReason(p)}
                    className={clsx('h-6 whitespace-nowrap rounded-full border px-2 text-2xs transition-colors', reason === p ? 'border-fg-3 bg-surface-2 text-fg' : 'border-line text-fg-3 hover:text-fg')}>
                    {p.split(' — ')[0]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-1.5">
              <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason"
                className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2.5 text-xs outline-none focus:border-line-strong" />
              <Button icon={ThumbsUp} onClick={() => void rate('up', reason)} title="Good call" aria-label="Good call" />
              <Button variant="primary" icon={ThumbsDown} onClick={() => void rate('down', reason)}>Needs work</Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- composer ---------- */

export function Composer() {
  const pending = useStore((s) => s.pendingEvidence);
  const recording = useStore((s) => s.recording);
  const [draft, setDraft] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const send = () => {
    const text = draft.trim() || (pending.length ? 'Evidence attached' : '');
    if (!text) return;
    if (useStore.getState().mode === 'live') void liveSend(text);
    else {
      const attachments = takeReady();
      apply({ type: 'message', message: { id: uid('m'), at: nowIso(), role: 'user', text, attachments: attachments.length ? attachments : undefined } });
      if (useStore.getState().incident) attachments.forEach((ev) => apply({ type: 'incident.evidence', evidence: ev }));
      if (attachments.length) {
        apply({ type: 'message', message: { id: uid('m'), at: nowIso(), role: 'agent', agent: 'intake', text: 'Received. Demo mode keeps evidence in the browser; switch to Live to upload it to the backend, where Gemini Intake reads it.' } });
      }
    }
    setDraft('');
  };

  return (
    <div className="shrink-0 border-t border-line p-2.5">
      <div className="rounded-lg border border-line bg-surface-2/50 transition-colors focus-within:border-line-strong">
        <AnimatePresence initial={false}>
          {pending.length > 0 && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
              <div className="flex flex-wrap gap-1.5 px-2 pt-2">
                {pending.map((ev) => (
                  <span key={ev.id} className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface pl-1 pr-1.5 text-2xs">
                    {ev.kind === 'photo' && ev.url ? <img src={ev.url} alt="" className="h-5 w-5 rounded object-cover" /> : ev.kind === 'voice' ? <Mic className="h-3.5 w-3.5 text-violet" /> : <FileText className="h-3.5 w-3.5 text-fg-3" />}
                    <span className="max-w-[110px] truncate text-fg-2" title={ev.name}>{ev.name}</span>
                    <span className="text-fg-4">{fmtBytes(ev.size)}</span>
                    {ev.status === 'uploading' ? <Loader2 className="h-3 w-3 animate-spin text-fg-3" /> : ev.status === 'ready' ? <Check className="h-3 w-3 text-green" strokeWidth={2.5} /> : <span title={ev.error}><TriangleAlert className="h-3 w-3 text-red" /></span>}
                    <button type="button" aria-label={`Remove ${ev.name}`} onClick={() => removePending(ev.id)} className="text-fg-4 hover:text-fg"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={pending.length ? 'Add a note, or press Enter to send the evidence' : 'Message the active agent — e.g. “Why this vehicle?”'}
          aria-label="Message"
          className="h-9 w-full bg-transparent px-2.5 text-sm outline-none placeholder:text-fg-4"
        />
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <input ref={file} type="file" multiple accept={ACCEPT_ATTR} className="hidden" onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
          <IconButton label="Attach photo, voice note or PDF" onClick={() => file.current?.click()}><Paperclip className="h-3.5 w-3.5" /></IconButton>
          <IconButton label={recording ? 'Stop recording' : 'Record a voice note'} onClick={() => void toggleRecording()} active={recording}><Mic className="h-3.5 w-3.5" /></IconButton>
          <button type="button" onClick={() => void addSamples()} title="Attach the sample driver photo and voice note from data/"
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-2xs text-fg-3 hover:bg-surface-3 hover:text-fg">
            <FolderOpen className="h-3.5 w-3.5" /> Sample evidence
          </button>
          <span className="ml-auto hidden text-[10px] text-fg-4 sm:inline"><Kbd>↵</Kbd> send</span>
          <button type="button" onClick={send} aria-label="Send" className="ml-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-fg text-bg hover:bg-fg/90">
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function IconButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={clsx('inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors', active ? 'animate-pulse bg-red/15 text-red' : 'text-fg-3 hover:bg-surface-3 hover:text-fg')}>
      {children}
    </button>
  );
}

const SURFACE: Record<string, string> = {
  incident: 'incident description',
  chat: 'chat message',
  feedback: 'feedback',
  upload: 'uploaded file',
  model_input: 'Gemini input',
  model_output: 'agent reply',
  tool_output: 'tool result',
  tool_args: 'tool arguments',
};

/** Personal data blocked at entry or redacted before a model, tool or reply. Never shows values. */
export function GuardrailRow({ id, indent = true }: { id: string; indent?: boolean }) {
  const g = useStore((s) => s.guardrails.find((x) => x.id === id));
  if (!g) return null;
  const blocked = g.action === 'blocked';
  return (
    <div className={clsx('my-1.5 flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs', indent && 'ml-[30px]', blocked ? 'border-amber/30 bg-amber/[0.05]' : 'border-line bg-surface')}>
      <ShieldCheck className={clsx('mt-0.5 h-3.5 w-3.5 shrink-0', blocked ? 'text-amber' : 'text-green')} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-fg">PII {blocked ? 'blocked' : 'redacted'}</span>
          <span className="text-fg-3">in {SURFACE[g.surface] ?? g.surface.replace(/_/g, ' ')}</span>
          {g.types.map((t) => <Pill key={t} tone={blocked ? 'amber' : 'neutral'}>{t}</Pill>)}
        </div>
        <div className="mt-0.5 text-fg-3">
          {blocked ? 'Refused before anything was stored or sent to a model.' : 'Removed before it reached Gemini or a reply.'} Values are never logged.
          {g.degraded && ' Detector running in degraded mode.'}
        </div>
      </div>
    </div>
  );
}

/** Groundedness/truthfulness check of an agent reply, from the backend's deterministic evaluator. */
export function QualityBadge({ evaluation: e }: { evaluation: Evaluation }) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const details = [
    `Groundedness ${pct(e.groundedness)} (${e.claims} claim${e.claims === 1 ? '' : 's'} checked against tool results)`,
    `Truthfulness ${pct(e.truthfulness)} (${e.state_checks} state check${e.state_checks === 1 ? '' : 's'})`,
    ...e.unsupported.map((u) => `Unsupported ${u.kind}: ${u.value}${u.reason ? ` (${u.reason})` : ''}`),
    ...e.contradictions.map((c) => `Contradiction: "${c.claim}" vs store: ${c.store}`),
    e.simulated ? 'Offline run: checks the deterministic model double, not real Gemini.' : '',
  ].filter(Boolean).join('\n');
  return e.hallucinated ? (
    <Pill tone="amber" title={details}><TriangleAlert className="h-3 w-3" />Unverified claim</Pill>
  ) : (
    <Pill tone="green" title={details}><ShieldCheck className="h-3 w-3" />Grounded {pct(e.groundedness)}</Pill>
  );
}
