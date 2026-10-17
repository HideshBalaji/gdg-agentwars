/**
 * Scripted demo engine. Scenarios emit the same `GhostEvent`s the backend will
 * stream, so every panel is exercised without a backend or API keys.
 */
import type {
  ActionReceipt,
  AgentId,
  Check,
  Evidence,
  Fact,
  GhostEvent,
  HealingEvent,
  Plan,
  Preference,
  Stage,
  SystemId,
} from '../contract';
import { apply, nowMs, useStore } from '../store';
import { uid } from '../format';

export interface Run {
  cancelled: boolean;
  cleanups: (() => void)[];
}

export type Ctx = ReturnType<typeof makeCtx>;

let pendingReply: ((text: string) => void) | null = null;

/** Called by the chat when the user sends a message; returns true if a script consumed it. */
export function offerReply(text: string) {
  if (!pendingReply) return false;
  const r = pendingReply;
  pendingReply = null;
  r(text);
  return true;
}

export function makeCtx(run: Run) {
  const speed = () => useStore.getState().speed;
  const emit = (e: GhostEvent) => {
    if (!run.cancelled) apply(e);
  };
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      if (run.cancelled) return;
      const t = window.setTimeout(() => {
        if (!run.cancelled) resolve();
      }, ms / speed());
      run.cleanups.push(() => clearTimeout(t));
    });
  const iso = (offsetMin = 0) => new Date(nowMs() + offsetMin * 60_000).toISOString();
  const isDown = (system: SystemId) => useStore.getState().systems[system].health === 'down';

  const ctx = {
    run,
    emit,
    wait,
    iso,
    isDown,
    now: nowMs,

    stage(stage: Stage) {
      emit({ type: 'stage', stage });
    },

    async handover(to: AgentId, reason: string) {
      emit({ type: 'agent.handover', to, reason });
      await wait(700);
    },

    status(agent: AgentId, status: 'idle' | 'thinking' | 'working', note?: string) {
      emit({ type: 'agent.status', agent, status, note });
    },

    async say(agent: AgentId, text: string, quick_replies?: string[]) {
      emit({ type: 'agent.status', agent, status: 'thinking' });
      await wait(650 + Math.min(text.length * 6, 1100));
      emit({
        type: 'message',
        message: { id: uid('msg'), at: iso(), role: 'agent', agent, text, quick_replies },
      });
      emit({ type: 'agent.status', agent, status: 'idle' });
      await wait(400 + Math.min(text.length * 9, 1600));
    },

    async external(author: string, text: string, attachments?: Evidence[]) {
      emit({ type: 'message', message: { id: uid('msg'), at: iso(), role: 'external', author, text, attachments } });
      await wait(500 + Math.min(text.length * 8, 1400));
    },

    system(text: string) {
      emit({ type: 'message', message: { id: uid('msg'), at: iso(), role: 'system', text } });
    },

    toolStart(agent: AgentId, system: SystemId, tool: string, args: string) {
      const id = uid('tool');
      emit({ type: 'tool.start', call: { id, at: iso(), agent, system, tool, args, status: 'running' } });
      return id;
    },

    toolEnd(id: string, ok: boolean, summary: string, ms = 600) {
      emit({
        type: 'tool.end',
        id,
        status: ok ? 'ok' : 'error',
        summary,
        latency_ms: Math.round(ms * (0.85 + Math.random() * 0.3)),
      });
    },

    /** Runs a tool call; fails automatically if its system is down. */
    async tool(
      agent: AgentId,
      system: SystemId,
      tool: string,
      args: string,
      opts: { ms?: number; summary: string; error?: string },
    ) {
      const ms = opts.ms ?? 700;
      const id = ctx.toolStart(agent, system, tool, args);
      await wait(ms);
      const error = opts.error ?? (isDown(system) ? '503 Service Unavailable' : undefined);
      ctx.toolEnd(id, !error, error ?? opts.summary, ms);
      await wait(220);
      return !error;
    },

    /**
     * Holds an in-flight call open so the presenter can kill the provider.
     * Real seconds (not speed-scaled): a human has to click.
     */
    chaosWindow(system: SystemId, ms: number) {
      if (isDown(system)) return Promise.resolve(true);
      useStore.setState({ chaos: { system, until: Date.now() + ms } });
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const done = (killed: boolean) => {
          if (settled) return;
          settled = true;
          unsub();
          clearTimeout(t);
          useStore.setState({ chaos: null });
          if (!run.cancelled) resolve(killed);
        };
        const unsub = useStore.subscribe((s) => {
          if (s.systems[system].health === 'down') done(true);
        });
        const t = window.setTimeout(() => done(false), ms);
        run.cleanups.push(() => done(false));
      });
    },

    /** Waits for the user to answer in chat; auto-answers after `timeoutMs`. */
    ask(fallback: string, timeoutMs = 7000) {
      return new Promise<string>((resolve) => {
        const t = window.setTimeout(() => {
          pendingReply = null;
          if (!run.cancelled) resolve(fallback);
        }, timeoutMs);
        pendingReply = (text) => {
          clearTimeout(t);
          if (!run.cancelled) resolve(text);
        };
        run.cleanups.push(() => {
          clearTimeout(t);
          pendingReply = null;
        });
      });
    },

    every(ms: number, fn: () => void) {
      const t = window.setInterval(() => !run.cancelled && fn(), ms);
      run.cleanups.push(() => clearInterval(t));
    },

    fact(fact: Omit<Fact, 'id'> & { id?: string }) {
      emit({ type: 'incident.fact', fact: { id: fact.id ?? uid('fact'), ...fact } });
    },

    healing(event: Omit<HealingEvent, 'at'> & { at?: string }) {
      emit({ type: 'healing', event: { at: iso(), ...event } });
    },

    action(receipt: Omit<ActionReceipt, 'at' | 'simulated'> & { at?: string }) {
      emit({ type: 'action', receipt: { at: iso(), simulated: true, ...receipt } });
    },

    async validate(plan: Plan, checks: Check[]) {
      emit({ type: 'agent.status', agent: 'validator', status: 'working', note: `validate ${plan.id}` });
      for (const c of checks) emit({ type: 'plan.check', plan_id: plan.id, check: { ...c, status: 'pending' } });
      for (const c of checks) {
        await wait(380);
        emit({ type: 'plan.check', plan_id: plan.id, check: c });
      }
      const failed = checks.find((c) => c.status === 'fail');
      await wait(250);
      emit({
        type: 'plan.verdict',
        plan_id: plan.id,
        verdict: failed ? 'rejected' : 'valid',
        reason: failed ? failed.detail : undefined,
      });
      emit({ type: 'agent.status', agent: 'validator', status: 'idle' });
      return !failed;
    },
  };
  return ctx;
}

/* ---------- shared helpers for scenarios ---------- */

export function check(label: string, ok: boolean, detail?: string): Check {
  return { id: label.toLowerCase().replace(/\W+/g, '-'), label, status: ok ? 'pass' : 'fail', detail };
}

/** Ranking with learned preferences applied. Hard checks have already filtered `valid`. */
export function rank(valid: Plan[], prefs: Preference[], carrierReliability: Record<string, number>) {
  const active = prefs.filter((p) => p.status === 'active');
  const applied: Preference[] = [];
  let pool = [...valid];

  const reliability = active.find((p) => p.effect.includes('reliability'));
  if (reliability) {
    const reliable = pool.filter((p) => (carrierReliability[p.carrier_id ?? ''] ?? 1) >= 0.95);
    if (reliable.length && reliable.length < pool.length) {
      pool = reliable;
      applied.push(reliability);
    }
  }

  const cost = active.find((p) => p.effect.includes('cost'));
  const slackOk = pool.every((p) => p.slack_min > 60);
  if (cost && slackOk && pool.length > 1) {
    applied.push(cost);
    pool.sort((a, b) => a.cost_inr - b.cost_inr);
    return { plan: pool[0], applied, by: 'cost' as const };
  }
  pool.sort((a, b) => a.eta_to_site_min - b.eta_to_site_min);
  return { plan: pool[0], applied, by: 'time' as const };
}

export function bumpApplied(prefs: Preference[], emit: (e: GhostEvent) => void) {
  for (const p of prefs) emit({ type: 'preference', preference: { ...p, applied_count: p.applied_count + 1 } });
}
