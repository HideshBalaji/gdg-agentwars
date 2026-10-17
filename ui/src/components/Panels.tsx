import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Brain, Check, ClipboardList, FileText, ListChecks, Minus, Sparkles, Truck, X } from 'lucide-react';
import type { Check as CheckT, Plan } from '../lib/contract';
import { CARRIER_NAME } from '../lib/fleet';
import { fmtDur, fmtInr, fmtTime } from '../lib/format';
import { useStore } from '../lib/store';
import { EmptyState, Pill, type Tone } from './ui';

/* ---------- Plans ---------- */

export function Plans() {
  const { plans, checks, verdicts, selected } = useStore();
  if (!plans.length) {
    return (
      <EmptyState icon={ListChecks} title="No rescue options yet">
        Route &amp; Risk proposes options once Intake has parsed the incident. The Validator rejects any plan that fails a hard check.
      </EmptyState>
    );
  }
  return (
    <div>
      <table className="w-full table-fixed text-xs">
        <colgroup>
          <col className="w-[30%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[11%]" />
          <col className="w-[13%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface text-left text-2xs font-medium text-fg-3">
          <tr className="border-b border-line">
            <th className="h-8 px-3 font-medium">Option</th>
            <th className="font-medium">To site</th>
            <th className="font-medium">Arrives</th>
            <th className="font-medium">Slack</th>
            <th className="pr-3 text-right font-medium">Cost</th>
            <th className="font-medium">Checks</th>
            <th className="pr-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence initial={false}>
            {plans.map((p) => (
              <PlanRow key={p.id} plan={p} checks={checks[p.id] ?? []} verdict={verdicts[p.id]?.verdict} reason={verdicts[p.id]?.reason} chosen={selected?.plan_id === p.id} why={selected?.plan_id === p.id ? selected.reason : undefined} />
            ))}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}

function PlanRow({ plan, checks, verdict, reason, chosen, why }: { plan: Plan; checks: CheckT[]; verdict?: string; reason?: string; chosen: boolean; why?: string }) {
  const rejected = verdict === 'rejected';
  const [label, tone]: [string, Tone] = chosen ? ['Selected', 'accent'] : rejected ? ['Rejected', 'red'] : verdict === 'valid' ? ['Feasible', 'green'] : ['Checking', 'neutral'];
  const note = chosen ? why : rejected ? reason : undefined;
  return (
    <>
      <motion.tr layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={clsx('border-b border-line', note && 'border-b-0', chosen && 'bg-accent/[0.06]', rejected && 'text-fg-3')}>
        <td className="relative h-10 px-3">
          {chosen && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" />}
          <div className={clsx('truncate font-medium', rejected ? 'text-fg-3 line-through decoration-fg-4' : 'text-fg')}>{plan.label}</div>
        </td>
        <td className="font-mono tabular-nums">{plan.arrival_at ? `${plan.eta_to_site_min} min` : '—'}</td>
        <td className="font-mono tabular-nums">{plan.arrival_at ? fmtTime(plan.arrival_at) : '—'}</td>
        <td className="font-mono tabular-nums">{plan.arrival_at ? fmtDur(plan.slack_min) : '—'}</td>
        <td className="pr-3 text-right font-mono tabular-nums">{plan.cost_inr ? fmtInr(plan.cost_inr) : '—'}</td>
        <td>
          <div className="flex items-center gap-0.5">
            {checks.map((c) => (
              <span key={c.id} title={`${c.label}${c.detail ? `: ${c.detail}` : ''}`}
                className={clsx('inline-flex h-4 w-4 items-center justify-center rounded', c.status === 'pass' ? 'bg-green/15 text-green' : c.status === 'fail' ? 'bg-red/15 text-red' : 'bg-surface-3 text-fg-4')}>
                {c.status === 'pass' ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : c.status === 'fail' ? <X className="h-2.5 w-2.5" strokeWidth={3} /> : <Minus className="h-2.5 w-2.5" />}
              </span>
            ))}
          </div>
        </td>
        <td className="pr-3"><Pill tone={tone} dot>{label}</Pill></td>
      </motion.tr>
      {note && (
        <tr className={clsx('border-b border-line', chosen && 'bg-accent/[0.06]')}>
          <td colSpan={7} className="relative px-3 pb-2.5 text-2xs">
            {chosen && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
            <span className={chosen ? 'text-fg-2' : 'text-red'}>{chosen ? 'Why: ' : 'Rejected: '}</span>
            <span className="text-fg-3">{note}</span>
          </td>
        </tr>
      )}
    </>
  );
}

export function Comparison() {
  const comparison = useStore((s) => s.comparison)!;
  const { before, after, preferences } = comparison;
  const saves = before.cost - after.cost;
  const delay = before.arrival_at && after.arrival_at ? Math.round((Date.parse(after.arrival_at) - Date.parse(before.arrival_at)) / 60_000) : null;
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-violet/30 bg-violet/[0.06] p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <Sparkles className="h-3.5 w-3.5 text-violet" />
        Decision changed by feedback
        {preferences.length > 0 && <Pill tone="violet" className="ml-auto font-mono">{preferences.join(', ')}</Pill>}
      </div>
      <div className="mt-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs">
        <Side title="Before rating" choice={before} muted />
        <ArrowRight className="h-4 w-4 text-fg-4" />
        <Side title="After rating" choice={after} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-3">
        {saves > 0 && <span className="font-medium text-green">Saves {fmtInr(saves)}</span>}
        {delay !== null && <span>{delay >= 0 ? `+${delay}` : delay} min delivery</span>}
        <span>Same fleet · healthy carriers · hard checks unchanged</span>
      </div>
      {after.reason && <p className="mt-1.5 text-2xs text-fg-2">“{after.reason}”</p>}
    </motion.div>
  );
}

function Side({ title, choice, muted }: { title: string; choice: { truck_id: string; carrier_id: string; cost: number; arrival_at?: string }; muted?: boolean }) {
  return (
    <div className={clsx('rounded-md border px-2.5 py-2', muted ? 'border-line bg-surface text-fg-3' : 'border-green/30 bg-surface')}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-fg-4">{title}</div>
      <div className={clsx('mt-0.5 font-medium', muted ? 'line-through decoration-fg-4' : 'text-fg')}>{choice.truck_id} · {choice.carrier_id}</div>
      <div className="font-mono text-2xs">{fmtInr(choice.cost)}{choice.arrival_at ? ` · ${fmtTime(choice.arrival_at)}` : ''}</div>
    </div>
  );
}

/* ---------- Details ---------- */

const FACT_TONE: Record<string, string> = { bad: 'text-red', warn: 'text-amber', ok: 'text-green', info: 'text-fg' };

export function Details() {
  const incident = useStore((s) => s.incident);
  if (!incident) return <EmptyState icon={ClipboardList} title="No incident open">Facts extracted by Intake, with their source and confidence, appear here.</EmptyState>;
  return (
    <div className="divide-y divide-line">
      {incident.cargo && (
        <Row label="Cargo">
          {incident.cargo.weight_kg} kg {incident.cargo.name} · {incident.cargo.temp_min_c}–{incident.cargo.temp_max_c} °C · <span className="capitalize">{incident.cargo.priority}</span>
        </Row>
      )}
      {incident.destination && <Row label="Destination">{incident.destination.name}</Row>}
      {incident.facts.map((f) => (
        <Row key={f.id} label={f.label} source={`${f.source}${f.confidence ? ` · ${Math.round(f.confidence * 100)}%` : ''}`}>
          <span className={FACT_TONE[f.tone ?? 'info']}>{f.value}</span>
        </Row>
      ))}
      {incident.evidence.length > 0 && (
        <div className="space-y-2 p-3">
          <div className="text-2xs font-medium text-fg-3">Evidence</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {incident.evidence.map((ev) => (
              <figure key={ev.id} className="overflow-hidden rounded-md border border-line">
                {ev.kind === 'photo' ? <img src={ev.url} alt={ev.name} className="h-32 w-full object-cover" /> : ev.kind === 'voice' ? (
                  <div className="p-2"><audio controls src={ev.url} className="h-8 w-full" />{ev.transcript && <p className="mt-1.5 line-clamp-4 text-2xs italic text-fg-3">“{ev.transcript}”</p>}</div>
                ) : (
                  <a href={ev.url} className="flex items-center gap-2 p-3 text-xs text-fg-2"><FileText className="h-4 w-4" />{ev.name}</a>
                )}
                <figcaption className="border-t border-line px-2 py-1.5 text-[10px] text-fg-3">{ev.caption ?? ev.name}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, source, children }: { label: string; source?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr_auto] items-baseline gap-3 px-3 py-2 text-xs">
      <span className="text-fg-3">{label}</span>
      <span className="min-w-0">{children}</span>
      {source ? <span className="font-mono text-[10px] text-fg-4">{source}</span> : <span />}
    </div>
  );
}

/* ---------- Fleet ---------- */

const TRUCK_STATUS: Record<string, [string, Tone]> = {
  broken: ['Broken down', 'red'],
  rescue: ['Rescue', 'accent'],
  assigned: ['Assigned', 'blue'],
  moving: ['Moving', 'green'],
  idle: ['Available', 'neutral'],
  parked: ['Parked', 'neutral'],
};

export function Fleet() {
  const trucks = Object.values(useStore((s) => s.trucks));
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-surface text-left text-2xs text-fg-3">
        <tr className="border-b border-line">
          <th className="h-8 px-3 font-medium">Truck</th>
          <th className="font-medium">Carrier</th>
          <th className="font-medium">Reefer</th>
          <th className="text-right font-medium">Free kg</th>
          <th className="text-right font-medium">Driver h</th>
          <th className="px-3 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {trucks.map((t) => {
          const [label, tone] = TRUCK_STATUS[t.status] ?? [t.status, 'neutral'];
          return (
            <tr key={t.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
              <td className="h-9 px-3 font-mono font-medium">{t.id}</td>
              <td className="text-fg-2">{CARRIER_NAME[t.carrier_id] ?? t.carrier_id}</td>
              <td>{t.reefer ? <Check className="h-3.5 w-3.5 text-green" /> : <Minus className="h-3.5 w-3.5 text-fg-4" />}</td>
              <td className="text-right font-mono tabular-nums">{Math.round(t.free_kg)}</td>
              <td className={clsx('text-right font-mono tabular-nums', t.driver_hours_left < 1 && 'text-red')}>{t.driver_hours_left}</td>
              <td className="px-3"><Pill tone={tone} dot>{label}</Pill></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------- Memory ---------- */

export function Memory() {
  const prefs = useStore((s) => s.preferences);
  const workarounds = useStore((s) => s.workarounds);
  if (!prefs.length && !workarounds.length) {
    return <EmptyState icon={Brain} title="Nothing learned yet">Rate a decision. The Critic turns feedback into a ranking-only preference that applies to the next comparable incident; hard checks never change.</EmptyState>;
  }
  return (
    <div className="space-y-2 p-3">
      {prefs.map((p) => (
        <div key={p.id} className="rounded-md border border-line p-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-medium">{p.id}</span>
            <Pill tone={p.status === 'active' ? 'green' : 'amber'} dot>{p.status === 'active' ? 'Active' : 'Needs review'}</Pill>
            {p.applied_count > 0 && <span className="ml-auto text-2xs text-fg-3">Applied {p.applied_count}×</span>}
          </div>
          <p className="mt-1.5 text-xs text-fg">{p.rule}</p>
          <p className="mt-1 text-2xs text-fg-3">From {p.source_incident.slice(0, 8)}{p.reason ? ` · “${p.reason}”` : ''}</p>
        </div>
      ))}
      {workarounds.map((w) => (
        <div key={w.id} className="flex items-start gap-2 rounded-md border border-line p-3 text-xs">
          <Truck className="mt-0.5 h-3.5 w-3.5 text-amber" />
          <div>
            <div className="font-medium">{w.provider}</div>
            <div className="text-2xs text-fg-3">{w.note} · until {fmtTime(w.expires_at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

