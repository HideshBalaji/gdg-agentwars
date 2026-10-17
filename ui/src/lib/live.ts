/**
 * Live mode: talks to the FastAPI backend (ghost_dispatcher/api.py, see docs/BACKEND.md)
 * through the Vite proxy and maps its SSE events onto the UI's GhostEvents.
 */
import type { AgentId, Evidence, LatLng, Plan, Place, SystemId } from './contract';
import { fmtInr, fmtTime, uid } from './format';
import { MAP_H, MAP_W, project } from './geo';
import { apply, nowIso, recordRating, resetIncident, toast, useStore, type Choice } from './store';
import { takeReady, uploading } from './evidence';

const TOKEN = import.meta.env.VITE_API_TOKEN || 'ghost-demo';
const BASE = import.meta.env.VITE_API_URL || '';
/** The three carrier buttons map onto the backend's carriers in order. */
const BUTTONS: SystemId[] = ['carrier_coldline', 'carrier_frostfleet', 'carrier_polar'];
const AGENT_IDS: AgentId[] = ['dispatcher', 'intake', 'route_risk', 'negotiator', 'comms', 'validator', 'watchdog', 'critic'];

let carrierIds: string[] = [];
let incidentId = '';
let conversationId = '';
let site: Place | null = null;
let chosen: Plan | null = null;
let abort: AbortController | null = null;
const currentChosen = (): Plan | null => chosen;
/** Set while a comparable incident runs: the rated incident's first choice. */
let compareBaseline: Choice | null = null;

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(body.detail) ? body.detail.map((d: any) => d.msg).join('; ') : body.detail;
    throw new Error(body.message ? `${body.code}: ${body.message}` : detail ?? `HTTP ${res.status}`);
  }
  return body as T;
}

const agentOf = (name?: string): AgentId => (AGENT_IDS.includes(name as AgentId) ? (name as AgentId) : 'dispatcher');
const systemOf = (carrierId?: string): SystemId => BUTTONS[carrierIds.indexOf(carrierId ?? '')] ?? 'logistics_mcp';
const truckAt = (id?: string): LatLng | null => {
  const t = id ? useStore.getState().trucks[id] : undefined;
  return t ? { lat: t.lat, lng: t.lng } : null;
};

export async function liveHealth() {
  try {
    const res = await fetch(`${BASE}/health`);
    useStore.setState({ connection: res.ok ? 'online' : 'error' });
    if (res.ok) await loadFleet();
    return res.ok;
  } catch {
    useStore.setState({ connection: 'error' });
    toast({ tone: 'bad', title: 'Backend unreachable', body: 'Start it with make api, then click the badge again' });
    return false;
  }
}

function toPlan(c: any, attempt: number): Plan {
  return {
    id: c.truck_id,
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
    attempt,
    path: [],
    summary: c.route_source,
  };
}

/** Agent replies embed the plan as JSON; turn that into a sentence. */
function prettify(text: string) {
  const body = text.replace(/^\[SIMULATED[^\]]*\]\s*/, '');
  try {
    const raw = JSON.parse(body);
    // Replies carry either a plan or a whole incident (with its plan).
    const p = raw?.chosen ? raw : raw?.plan;
    const status = raw?.status && raw?.plan ? `Incident ${raw.status}. ` : '';
    if (p?.chosen) {
      const c = p.chosen;
      return `${status}${c.truck_id} via ${c.carrier_id}: ${fmtInr(c.cost)}, cold again by ${fmtTime(c.cold_restore_at ?? c.arrival)}, delivered ${fmtTime(c.arrival)} (${Math.round(c.slack_minutes)} min slack). ${p.candidates?.length ?? 1} feasible option(s). Reason: ${p.reason}. [simulated]`;
    }
    if (raw?.status) return `Incident ${raw.status}${raw.outcome ? `: ${raw.outcome}` : ''}. [simulated]`;
    const p2 = raw;
    return `${JSON.stringify(p2).slice(0, 280)} [simulated]`;
  } catch {
    return text;
  }
}

let attempt = 0;
const retries: Record<string, string> = {};
let fallbackId = '';

function handle(type: string, data: any) {
  switch (type) {
    case 'validation': {
      apply({ type: 'stage', stage: 'validate' });
      for (const r of data.rejected ?? []) {
        const reason = Array.isArray(r.reason) ? r.reason.join(', ') : String(r.reason ?? 'rejected');
        const truck = useStore.getState().trucks[r.truck_id];
        apply({
          type: 'plan.candidates',
          plans: [{ ...toPlan({ truck_id: r.truck_id, carrier_id: truck?.carrier_id ?? '', travel_minutes: 0, slack_minutes: 0, cost: 0, distance_km: 0, route_source: 'validator', arrival: '' }, 1) }],
        });
        apply({ type: 'plan.check', plan_id: r.truck_id, check: { id: 'hard', label: 'Hard checks', status: 'fail', detail: reason } });
        apply({ type: 'plan.verdict', plan_id: r.truck_id, verdict: 'rejected', reason });
      }
      if (data.deadline) apply({ type: 'incident.patch', patch: { rescue_deadline: data.deadline } });
      apply({ type: 'incident.fact', fact: { id: 'feasible', label: 'Feasible rescue options', value: `${data.feasible} (${data.estimate ?? 'synthetic'})`, source: 'mcp', tone: data.feasible ? 'info' : 'bad' } });
      return;
    }
    case 'plan.created': {
      attempt += 1;
      const plans = (data.candidates as any[]).map((c) => toPlan(c, attempt));
      apply({ type: 'stage', stage: 'replan' });
      apply({ type: 'plan.candidates', plans });
      for (const p of plans) {
        apply({ type: 'plan.check', plan_id: p.id, check: { id: 'hard', label: 'Reefer · capacity · deadline · hours', status: 'pass' } });
        apply({ type: 'plan.verdict', plan_id: p.id, verdict: 'valid' });
      }
      chosen = plans.find((p) => p.id === data.chosen.truck_id) ?? plans[0];
      apply({ type: 'incident.patch', patch: { rescue_deadline: data.deadline, status: 'planning' } });
      const learned = /learned preference/i.test(data.reason ?? '');
      const prefs = learned ? useStore.getState().preferences.map((p) => p.id) : [];
      apply({ type: 'plan.selected', plan_id: chosen.id, reason: data.reason, preferences: prefs });
      if (attempt === 1) {
        const c = data.chosen;
        const choice: Choice = { truck_id: c.truck_id, carrier_id: c.carrier_id, cost: c.cost, arrival_at: c.arrival, reason: data.reason, incident_id: incidentId };
        if (compareBaseline) {
          if (compareBaseline.truck_id !== c.truck_id || compareBaseline.cost !== c.cost) {
            useStore.setState({ comparison: { before: compareBaseline, after: choice, preferences: prefs } });
            toast({ tone: 'learn', title: 'Decision changed by feedback', body: `${compareBaseline.truck_id} ${fmtInr(compareBaseline.cost)} → ${c.truck_id} ${fmtInr(c.cost)}` }, 6000);
          }
          compareBaseline = null;
        }
        useStore.setState({ lastFirstChoice: choice });
      }
      const from = truckAt(chosen.truck_id);
      if (from && site) apply({ type: 'map.route', route: { id: 'rescue', kind: 'rescue', path: [from, site], duration_s: 0.01 } });
      return;
    }
    case 'healing': {
      const provider = data.provider ?? 'carrier';
      if (data.level === 'circuit') {
        // Learned workaround: an open circuit skips the provider until it is revived/probed.
        apply({ type: 'healing', event: { id: uid('heal'), at: nowIso(), level: 'learned', tool: 'book_transfer', provider, failure: `${provider} circuit open`, remedy: 'Skipped without calling it until a recovery probe', result: 'recovered' } });
        return;
      }
      if (data.level === 'fallback') {
        fallbackId = uid('heal');
        if (chosen) apply({ type: 'plan.verdict', plan_id: chosen.id, verdict: 'rejected', reason: `${chosen.carrier_id} down after retries` });
        apply({ type: 'healing', event: { id: fallbackId, at: nowIso(), level: 'fallback', tool: 'book_transfer', provider: `${chosen?.carrier_id ?? provider} → next carrier`, failure: 'Primary carrier down after retries', remedy: `Re-planning without it (attempt ${data.attempt})`, result: 'in_progress' } });
        apply({ type: 'agent.status', agent: 'watchdog', status: 'working', note: 'fallback' });
        return;
      }
      retries[provider] = retries[provider] ?? uid('heal');
      const ok = data.status === 'recovered';
      apply({
        type: 'healing',
        event: {
          id: retries[provider], at: nowIso(), level: data.level ?? 'retry', tool: 'book_transfer', provider,
          failure: ok ? 'none' : `Booking failed (attempt ${data.attempt})`,
          remedy: ok ? `Booked on attempt ${data.attempt}` : `Retry ${data.attempt}/3 with backoff`,
          result: ok ? 'recovered' : data.attempt >= 3 ? 'failed' : 'in_progress', attempt: `${data.attempt}/3`,
        },
      });
      if (ok && fallbackId && chosen) {
        apply({ type: 'healing', event: { id: fallbackId, at: nowIso(), level: 'fallback', tool: 'book_transfer', provider: `→ ${provider}`, failure: 'Primary carrier down after retries', remedy: `Booked ${chosen.truck_id} via ${provider}`, result: 'recovered' } });
      }
      if (ok) apply({ type: 'action', receipt: { id: uid('act'), at: nowIso(), kind: 'booking', title: `Booking via ${provider}`, detail: `${chosen?.truck_id ?? ''} · ${fmtInr(chosen?.cost_inr ?? 0)}`, status: 'confirmed', system: systemOf(provider), simulated: true } });
      return;
    }
    case 'action.completed': {
      apply({ type: 'stage', stage: 'act' });
      apply({ type: 'action', receipt: { id: uid('act'), at: nowIso(), kind: 'assign', title: `${data.shipment_id} → ${data.truck_id}`, detail: `Dock at ${fmtTime(data.dock_time)}`, status: 'confirmed', system: 'logistics_mcp', simulated: !!data.simulated } });
      apply({ type: 'truck', truck: { id: data.truck_id, status: 'rescue' } });
      const from = truckAt(data.truck_id);
      if (from && site) apply({ type: 'map.route', route: { id: 'drive', kind: 'rescue', path: [from, site], truck_id: data.truck_id, duration_s: 4 } });
      return;
    }
    case 'integration.completed':
    case 'integration.pending': {
      apply({ type: 'stage', stage: 'notify' });
      const pending = type === 'integration.pending';
      const rows: [string, SystemId, string][] = [
        ['sheets', 'sheets', 'Fleet board'],
        ['calendar', 'calendar', 'Dock slot'],
        ['gmail', 'gmail', 'Customer notification'],
      ];
      for (const [key, system, title] of rows) {
        apply({ type: 'action', receipt: { id: uid('act'), at: nowIso(), kind: key === 'gmail' ? 'email' : key === 'calendar' ? 'dock' : 'sheet', title, detail: pending ? `pending: ${data.error_type}` : String(data[key] ?? 'done'), status: pending ? 'pending' : 'confirmed', system, simulated: data.simulated !== false } });
      }
      return;
    }
    case 'incident.resolved': {
      apply({ type: 'stage', stage: 'learn' });
      const c = data.plan?.chosen;
      apply({
        type: 'outcome',
        outcome: {
          headline: c ? `${data.shipment_id} rescued by ${c.truck_id} via ${c.carrier_id} · ${data.outcome}` : data.outcome,
          arrival_at: c?.arrival, slack_min: c?.slack_minutes, cost_inr: c?.cost, cargo_saved: true,
          actions: useStore.getState().actions.length, healed: useStore.getState().healing.length,
        },
      });
      apply({ type: 'agent.handover', to: 'dispatcher', reason: 'Wrap up' });
      apply({ type: 'message', message: { id: uid('msg'), at: nowIso(), role: 'agent', agent: 'dispatcher', text: 'Rescue complete (simulated). Rate this decision so the Critic can learn.' } });
      apply({ type: 'rating.request' });
      return;
    }
    case 'handover':
      apply({ type: 'agent.handover', to: agentOf(data.to), reason: data.reason ?? 'handover' });
      return;
    case 'message':
      apply({ type: 'message', message: { id: uid('msg'), at: nowIso(), role: 'agent', agent: agentOf(data.agent), text: prettify(String(data.text ?? '')) } });
      return;
    case 'feedback.saved':
      loadPreferences(data.reason);
      return;
  }
}

async function loadPreferences(reason = '') {
  const prefs = await api<any[]>('/api/preferences').catch(() => []);
  prefs.forEach((p, i) => {
    const rule =
      p.rule === 'cost_delay_budget'
        ? `Prefer a carrier that saves ≥ ${fmtInr(p.min_savings)} if it adds ≤ ${p.max_delay} min, within both deadlines`
        : String(p.rule);
    apply({
      type: 'preference',
      preference: {
        id: `P-${String(i + 1).padStart(3, '0')}`, rule, condition: JSON.stringify(p.scope ?? {}), effect: 'rank_by: cost',
        source_incident: p.source_incident ?? incidentId, reason, status: 'active', created_at: nowIso(), applied_count: 0,
      },
    });
  });
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
      } catch (e) {
        console.warn('Unhandled event', e);
      }
      // Events arrive in bursts; spacing them lets the animations read.
      await new Promise((r) => setTimeout(r, 450 / useStore.getState().speed));
    }
  }
}

let fleetCache: any = null;

async function loadFleet() {
  const fleet = await api<any>('/api/fleet');
  fleetCache = fleet;
  carrierIds = (fleet.carriers ?? []).map((c: any) => c.id);
  useStore.setState({
    carrierNames: Object.fromEntries(BUTTONS.map((b, i) => [b, fleet.carriers?.[i]?.name ?? b])),
    clockOffset: fleet.decision_clock ? Date.parse(fleet.decision_clock) - Date.now() : 0,
  });
  const trucks = Object.fromEntries(
    (fleet.trucks ?? []).map((t: any) => [
      t.id,
      {
        id: t.id, carrier_id: t.carrier_id ?? 'own', reefer: !!t.reefer, capacity_kg: t.capacity_kg ?? 0,
        free_kg: t.available_capacity_kg ?? 0, driver: t.driver_id ?? '', driver_hours_left: t.driver_hours_left ?? 0,
        status: t.status === 'broken' ? 'broken' : t.status === 'available' ? 'idle' : t.status === 'assigned' ? 'assigned' : 'parked',
        lat: t.location?.lat ?? 0, lng: t.location?.lng ?? 0,
      },
    ]),
  );
  useStore.setState({ trucks });
  return fleet;
}

function fitFocus(points: LatLng[]) {
  const xs = points.map((p) => project(p));
  const minX = Math.min(...xs.map((p) => p.x));
  const maxX = Math.max(...xs.map((p) => p.x));
  const minY = Math.min(...xs.map((p) => p.y));
  const maxY = Math.max(...xs.map((p) => p.y));
  const zoom = Math.max(0.6, Math.min(3, Math.min(MAP_W / ((maxX - minX) * 1.6 || 1), MAP_H / ((maxY - minY) * 1.6 || 1))));
  const lat = points.reduce((a, p) => a + p.lat, 0) / points.length;
  const lng = points.reduce((a, p) => a + p.lng, 0) / points.length;
  apply({ type: 'map.focus', center: { lat, lng }, zoom });
}

/** Holds between plan and execute so the presenter can kill the chosen carrier. */
function chaosWindow(system: SystemId, ms: number) {
  if (useStore.getState().systems[system].health === 'down') return Promise.resolve();
  useStore.setState({ chaos: { system, until: Date.now() + ms } });
  return new Promise<void>((resolve) => {
    const done = () => {
      unsub();
      clearTimeout(t);
      useStore.setState({ chaos: null });
      setTimeout(resolve, 600);
    };
    const unsub = useStore.subscribe((s) => s.systems[system].health === 'down' && done());
    const t = setTimeout(done, ms);
  });
}

export async function liveStart(opts: { shipmentId?: string; comparable?: boolean; note?: string } = {}) {
  const { shipmentId, comparable = false, note } = opts;
  try {
    if (uploading()) {
      toast({ tone: 'info', title: 'Evidence still uploading', body: 'Try again in a moment' });
      return;
    }
    const evidence = takeReady();
    const evidenceIds = evidence.map((e) => e.backend_id).filter((id): id is string => !!id);
    abort?.abort();
    resetIncident();
    attempt = 0;
    fallbackId = '';
    chosen = null;
    for (const k of Object.keys(retries)) delete retries[k];
    const fleet = await loadFleet();
    const shipment = (fleet.shipments ?? []).find((s: any) => s.id === (shipmentId ?? 'SHP-001')) ?? fleet.shipments?.[0];
    const own = fleet.trucks.find((t: any) => t.id === shipment.truck_id);
    const broken = own?.status === 'broken' ? own : fleet.trucks.find((t: any) => t.status === 'broken') ?? own;
    site = { id: 'site', name: `${broken?.id ?? 'Truck'} breakdown`, lat: broken.location.lat, lng: broken.location.lng };
    const destination: Place = { id: 'dst', name: shipment.destination?.label || 'Receiver', lat: shipment.destination.lat, lng: shipment.destination.lng };

    const inc = await api<any>('/api/incidents', {
      method: 'POST',
      body: JSON.stringify({ shipment_id: shipment.id, type: 'truck_breakdown', description: `${broken?.id} breakdown near Hosur, reefer cargo at risk`, evidence_ids: evidenceIds }),
    });
    incidentId = inc.id;
    apply({
      type: 'incident.opened',
      incident: {
        id: inc.id.slice(0, 8).toUpperCase(), type: 'truck_breakdown', title: `${comparable ? 'Comparable incident · ' : ''}${broken?.id} breakdown · ${shipment.id}`, status: 'open',
        detected_at: inc.created_at, truck_id: broken?.id, shipment_id: shipment.id, location: site, destination,
        cargo: { name: shipment.cargo, weight_kg: shipment.weight_kg, temp_min_c: shipment.temp_min_c, temp_max_c: shipment.temp_max_c, value_inr: 0, priority: 'critical' },
        rescue_deadline: shipment.cold_restore_deadline, evidence: [], facts: [],
      },
    });
    apply({ type: 'truck', truck: { id: broken.id, status: 'broken' } });
    attachEvidence(evidence, `Driver evidence for ${broken?.id}`);
    fitFocus(fleet.trucks.filter((t: any) => t.location.lng < 78.5).map((t: any) => t.location));
    apply({ type: 'stage', stage: 'detect' });
    apply({ type: 'message', message: { id: uid('msg'), at: nowIso(), role: 'system', text: `Backend incident ${inc.id.slice(0, 8)} opened for ${shipment.id} (${shipment.cargo}). Mode: ${fleet.simulated ? 'simulated' : 'live'} · dataset ${fleet.dataset}.` } });
    if (note) apply({ type: 'message', message: { id: uid('msg'), at: nowIso(), role: 'system', text: note } });
    for (const [label, value, tone] of [
      ['Cargo', `${shipment.weight_kg} kg ${shipment.cargo}, ${shipment.temp_min_c}–${shipment.temp_max_c} °C`, 'info'],
      ['Cold-restore deadline', fmtTime(shipment.cold_restore_deadline), 'bad'],
      ['Delivery deadline', fmtTime(shipment.deadline), 'warn'],
      ['Excursion allowance', `${shipment.safe_minutes_out_of_range} min (synthetic)`, 'warn'],
    ] as const) {
      apply({ type: 'incident.fact', fact: { id: label, label, value, source: 'mcp', tone } });
    }
    stream(inc.id).catch(() => undefined);

    const conv = await api<any>('/api/conversations', { method: 'POST', body: JSON.stringify({ incident_id: inc.id }) });
    conversationId = conv.id;
    apply({ type: 'stage', stage: 'understand' });
    await liveSend('Plan a rescue', true);
    await api(`/api/incidents/${inc.id}/plan`, { method: 'POST' });
    await new Promise((r) => setTimeout(r, 2500));
    // `chosen` is set by the SSE handler while we awaited; read it through a call so TS doesn't narrow it.
    const picked = currentChosen();
    if (picked && comparable) {
      apply({ type: 'agent.handover', to: 'negotiator', reason: 'Book the chosen carrier' });
      apply({ type: 'message', message: { id: uid('msg'), at: nowIso(), role: 'agent', agent: 'negotiator', text: `Booking ${picked.truck_id} with ${picked.carrier_id}. Carriers are healthy this time, so the choice above comes from the ranking alone.` } });
      await new Promise((r) => setTimeout(r, 2000));
    } else if (picked) {
      apply({ type: 'agent.handover', to: 'negotiator', reason: 'Book the chosen carrier' });
      apply({ type: 'message', message: { id: uid('msg'), at: nowIso(), role: 'agent', agent: 'negotiator', text: `Booking ${picked.truck_id} with ${picked.carrier_id}. (Kill the carrier now to watch the fallback.)` } });
      await chaosWindow(systemOf(picked.carrier_id), 15_000);
    }
    apply({ type: 'stage', stage: 'act' });
    await api(`/api/incidents/${inc.id}/execute`, { method: 'POST' });
  } catch (e) {
    const msg = (e as Error).message;
    toast({ tone: 'bad', title: 'Backend error', body: msg });
    apply({
      type: 'message',
      message: {
        id: uid('msg'), at: nowIso(), role: 'system',
        text: `Backend: ${msg}.${/sensor_data_missing|no_feasible/.test(msg) ? ' This shipment was already rescued in this database. Restart the API with a fresh GHOST_DATABASE to replay the demo.' : ''}`,
      },
    });
  }
}

export async function liveSend(text: string, silent = false) {
  if (!conversationId) {
    toast({ tone: 'info', title: 'No live incident', body: 'Start one with Truck breakdown first' });
    return;
  }
  if (uploading()) {
    toast({ tone: 'info', title: 'Evidence still uploading', body: 'Send again in a moment' });
    return;
  }
  const evidence = silent ? [] : takeReady();
  const evidenceIds = evidence.map((e) => e.backend_id).filter((id): id is string => !!id);
  apply({ type: 'message', message: { id: uid('msg'), at: nowIso(), role: 'user', text: silent ? `${text} (auto)` : text, attachments: evidence.length ? evidence : undefined } });
  for (const e of evidence) apply({ type: 'incident.evidence', evidence: e });
  const asked = useStore.getState().owner;
  apply({ type: 'agent.status', agent: asked, status: 'thinking' });
  try {
    const reply = await api<any>(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ text, evidence_ids: evidenceIds }) });
    apply({ type: 'agent.status', agent: asked, status: 'idle' });
    apply({ type: 'agent.handover', to: agentOf(reply.active_agent), reason: 'Specialist owns the conversation' });
    // Replies are also streamed as `message` events; only render them here if streaming missed them.
    apply({ type: 'agent.status', agent: agentOf(reply.active_agent), status: 'idle' });
  } catch (e) {
    apply({ type: 'agent.status', agent: asked, status: 'idle' });
    toast({ tone: 'bad', title: 'Chat failed', body: (e as Error).message });
  }
}

export async function liveRate(thumbs: 'up' | 'down', reason: string) {
  recordRating({ thumbs, reason });
  apply({ type: 'agent.handover', to: 'critic', reason: 'Learn from the rating' });
  try {
    await api(`/api/incidents/${incidentId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating: thumbs, reason, prefer_cheaper_when_slack: /expens|cost|cheap|price/i.test(reason) }),
    });
    const cost = /expens|cost|cheap|price/i.test(reason);
    apply({
      type: 'message',
      message: {
        id: uid('msg'), at: nowIso(), role: 'agent', agent: 'critic',
        text: cost
          ? 'Feedback stored as a ranking-only preference: accept a cheaper carrier when it saves at least ₹5,000 and adds at most 90 min, within both deadlines. Hard checks never change. Run a comparable incident to see the decision change.'
          : 'Feedback stored for review. Only explicit cost preferences change ranking automatically.',
        quick_replies: cost ? [COMPARABLE] : undefined,
      },
    });
  } catch (e) {
    toast({ tone: 'bad', title: 'Feedback failed', body: (e as Error).message });
  }
}

export async function liveToggleCarrier(system: SystemId) {
  const id = carrierIds[BUTTONS.indexOf(system)];
  if (!id) return toast({ tone: 'bad', title: 'Unknown carrier', body: 'Backend fleet not loaded yet' });
  const down = useStore.getState().systems[system].health !== 'down';
  try {
    await api(`/api/demo/carriers/${id}/${down ? 'kill' : 'revive'}`, { method: 'POST' });
    apply({ type: 'system.health', system, health: down ? 'down' : 'up' });
  } catch (e) {
    toast({ tone: 'bad', title: 'Kill switch failed', body: (e as Error).message });
  }
}

export const liveFleet = () => fleetCache;

export const COMPARABLE = 'Run comparable incident';

/** Shows the evidence on the incident and in the chat; offline mode stores it but never interprets it. */
function attachEvidence(evidence: Evidence[], label: string) {
  if (!evidence.length) return;
  for (const e of evidence) apply({ type: 'incident.evidence', evidence: e });
  apply({ type: 'message', message: { id: uid('msg'), at: nowIso(), role: 'external', author: label, text: `${evidence.length} file(s) uploaded to the backend and attached to the incident.`, attachments: evidence } });
  const photos = evidence.filter((e) => e.kind === 'photo').length;
  const voice = evidence.filter((e) => e.kind === 'voice').length;
  apply({
    type: 'incident.fact',
    fact: {
      id: 'evidence', label: 'Evidence', source: 'chat', tone: 'info',
      value: `${photos} photo, ${voice} voice note${evidence.length - photos - voice ? `, ${evidence.length - photos - voice} PDF` : ''} · read by Gemini Intake in live mode (offline: stored, not interpreted)`,
    },
  });
}

/**
 * Re-seeds the backend's fleet (keeping learned preferences) and replays the same
 * breakdown with every carrier healthy, so a changed choice is down to feedback.
 */
export async function liveComparable() {
  const baseline = useStore.getState().lastFirstChoice;
  if (!useStore.getState().preferences.length) {
    toast({ tone: 'info', title: 'Rate an incident first', body: 'Give 👎 "too expensive" so the Critic stores a preference' });
    return;
  }
  try {
    const reset = await api<any>('/api/demo/reset', { method: 'POST' });
    for (const system of BUTTONS) apply({ type: 'system.health', system, health: 'up' });
    compareBaseline = baseline;
    await liveStart({
      comparable: true,
      note: `Comparable incident: fleet re-seeded to the same 02:00 snapshot, carriers revived, ${reset.kept?.preferences ?? 0} learned preference(s) kept. Only the feedback differs from the last run.`,
    });
  } catch (e) {
    toast({ tone: 'bad', title: 'Comparable incident failed', body: (e as Error).message });
  }
}
