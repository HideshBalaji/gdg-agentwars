import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { HeartPulse, Route as RouteIcon, Sparkles, Thermometer, Timer, type LucideIcon } from 'lucide-react';
import { fmtCountdown, fmtDur, fmtInr, fmtTime } from '../lib/format';
import { nowMs, useStore } from '../lib/store';
import { Pill } from './ui';

export function useTick(ms = 1000) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** The four numbers that matter during an incident, in one quiet card. */
export function MetricsCard() {
  useTick();
  const s = useStore();
  const inc = s.incident;
  if (!inc) return null;

  const left = inc.rescue_deadline ? Date.parse(inc.rescue_deadline) - nowMs() : 0;
  const total = inc.rescue_deadline ? Math.max(left, Date.parse(inc.rescue_deadline) - Date.parse(inc.detected_at)) : 1;
  const frac = inc.rescue_deadline ? Math.max(0, Math.min(1, left / total)) : 0;
  const bar = frac > 0.5 ? 'bg-green' : frac > 0.25 ? 'bg-amber' : 'bg-red';
  const plan = s.plans.find((p) => p.id === s.selected?.plan_id);
  const learned = !!s.comparison || !!s.selected?.preferences?.length;
  const recovered = s.healing.filter((h) => h.result === 'recovered' && h.level !== 'validation').length;
  // Validation re-plans are normal planning, not failures.
  const recovering = s.healing.some((h) => h.result === 'in_progress' && h.level !== 'validation');
  const reading = s.telemetry[s.telemetry.length - 1];

  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface">
      <Metric icon={Timer} label="Rescue window" className="border-b border-r border-line"
        foot={inc.rescue_deadline ? `Deadline ${fmtTime(inc.rescue_deadline)} · estimate` : 'Calculating…'}>
        <Value>{inc.rescue_deadline ? fmtCountdown(left) : '--:--:--'}</Value>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
          <motion.div className={clsx('h-full rounded-full', bar)} initial={false} animate={{ width: `${frac * 100}%` }} transition={{ duration: 0.6 }} />
        </div>
      </Metric>
      <Metric icon={Thermometer} label="Cargo temperature" className="border-b border-line"
        foot={inc.cargo ? `Safe ${inc.cargo.temp_min_c}–${inc.cargo.temp_max_c} °C${reading ? '' : ' · no live sensor'}` : '—'}>
        <div className="flex items-end justify-between gap-2">
          <Value>{reading ? `${reading.temp_c.toFixed(1)} °C` : inc.cargo ? `${inc.cargo.temp_min_c}–${inc.cargo.temp_max_c} °C` : '—'}</Value>
          {s.telemetry.length > 2 && <Sparkline values={s.telemetry.map((r) => r.temp_c)} limit={inc.cargo?.temp_max_c ?? 8} />}
        </div>
      </Metric>
      <Metric icon={RouteIcon} label="Rescue plan" className="border-r border-line"
        foot={plan ? `${fmtInr(plan.cost_inr)} · arrives ${fmtTime(plan.arrival_at)} · ${fmtDur(plan.slack_min)} spare` : 'Not chosen yet'}>
        <div className="flex min-w-0 items-center gap-1.5">
          <Value className="truncate">{plan ? plan.truck_id ?? plan.label : '—'}</Value>
          {learned && <Pill tone="violet"><Sparkles className="h-3 w-3" />Learned</Pill>}
        </div>
      </Metric>
      <Metric icon={HeartPulse} label="Self-healing"
        foot={`${s.actions.length} action${s.actions.length === 1 ? '' : 's'} taken`}>
        <div className="flex items-center gap-1.5">
          <Value>{recovered}</Value>
          <span className="text-xs text-fg-3">recovered</span>
          {recovering && <Pill tone="amber" dot>recovering</Pill>}
        </div>
      </Metric>
    </div>
  );
}

function Metric({ icon: Icon, label, foot, children, className }: { icon: LucideIcon; label: string; foot: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('min-w-0 p-3', className)}>
      <div className="mb-1 flex items-center gap-1.5 text-2xs text-fg-3"><Icon className="h-3.5 w-3.5" strokeWidth={1.75} />{label}</div>
      {children}
      <div className="mt-1 truncate text-2xs text-fg-4">{foot}</div>
    </div>
  );
}

function Value({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('whitespace-nowrap font-mono text-lg font-medium tabular-nums leading-6 tracking-tight', className)}>{children}</div>;
}

function Sparkline({ values, limit }: { values: number[]; limit: number }) {
  const w = 72;
  const h = 24;
  const min = Math.min(...values, limit - 4);
  const max = Math.max(...values, limit + 0.5);
  const y = (v: number) => h - ((v - min) / (max - min)) * h;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="shrink-0 overflow-visible" aria-hidden>
      <line x1="0" x2={w} y1={y(limit)} y2={y(limit)} stroke="rgb(var(--c-red))" strokeOpacity="0.6" strokeDasharray="2 3" />
      <polyline points={pts} fill="none" stroke="rgb(var(--c-amber))" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
