import { create } from 'zustand';
import type {
  ActionReceipt,
  AgentId,
  ChatMessage,
  Check,
  GhostEvent,
  HealingEvent,
  Health,
  Incident,
  LatLng,
  MapRoute,
  Outcome,
  Plan,
  Preference,
  Rating,
  Reading,
  Stage,
  SystemId,
  ToolCall,
  TruckState,
  Workaround,
} from './contract';
import { STAGES } from './contract';
import { TRUCKS } from './fleet';
import { SYSTEM_ORDER } from './meta';
import { uid } from './format';

export type TabId = 'plans' | 'actions' | 'healing' | 'memory' | 'fleet';
export type Mode = 'demo' | 'live';

export type FeedItem =
  | { kind: 'message'; id: string; message: ChatMessage }
  | { kind: 'tool'; id: string }
  | { kind: 'handover'; id: string; from: AgentId; to: AgentId; reason: string; at: string };

export interface Toast {
  id: string;
  tone: 'ok' | 'bad' | 'info' | 'learn';
  title: string;
  body?: string;
}

interface SystemState {
  health: Health;
  pulse: number;
  calls: number;
}

export interface State {
  mode: Mode;
  connection: 'offline' | 'connecting' | 'online' | 'error';
  clockOffset: number;
  speed: 1 | 2;

  incident: Incident | null;
  history: { id: string; title: string; outcome?: string; rating?: Rating }[];
  stage: Stage | null;
  stagesDone: Stage[];
  owner: AgentId;
  handoverSeq: number;
  lastHandover: { from: AgentId; to: AgentId; reason: string } | null;
  agentStatus: Partial<Record<AgentId, { status: 'idle' | 'thinking' | 'working'; note?: string }>>;
  feed: FeedItem[];
  tools: Record<string, ToolCall>;
  plans: Plan[];
  checks: Record<string, Check[]>;
  verdicts: Record<string, { verdict: 'valid' | 'rejected'; reason?: string }>;
  selected: { plan_id: string; reason: string; preferences?: string[] } | null;
  healing: HealingEvent[];
  actions: ActionReceipt[];
  telemetry: Reading[];
  trucks: Record<string, TruckState>;
  systems: Record<SystemId, SystemState>;
  routes: MapRoute[];
  focus: { center: LatLng; zoom: number };
  sweepAt: number;
  outcome: Outcome | null;
  preferences: Preference[];
  workarounds: Workaround[];
  ratingRequested: boolean;
  rating: Rating | null;
  tab: TabId;
  tabLockUntil: number;
  pings: Partial<Record<TabId, number>>;
  toasts: Toast[];
  chaos: { system: SystemId; until: number } | null;
  alarm: number;
  typing: AgentId | null;
  /** Live mode labels the carrier buttons with the backend's carrier names. */
  carrierNames: Partial<Record<SystemId, string>>;
}

export const DEFAULT_FOCUS = { center: { lat: 12.79, lng: 77.86 }, zoom: 1 };

const freshSystems = () =>
  Object.fromEntries(SYSTEM_ORDER.map((s) => [s, { health: 'up', pulse: 0, calls: 0 }])) as Record<
    SystemId,
    SystemState
  >;

const freshTrucks = () => Object.fromEntries(TRUCKS.map((t) => [t.id, { ...t }]));

/** Fields that belong to one incident and are cleared when the next one opens. */
const incidentScope = () => ({
  incident: null,
  stage: null,
  stagesDone: [] as Stage[],
  owner: 'dispatcher' as AgentId,
  lastHandover: null,
  agentStatus: {},
  feed: [] as FeedItem[],
  tools: {},
  plans: [] as Plan[],
  checks: {},
  verdicts: {},
  selected: null,
  healing: [] as HealingEvent[],
  actions: [] as ActionReceipt[],
  telemetry: [] as Reading[],
  routes: [] as MapRoute[],
  focus: DEFAULT_FOCUS,
  sweepAt: 0,
  outcome: null,
  ratingRequested: false,
  rating: null,
  pings: {},
  chaos: null,
  typing: null,
});

/** 02:06:40 IST, the night of the demo. */
export const DEMO_EPOCH = Date.parse('2026-10-18T02:06:40+05:30');

export const useStore = create<State>()(() => ({
  mode: (import.meta.env.VITE_DEFAULT_MODE as Mode) === 'live' ? 'live' : 'demo',
  connection: 'offline',
  clockOffset: DEMO_EPOCH - Date.now(),
  speed: 1,
  history: [],
  handoverSeq: 0,
  trucks: freshTrucks(),
  systems: freshSystems(),
  preferences: [],
  workarounds: [],
  tab: 'plans',
  tabLockUntil: 0,
  toasts: [],
  alarm: 0,
  carrierNames: {},
  ...incidentScope(),
}));

export const nowMs = () => Date.now() + useStore.getState().clockOffset;
export const nowIso = () => new Date(nowMs()).toISOString();

const set = useStore.setState;
const get = useStore.getState;

export function toast(t: Omit<Toast, 'id'>, ms = 4200) {
  const id = uid('toast');
  set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), ms);
}

function follow(tab: TabId) {
  const s = get();
  const pings = { ...s.pings, [tab]: (s.pings[tab] ?? 0) + 1 };
  if (Date.now() < s.tabLockUntil || s.tab === tab) return { pings };
  return { pings, tab };
}

export function selectTab(tab: TabId) {
  set((s) => ({ tab, tabLockUntil: Date.now() + 9000, pings: { ...s.pings, [tab]: 0 } }));
}

export function resetIncident() {
  set({ ...incidentScope(), trucks: freshTrucks() });
}

export function resetAll() {
  set({
    ...incidentScope(),
    trucks: freshTrucks(),
    systems: freshSystems(),
    preferences: [],
    workarounds: [],
    history: [],
    toasts: [],
    carrierNames: {},
    clockOffset: DEMO_EPOCH - Date.now(),
  });
}

export function setHealth(system: SystemId, health: Health) {
  apply({ type: 'system.health', system, health });
}

export function apply(e: GhostEvent) {
  const s = get();
  switch (e.type) {
    case 'incident.opened': {
      set({
        ...incidentScope(),
        trucks: s.trucks,
        incident: e.incident,
        focus: e.incident.location
          ? { center: e.incident.location, zoom: 1.7 }
          : DEFAULT_FOCUS,
        history: [{ id: e.incident.id, title: e.incident.title }, ...s.history].slice(0, 8),
      });
      return;
    }
    case 'incident.patch':
      if (s.incident) set({ incident: { ...s.incident, ...e.patch } });
      return;
    case 'incident.fact':
      if (s.incident) {
        const facts = s.incident.facts.filter((f) => f.id !== e.fact.id);
        set({ incident: { ...s.incident, facts: [...facts, e.fact] } });
      }
      return;
    case 'incident.evidence':
      if (s.incident) set({ incident: { ...s.incident, evidence: [...s.incident.evidence, e.evidence] } });
      return;
    case 'stage': {
      const idx = STAGES.findIndex((x) => x.id === e.stage);
      set({ stage: e.stage, stagesDone: STAGES.slice(0, idx).map((x) => x.id) });
      return;
    }
    case 'agent.handover': {
      if (e.to === s.owner) return;
      const at = new Date(nowMs()).toISOString();
      set({
        owner: e.to,
        lastHandover: { from: s.owner, to: e.to, reason: e.reason },
        handoverSeq: s.handoverSeq + 1,
        feed: [...s.feed, { kind: 'handover', id: uid('ho'), from: s.owner, to: e.to, reason: e.reason, at }],
      });
      return;
    }
    case 'agent.status':
      set({
        agentStatus: { ...s.agentStatus, [e.agent]: { status: e.status, note: e.note } },
        typing: e.status === 'thinking' ? e.agent : s.typing === e.agent ? null : s.typing,
      });
      return;
    case 'message':
      set({
        feed: [...s.feed, { kind: 'message', id: e.message.id, message: e.message }],
        typing: e.message.agent && s.typing === e.message.agent ? null : s.typing,
      });
      return;
    case 'tool.start': {
      const sys = s.systems[e.call.system];
      set({
        tools: { ...s.tools, [e.call.id]: e.call },
        feed: [...s.feed, { kind: 'tool', id: e.call.id }],
        systems: { ...s.systems, [e.call.system]: { ...sys, pulse: sys.pulse + 1, calls: sys.calls + 1 } },
        agentStatus: { ...s.agentStatus, [e.call.agent]: { status: 'working', note: e.call.tool } },
        sweepAt: /list_trucks_near|find_cold_hubs_near/.test(e.call.tool) ? Date.now() : s.sweepAt,
      });
      return;
    }
    case 'tool.end': {
      const call = s.tools[e.id];
      if (!call) return;
      set({
        tools: { ...s.tools, [e.id]: { ...call, status: e.status, summary: e.summary, latency_ms: e.latency_ms } },
        agentStatus: { ...s.agentStatus, [call.agent]: { status: 'idle' } },
      });
      return;
    }
    case 'plan.candidates': {
      const known = new Set(s.plans.map((p) => p.id));
      set({ plans: [...s.plans, ...e.plans.filter((p) => !known.has(p.id))], ...follow('plans') });
      return;
    }
    case 'plan.check': {
      const list = (s.checks[e.plan_id] ?? []).filter((c) => c.id !== e.check.id);
      set({ checks: { ...s.checks, [e.plan_id]: [...list, e.check] } });
      return;
    }
    case 'plan.verdict':
      set({ verdicts: { ...s.verdicts, [e.plan_id]: { verdict: e.verdict, reason: e.reason } } });
      return;
    case 'plan.selected':
      set({ selected: { plan_id: e.plan_id, reason: e.reason, preferences: e.preferences }, ...follow('plans') });
      return;
    case 'healing': {
      const exists = s.healing.some((h) => h.id === e.event.id);
      const healing = exists
        ? s.healing.map((h) => (h.id === e.event.id ? e.event : h))
        : [...s.healing, e.event];
      const bad = e.event.result === 'in_progress' || e.event.result === 'failed';
      set({ healing, ...follow('healing'), alarm: bad && e.event.level === 'fallback' ? s.alarm + 1 : s.alarm });
      if (!exists && bad && e.event.level !== 'validation') {
        toast({ tone: 'bad', title: `${e.event.tool} failed`, body: e.event.failure });
      }
      if (exists && e.event.result === 'recovered' && e.event.level === 'fallback') {
        toast({ tone: 'ok', title: 'Self-healed', body: e.event.remedy });
      }
      return;
    }
    case 'action': {
      const exists = s.actions.some((a) => a.id === e.receipt.id);
      set({
        actions: exists ? s.actions.map((a) => (a.id === e.receipt.id ? e.receipt : a)) : [...s.actions, e.receipt],
        ...follow('actions'),
      });
      return;
    }
    case 'telemetry':
      set({ telemetry: [...s.telemetry, e.reading].slice(-60) });
      return;
    case 'truck': {
      const prev = s.trucks[e.truck.id];
      set({ trucks: { ...s.trucks, [e.truck.id]: { ...(prev as TruckState), ...e.truck } } });
      return;
    }
    case 'system.health': {
      const sys = s.systems[e.system];
      set({
        systems: { ...s.systems, [e.system]: { ...sys, health: e.health } },
        alarm: e.health === 'down' ? s.alarm + 1 : s.alarm,
      });
      return;
    }
    case 'map.route':
      set({ routes: [...s.routes.filter((r) => r.id !== e.route.id), e.route] });
      return;
    case 'map.focus':
      set({ focus: { center: e.center, zoom: e.zoom } });
      return;
    case 'outcome':
      set({
        outcome: e.outcome,
        incident: s.incident ? { ...s.incident, status: 'resolved' } : s.incident,
        history: s.history.map((h) => (h.id === s.incident?.id ? { ...h, outcome: e.outcome.headline } : h)),
      });
      toast({ tone: 'ok', title: 'Incident resolved', body: e.outcome.headline }, 5200);
      return;
    case 'preference': {
      const exists = s.preferences.some((p) => p.id === e.preference.id);
      set({
        preferences: exists
          ? s.preferences.map((p) => (p.id === e.preference.id ? e.preference : p))
          : [...s.preferences, e.preference],
        ...follow('memory'),
      });
      if (!exists) toast({ tone: 'learn', title: `Learned ${e.preference.id}`, body: e.preference.rule }, 5600);
      return;
    }
    case 'workaround':
      set({ workarounds: [...s.workarounds.filter((w) => w.provider !== e.workaround.provider), e.workaround] });
      return;
    case 'rating.request':
      set({ ratingRequested: true });
      return;
  }
}

export function recordRating(rating: Rating) {
  set((s) => ({
    rating,
    ratingRequested: false,
    history: s.history.map((h) => (h.id === s.incident?.id ? { ...h, rating } : h)),
  }));
}

export function pushUserMessage(text: string, attachments?: ChatMessage['attachments']) {
  const message: ChatMessage = { id: uid('msg'), at: nowIso(), role: 'user', text, attachments };
  apply({ type: 'message', message });
  return message;
}
