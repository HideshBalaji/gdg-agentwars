import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { AgentId } from '../lib/contract';
import { AGENTS } from '../lib/meta';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-fg text-bg hover:bg-fg/90 border border-transparent',
  secondary: 'bg-surface text-fg border border-line hover:bg-surface-2 hover:border-line-strong',
  ghost: 'text-fg-2 hover:text-fg hover:bg-surface-2 border border-transparent',
  danger: 'bg-red/10 text-red border border-red/30 hover:bg-red/15',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: LucideIcon; kbd?: string }
>(function Button({ variant = 'secondary', size = 'md', icon: Icon, kbd, className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
        BUTTON[variant],
        className,
      )}
      {...props}
    >
      {Icon && <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={1.75} />}
      {children}
      {kbd && <Kbd className="ml-1">{kbd}</Kbd>}
    </button>
  );
});

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={clsx('rounded border border-line bg-surface-2 px-1 font-mono text-[10px] leading-4 text-fg-3', className)}>
      {children}
    </kbd>
  );
}

export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'accent' | 'violet';

const PILL: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-2 border-line',
  green: 'bg-green/10 text-green border-green/25',
  amber: 'bg-amber/10 text-amber border-amber/25',
  red: 'bg-red/10 text-red border-red/25',
  blue: 'bg-blue/10 text-blue border-blue/25',
  accent: 'bg-accent/10 text-accent border-accent/25',
  violet: 'bg-violet/10 text-violet border-violet/25',
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-fg-3',
  green: 'bg-green',
  amber: 'bg-amber',
  red: 'bg-red',
  blue: 'bg-blue',
  accent: 'bg-accent',
  violet: 'bg-violet',
};

export function Pill({ tone = 'neutral', dot, children, className, title }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={clsx('inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 text-2xs font-medium', PILL[tone], className)}>
      {dot && <span className={clsx('h-1.5 w-1.5 rounded-full', DOT[tone])} />}
      {children}
    </span>
  );
}

export function StatusDot({ tone = 'neutral', pulse }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && <span className={clsx('absolute inset-0 animate-ping2 rounded-full', DOT[tone])} />}
      <span className={clsx('relative inline-flex h-2 w-2 rounded-full', DOT[tone])} />
    </span>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx('flex min-h-0 flex-col rounded-lg border border-line bg-surface', className)}>{children}</section>;
}

export function CardHeader({ title, icon: Icon, children, className }: { title: ReactNode; icon?: LucideIcon; children?: ReactNode; className?: string }) {
  return (
    <header className={clsx('flex h-10 shrink-0 items-center gap-2 border-b border-line px-3', className)}>
      {Icon && <Icon className="h-4 w-4 text-fg-3" strokeWidth={1.75} />}
      <h2 className="text-sm font-medium text-fg">{title}</h2>
      <div className="ml-auto flex items-center gap-1.5">{children}</div>
    </header>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'inline-flex items-center gap-1 rounded-[5px] font-medium transition-colors duration-150',
            size === 'sm' ? 'h-6 px-2 text-2xs' : 'h-7 px-2.5 text-xs',
            value === o.value ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-fg-3 hover:text-fg',
          )}
        >
          {o.label}
          {o.count ? <span className="font-mono text-[10px] text-fg-4">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function AgentAvatar({ agent, size = 20, active }: { agent: AgentId; size?: number; active?: boolean }) {
  const a = AGENTS[agent];
  const Icon = a.icon;
  return (
    <span
      title={`${a.name} · ${a.model}`}
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-md border', active ? 'border-transparent' : 'border-line')}
      style={{ width: size, height: size, background: `${a.color}1f`, boxShadow: active ? `0 0 0 1.5px ${a.color}` : undefined }}
    >
      <Icon style={{ color: a.color, width: size * 0.6, height: size * 0.6 }} strokeWidth={2} />
    </span>
  );
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between px-2 text-2xs font-medium text-fg-3">
      <span>{children}</span>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, actions }: { icon: LucideIcon; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="mb-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-2">
        <Icon className="h-4 w-4 text-fg-3" strokeWidth={1.75} />
      </span>
      <div className="text-sm font-medium text-fg">{title}</div>
      {children && <div className="max-w-xs text-xs text-fg-3">{children}</div>}
      {actions && <div className="mt-2 flex gap-2">{actions}</div>}
    </div>
  );
}
