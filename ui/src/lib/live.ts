/**
 * Live mode: talks to the FastAPI backend (ghost_dispatcher/api.py) through the
 * Vite proxy and maps its SSE events onto the UI's GhostEvents.
 */
import type { AgentId, Plan, SystemId } from './contract';
import { DESTINATIONS } from './fleet';
import { uid } from './format';
import { apply, nowIso, recordRating, resetIncident, toast, useStore } from './store';

const TOKEN = import.meta.env.VITE_API_TOKEN || 'ghost-demo';
const BASE = import.meta.env.VITE_API_URL || '';
const SYSTEMS: SystemId[] = ['carrier_coldline', 'carrier_frostfleet', 'carrier_polar'];
const AGENT_IDS: AgentId[] = ['dispatcher', 'intake', 'route_risk', 'negotiator', 'comms', 'validator', 'watchdog', 'critic'];

let carrierIds: string[] = [];
let incidentId = '';
let conversationId = '';
let abort: AbortController | null = null;

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? body.detail ?? `${res.status}`);
  return body as T;
}

const agentOf = (name?: string): AgentId => (AGENT_IDS.includes(name as AgentId) ? (name as AgentId) : 'dispatcher');

export async function liveHealth() {
  try {
    const res = await fetch(`${BASE}/health`);
    const ok = res.ok;
    useStore.setState({ connection: ok ? 'online' : 'error' });
    return ok;
  } catch {
    useStore.setState({ connection: 'error' });
    return false;
  }
}

function toPlan(c: any, i: number): Plan {
  return {
    id: `${c.truck_id}`,
    label: `${c.truck_id} · ${c.carrier_id}`,
    kind: 'transfer',
    truck_id: c.truck_id,
    carrier_id: c.carrier_id,
    eta_to_site_min: Math.round(c.travel_minutes),
    arrival_at: c.arrival,
    slack_min: Math.round(c.slack_minutes),
    cost_inr: c.cost,
    distance_km: c.distance_km,
    risk: 'low',
    attempt: i + 1,
    path: [],
    summary: c.route_source,
  };
}

function handle(type: string, data: any) {
  switch (type) {
    case 'validation':
      apply({ type: 'stage', stage: 'validate' });
      for (const r of data.rejected ?? []) {
        const id = String(r.truck_id ?? r.id ?? uid('rej'));
        apply({ type: 'plan.candidates', plans: [{ ...toPlan({ ...r, truck_id: id, travel_minutes: 0, slack_minutes: 0, cost: 0, distance_km: 0 }, 0), label: `${id} · rejected` }] });
        apply({ type: 'plan.check', plan_id: id, check: { id: 'rules', label: 'Validator', status: 'fail', detail: String(r.reason ?? r.reasons ?? 'rejected') } });
        apply({ type: 'plan.verdict', plan_id: id, verdict: 'rejected', reason: String(r.reason ?? r.reasons ?? '') });
      }
      if (data.deadline) apply({ type: 'incident.patch', patch: { rescue_deadline: data.deadline } });
      apply({ type: 'incident.fact', fact: { id: 'feasible', label: 'Feasible plans', value: `${data.feasible}`, source: 'mcp', tone: 'info' } });
      return;
    case 'plan.created': {
      const plans = (data.candidates as any[]).map(toPlan);
      apply({ type: 'stage', stage: 'replan' });
      apply({ type: 'plan.candidates', plans });
      for (const p of plans) {
        apply({ type: 'plan.check', plan_id: p.id, check: { id: 'rules', label: 'Hard checks', status: 'pass' } });
        apply({ type: 'plan.verdict', plan_id: p.id, verdict: 'valid' });
      }
      apply({ type: 'incident.patch', patch: { rescue_deadline: data.deadline, status: 'planning' } });
      apply({ type: 'plan.selected', plan_id: data.chosen.truck_id, reason: data.reason });
      return;
    }
    case 'healing':
      apply({
        type: 'healing',
        event: {
          id: uid('heal'), at: nowIso(), level: data.level ?? 'retry', tool: data.tool ?? 'book_transfer',
          provider: data.provider ?? data.carrier_id, failure: data.error ?? data.status ?? 'failure',
          remedy: `attempt ${data.attempt ?? 1} · ${data.status ?? ''}`, result: data.status === 'replanning' ? 'in_progress' : 'recovered',
        },
      });
      return;
    case 'action.completed':
    case 'integration.completed':
    case 'integration.pending':
      apply({ type: 'stage', stage: type === 'action.completed' ? 'act' : 'notify' });
      apply({
        type: 'action',
        receipt: {
          id: uid('act'), at: nowIso(), kind: type === 'action.completed' ? 'assign' : 'sheet',
          title: type.replace('.', ' '), detail: JSON.stringify(data).slice(0, 140),
          status: type === 'integration.pending' ? 'pending' : 'confirmed',
          system: type === 'action.completed' ? 'logistics_mcp' : 'sheets', simulated: true,
        },
      });
      return;
    case 'incident.resolved':
      apply({ type: 'stage', stage: 'learn' });
      apply({ type: 'outcome', outcome: { headline: data.outcome ?? 'Resolved', cargo_saved: true, actions: useStore.getState().actions.length, healed: useStore.getState().healing.length } });
      apply({ type: 'rating.request' });
      return;
    case 'handover':
      apply({ type: 'agent.handover', to: agentOf(data.to ?? data.to_agent ?? data.active_agent), reason: data.reason ?? 'handover' });
      return;
    case 'message':
      apply({ type: 'message', message: { id: uid('msg'), at: nowIso(), role: 'agent', agent: agentOf(data.author ?? data.agent), text: data.text ?? JSON.stringify(data) } });
      return;
    case 'feedback.saved':
      if (data.preference || data.rule) {
        apply({
          type: 'preference',
          preference: {
            id: 'P-001', rule: 'Prefer the cheapest feasible carrier when there is slack', condition: 'slack', effect: 'rank_by: cost',
            source_incident: incidentId, reason: data.reason ?? '', status: 'active', created_at: nowIso(), applied_count: 0,
          },
        });
      }
      return;
  }
}

async function stream(id: string) {
  abort?.abort();
  abort = new AbortController();
  const res = await fetch(`${BASE}/api/incidents/${id}/events?follow=true`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: abort.signal,
  });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        handle(ev.type, ev.data ?? {});
      } catch {
        /* ignore malformed */
      }
    }
  }
}

async function loadFleet() {
  const fleet = await api<any>('/api/fleet');
  carrierIds = (fleet.carriers ?? []).map((c: any) => c.id);
  for (const t of fleet.trucks ?? []) {
    const lat = t.lat ?? t.location?.lat;
    const lng = t.lng ?? t.location?.lng;
    if (typeof lat === 'number' && typeof lng === 'number') {
      apply({ type: 'truck', truck: { id: t.id, lat, lng, reefer: !!t.reefer, capacity_kg: t.capacity_kg ?? 0, free_kg: t.available_kg ?? t.capacity_kg ?? 0, driver: t.driver_id ?? '', driver_hours_left: t.driver_hours_left ?? 0, status: 'moving', carrier_id: t.carrier_id ?? 'own' } });
    }
  }
  return fleet;
}

export async function liveStart() {
  try {
    resetIncident();
    const fleet = await loadFleet();
    const shipment = (fleet.shipments ?? [])[0]?.id ?? 'SHP-001';
    const inc = await api<any>('/api/incidents', {
      method: 'POST',
      body: JSON.stringify({ shipment_id: shipment, type: 'truck_breakdown', description: 'TN-07 breakdown on NH-48 near Hosur', evidence_ids: [] }),
    });
    incidentId = inc.id;
    apply({
      type: 'incident.opened',
      incident: {
        id: inc.id, type: 'truck_breakdown', title: `Breakdown · ${shipment}`, status: 'open', detected_at: inc.created_at,
        shipment_id: shipment, location: { id: 'site', name: 'NH-48 near Hosur', lat: 12.716, lng: 77.87 },
        destination: DESTINATIONS.hospital, evidence: [], facts: [],
      },
    });
    apply({ type: 'stage', stage: 'detect' });
    stream(inc.id).catch(() => undefined);
    const conv = await api<any>('/api/conversations', { method: 'POST', body: JSON.stringify({ incident_id: inc.id }) });
    conversationId = conv.id;
    await liveSend('Plan a rescue');
    apply({ type: 'stage', stage: 'replan' });
    await api(`/api/incidents/${inc.id}/plan`, { method: 'POST' });
    apply({ type: 'stage', stage: 'act' });
    await api(`/api/incidents/${inc.id}/execute`, { method: 'POST' });
  } catch (e) {
    toast({ tone: 'bad', title: 'Backend error', body: (e as Error).message });
  }
}

export async function liveSend(text: string) {
  if (!conversationId) return;
  if (text !== 'Plan a rescue') apply({ type: 'message', message: { id: uid('msg'), at: nowIso(), role: 'user', text } });
  apply({ type: 'agent.status', agent: useStore.getState().owner, status: 'thinking' });
  const reply = await api<any>(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
  apply({ type: 'agent.handover', to: agentOf(reply.active_agent), reason: 'Backend routing' });
  for (const r of reply.replies ?? []) {
    apply({ type: 'message', message: { id: uid('msg'), at: nowIso(), role: 'agent', agent: agentOf(r.author ?? r.agent ?? reply.active_agent), text: r.text ?? String(r.content ?? '') } });
  }
  apply({ type: 'agent.status', agent: agentOf(reply.active_agent), status: 'idle' });
}

export async function liveRate(thumbs: 'up' | 'down', reason: string) {
  recordRating({ thumbs, reason });
  try {
    await api(`/api/incidents/${incidentId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating: thumbs, reason, prefer_cheaper_when_slack: /expens|cost|cheap|price/i.test(reason) }),
    });
  } catch (e) {
    toast({ tone: 'bad', title: 'Feedback failed', body: (e as Error).message });
  }
}

export async function liveToggleCarrier(system: SystemId) {
  const idx = SYSTEMS.indexOf(system);
  const id = carrierIds[idx];
  if (!id) return toast({ tone: 'bad', title: 'Unknown carrier', body: 'Load the fleet first' });
  const down = useStore.getState().systems[system].health !== 'down';
  try {
    await api(`/api/demo/carriers/${id}/${down ? 'kill' : 'revive'}`, { method: 'POST' });
    apply({ type: 'system.health', system, health: down ? 'down' : 'up' });
  } catch (e) {
    toast({ tone: 'bad', title: 'Kill switch failed', body: (e as Error).message });
  }
}

export function carrierLabel(system: SystemId) {
  return carrierIds[SYSTEMS.indexOf(system)];
}
