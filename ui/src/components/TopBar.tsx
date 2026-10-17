import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import clsx from 'clsx';
import {
  ChevronDown,
  CornerDownLeft,
  Gauge,
  Ghost,
  Moon,
  Play,
  Power,
  RadioTower,
  RotateCcw,
  ScrollText,
  Search,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { fmtClock } from '../lib/format';
import { CARRIER_SYSTEMS, SYSTEMS, SYSTEM_ORDER } from '../lib/meta';
import type { SystemId } from '../lib/contract';
import { nowMs, useStore } from '../lib/store';
import { resetView, runComparable, startBreakdown, switchMode, toggleCarrier, toggleSpeed, toggleTheme, useTheme } from '../lib/actions';
import { Button, Kbd, Pill, Segmented, StatusDot, type Tone } from './ui';

const STATUS: Record<string, [string, Tone]> = {
  open: ['Open', 'amber'],
  planning: ['Planning', 'blue'],
  executing: ['Executing', 'blue'],
  resolved: ['Resolved', 'green'],
  blocked: ['Blocked', 'red'],
};

export function TopBar({ onCommand, onLog, unread }: { onCommand: () => void; onLog: () => void; unread: number }) {
  const incident = useStore((s) => s.incident);
  const learned = useStore((s) => s.preferences.some((p) => p.status === 'active'));
  const theme = useTheme((s) => s.theme);
  const [label, tone] = STATUS[incident?.status ?? ''] ?? ['Standby', 'neutral'];
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-bg px-3 lg:gap-3 lg:px-5">
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-fg text-bg"><Ghost className="h-3.5 w-3.5" strokeWidth={2.25} /></span>
      <span className="hidden whitespace-nowrap text-sm font-semibold tracking-tight md:inline">Ghost Dispatcher</span>
      <span className="hidden text-fg-4 md:inline">/</span>
      <span className="min-w-0 truncate text-sm text-fg-2">{incident ? incident.title : 'Overview'}</span>
      <Pill tone={tone as Tone} dot>{label}</Pill>

      <div className="ml-auto flex items-center gap-1.5 lg:gap-2">
        <Clock />
        <ModeSwitch />
        <SystemsMenu />
        <button type="button" onClick={onLog} title="Agent log (L)" className="relative inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-fg-2 hover:bg-surface-2 hover:text-fg">
          <ScrollText className="h-4 w-4" strokeWidth={1.75} /><span className="hidden whitespace-nowrap lg:inline">Agent log</span>
          {unread > 0 && <span className="rounded-full bg-accent px-1.5 font-mono text-[10px] leading-4 text-white">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <IconButton label="Command menu (⌘K)" onClick={onCommand}><Search className="h-4 w-4" strokeWidth={1.75} /></IconButton>
        <IconButton label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>{theme === 'dark' ? <Sun className="h-4 w-4" strokeWidth={1.75} /> : <Moon className="h-4 w-4" strokeWidth={1.75} />}</IconButton>
        {learned && incident && (
          <Button icon={RotateCcw} onClick={runComparable} title="Replay the same incident on a re-seeded fleet; only the learned feedback differs" className="hidden sm:inline-flex">
            <span className="hidden xl:inline">Run comparable</span>
          </Button>
        )}
        <Button variant="primary" icon={Play} onClick={startBreakdown} kbd="1">
          <span className="hidden sm:inline">Simulate breakdown</span>
        </Button>
      </div>
    </header>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-3 hover:bg-surface-2 hover:text-fg">
      {children}
    </button>
  );
}

function ModeSwitch() {
  const mode = useStore((s) => s.mode);
  const connection = useStore((s) => s.connection);
  const tone: Tone = mode === 'demo' ? 'violet' : connection === 'online' ? 'green' : connection === 'connecting' ? 'amber' : 'red';
  return (
    <div className="hidden items-center gap-2 sm:flex" title={mode === 'demo' ? 'Scripted demo, no backend' : `Live backend ${connection}`}>
      <StatusDot tone={tone} pulse={mode === 'live' && connection === 'online'} />
      <Segmented size="sm" value={mode} onChange={(m) => void switchMode(m)} options={[{ value: 'demo', label: 'Demo' }, { value: 'live', label: 'Live' }]} />
    </div>
  );
}

/** Integration health, with the carrier kill switches used to inject failures. */
function SystemsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const systems = useStore((s) => s.systems);
  const names = useStore((s) => s.carrierNames);
  const down = SYSTEM_ORDER.filter((id) => systems[id].health === 'down').length;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => (window.removeEventListener('mousedown', close), window.removeEventListener('keydown', esc));
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Systems and failure injection"
        className={clsx('inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-surface-2', down ? 'text-red' : 'text-fg-2 hover:text-fg')}>
        <StatusDot tone={down ? 'red' : 'green'} />
        <span className="hidden whitespace-nowrap lg:inline">{down ? `${down} down` : 'Systems'}</span>
        <ChevronDown className="h-3.5 w-3.5 text-fg-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}
            className="absolute right-0 top-10 z-40 w-72 overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
            <div className="border-b border-line px-3 py-2 text-xs font-medium">Systems</div>
            <div className="max-h-[60vh] overflow-y-auto p-1.5">
              {SYSTEM_ORDER.map((id: SystemId) => {
                const meta = SYSTEMS[id];
                const Icon = meta.icon;
                const isDown = systems[id].health === 'down';
                const carrier = CARRIER_SYSTEMS.includes(id);
                return (
                  <div key={id + systems[id].pulse} className={clsx('flex h-8 items-center gap-2 rounded-md px-2 text-xs', systems[id].pulse > 0 && 'animate-flash')}>
                    <Icon className={clsx('h-3.5 w-3.5', isDown ? 'text-red' : 'text-fg-3')} strokeWidth={1.75} />
                    <span className={clsx('min-w-0 flex-1 truncate', isDown ? 'text-red' : 'text-fg-2')}>{names[id] ?? meta.name}</span>
                    {carrier ? <Toggle on={!isDown} onChange={() => toggleCarrier(id)} label={`${isDown ? 'Revive' : 'Kill'} ${names[id] ?? meta.name}`} /> : <StatusDot tone={isDown ? 'red' : 'green'} />}
                  </div>
                );
              })}
            </div>
            <p className="border-t border-line px-3 py-2 text-[11px] leading-4 text-fg-3">Switch a carrier off to inject a provider failure. During booking, the step view also offers a one-click kill.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} onClick={onChange}
      className={clsx('relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors duration-150', on ? 'border-green/40 bg-green/80' : 'border-red/40 bg-red/70')}>
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 35 }} className={clsx('h-3 w-3 rounded-full bg-white shadow', on ? 'ml-[13px]' : 'ml-[1px]')} />
    </button>
  );
}

function Clock() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="hidden font-mono text-xs tabular-nums text-fg-4 xl:inline">{fmtClock(nowMs())} IST</span>;
}

interface Command {
  id: string;
  group: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
  run: () => void;
}

export function CommandMenu({ open, onClose, onLog }: { open: boolean; onClose: () => void; onLog: () => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const mode = useStore((s) => s.mode);
  const systems = useStore((s) => s.systems);
  const names = useStore((s) => s.carrierNames);
  const learned = useStore((s) => s.preferences.some((p) => p.status === 'active'));

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'start', group: 'Incident', label: 'Simulate truck breakdown', icon: Play, hint: '1', run: startBreakdown },
      ...(learned ? [{ id: 'compare', group: 'Incident', label: 'Run comparable incident', icon: RotateCcw, hint: 'C', run: runComparable }] : []),
      { id: 'log', group: 'Incident', label: 'Open agent log', icon: ScrollText, hint: 'L', run: onLog },
      { id: 'reset', group: 'Incident', label: 'Reset view', icon: Trash2, run: resetView },
      ...CARRIER_SYSTEMS.map((sys) => {
        const down = systems[sys].health === 'down';
        return { id: sys, group: 'Inject failure', label: `${down ? 'Revive' : 'Kill'} ${names[sys] ?? SYSTEMS[sys].name}`, icon: Power, run: () => toggleCarrier(sys) };
      }),
      { id: 'mode', group: 'Settings', label: mode === 'demo' ? 'Switch to live backend' : 'Switch to scripted demo', icon: RadioTower, run: () => void switchMode() },
      { id: 'theme', group: 'Settings', label: 'Toggle light / dark theme', icon: Moon, run: toggleTheme },
      ...(mode === 'demo' ? [{ id: 'speed', group: 'Settings', label: 'Toggle playback speed', icon: Gauge, run: toggleSpeed }] : []),
    ];
    const q = query.trim().toLowerCase();
    return q ? list.filter((c) => `${c.group} ${c.label}`.toLowerCase().includes(q)) : list;
  }, [query, mode, systems, names, learned, onLog]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setTimeout(() => input.current?.focus(), 10);
    }
  }, [open]);
  useEffect(() => setIndex(0), [query]);

  const run = (c?: Command) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[14vh] backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} onMouseDown={onClose}>
          <motion.div
            role="dialog"
            aria-label="Command menu"
            initial={{ opacity: 0, scale: 0.98, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-[560px] overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
          >
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="h-4 w-4 text-fg-3" />
              <input
                ref={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') (e.preventDefault(), setIndex((i) => Math.min(i + 1, commands.length - 1)));
                  if (e.key === 'ArrowUp') (e.preventDefault(), setIndex((i) => Math.max(i - 1, 0)));
                  if (e.key === 'Enter') run(commands[index]);
                  if (e.key === 'Escape') onClose();
                }}
                placeholder="Type a command…"
                className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-4"
              />
              <Kbd>Esc</Kbd>
            </div>
            <div className="max-h-[320px] overflow-y-auto p-1.5">
              {!commands.length && <div className="px-3 py-6 text-center text-xs text-fg-3">No matching commands</div>}
              {commands.map((c, i) => (
                <div key={c.id}>
                  {(i === 0 || commands[i - 1].group !== c.group) && <div className="px-2 pb-1 pt-2 text-2xs font-medium text-fg-4">{c.group}</div>}
                  <button
                    type="button"
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => run(c)}
                    className={clsx('flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm', i === index ? 'bg-surface-2 text-fg' : 'text-fg-2')}
                  >
                    <c.icon className="h-4 w-4 text-fg-3" strokeWidth={1.75} />
                    {c.label}
                    <span className="ml-auto flex items-center gap-1">
                      {c.hint && <Kbd>{c.hint}</Kbd>}
                      {i === index && <CornerDownLeft className="h-3.5 w-3.5 text-fg-4" />}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
