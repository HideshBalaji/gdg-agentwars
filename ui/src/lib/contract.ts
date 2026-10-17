/**
 * UI <-> backend contract.
 *
 * The control room is a pure renderer of `GhostEvent`s. In demo mode a scripted
 * engine emits them; in live mode the backend streams them over SSE from
 * `GET /api/incidents/{id}/events` (one JSON event per `data:` line).
 * Field names are snake_case so they map 1:1 onto the Pydantic models.
 */

export type AgentId =
  | 'dispatcher'
  | 'intake'
  | 'route_risk'
  | 'negotiator'
  | 'comms'
  | 'validator'
  | 'watchdog'
  | 'critic';

export type Stage = 'detect' | 'understand' | 'replan' | 'validate' | 'act' | 'notify' | 'learn';

export type IncidentType =
  | 'truck_breakdown'
  | 'fridge_failing'
  | 'customer_unavailable'
  | 'damaged_delivery';

export type SystemId =
  | 'gemini'
  | 'logistics_mcp'
  | 'maps'
  | 'weather'
  | 'carrier_coldline'
  | 'carrier_frostfleet'
  | 'carrier_polar'
  | 'gmail'
  | 'calendar'
  | 'sheets'
  | 'memory';

export type Health = 'up' | 'degraded' | 'down';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  id: string;
  name: string;
}

export interface Evidence {
  id: string;
  kind: 'photo' | 'voice' | 'pdf' | 'sensor' | 'chat';
  name: string;
  url?: string;
  transcript?: string;
  caption?: string;
  /** true when the file is synthetic demo media */
  synthetic?: boolean;
}

export interface Fact {
  id: string;
  label: string;
  value: string;
  source: 'photo' | 'voice' | 'sensor' | 'mcp' | 'gps' | 'chat' | 'maps' | 'weather';
  confidence?: number;
  tone?: 'ok' | 'warn' | 'bad' | 'info';
}

export interface Cargo {
  name: string;
  weight_kg: number;
  temp_min_c: number;
  temp_max_c: number;
  value_inr: number;
  priority: 'critical' | 'high' | 'normal';
}

export interface Incident {
  id: string;
  type: IncidentType;
  title: string;
  status: 'open' | 'planning' | 'executing' | 'resolved' | 'blocked';
  detected_at: string;
  truck_id?: string;
  shipment_id?: string;
  location?: Place;
  destination?: Place;
  cargo?: Cargo;
  /** ISO time. Labelled in the UI as a demo rescue-window estimate. */
  rescue_deadline?: string;
  evidence: Evidence[];
  facts: Fact[];
}

export interface Plan {
  id: string;
  label: string;
  kind: 'transfer' | 'reroute_hub' | 'reschedule' | 'replacement';
  truck_id?: string;
  carrier_id?: string;
  hub_id?: string;
  eta_to_site_min: number;
  arrival_at: string;
  slack_min: number;
  cost_inr: number;
  distance_km: number;
  risk: 'low' | 'medium' | 'high';
  attempt: number;
  path: LatLng[];
  summary: string;
}

export interface Check {
  id: string;
  label: string;
  status: 'pending' | 'pass' | 'fail';
  detail?: string;
}

export type HealingLevel = 'retry' | 'fallback' | 'validation' | 'repair' | 'learned';

export interface HealingEvent {
  id: string;
  at: string;
  level: HealingLevel;
  tool: string;
  provider?: string;
  failure: string;
  remedy: string;
  result: 'in_progress' | 'recovered' | 'failed' | 'pending';
  attempt?: string;
}

export interface ActionReceipt {
  id: string;
  at: string;
  kind: 'booking' | 'assign' | 'dock' | 'email' | 'sheet' | 'calendar' | 'claim' | 'reroute' | 'chat';
  title: string;
  detail: string;
  status: 'confirmed' | 'pending' | 'failed';
  system: SystemId;
  ref?: string;
  simulated: boolean;
}

export interface ChatMessage {
  id: string;
  at: string;
  role: 'user' | 'agent' | 'system' | 'external';
  agent?: AgentId;
  /** Display name for external parties (driver, customer, carrier desk). */
  author?: string;
  text: string;
  attachments?: Evidence[];
  quick_replies?: string[];
  /** Deterministic quality check of an agent reply (live backend `evaluation` event). */
  evaluation?: Evaluation;
}

/** Backend `evaluation` event: is an agent reply backed by tool results and the store? */
export interface Evaluation {
  id: string;
  agent: string;
  groundedness: number;
  truthfulness: number;
  hallucinated: boolean;
  claims: number;
  state_checks: number;
  unsupported: { kind: string; value: string; reason?: string }[];
  contradictions: { claim: string; store: string }[];
  simulated: boolean;
}

/** Backend `guardrail` event: personal data blocked or redacted. Values are never included. */
export interface GuardrailEvent {
  id: string;
  surface: string;
  action: 'blocked' | 'redacted';
  types: string[];
  count: number;
  engine?: string;
  degraded?: boolean;
  at: string;
}

export interface ToolCall {
  id: string;
  at: string;
  agent: AgentId;
  system: SystemId;
  tool: string;
  args: string;
  status: 'running' | 'ok' | 'error';
  summary?: string;
  latency_ms?: number;
}

export interface TruckState {
  id: string;
  carrier_id: string;
  reefer: boolean;
  capacity_kg: number;
  free_kg: number;
  driver: string;
  driver_hours_left: number;
  status: 'moving' | 'idle' | 'broken' | 'rescue' | 'assigned' | 'parked';
  lat: number;
  lng: number;
  cargo?: string;
  temp_c?: number;
}

export interface Carrier {
  id: string;
  name: string;
  system: SystemId;
  cost_per_km: number;
  reliability: number;
  role: 'primary' | 'backup' | 'premium';
}

export interface Hub extends Place {
  free_capacity_kg: number;
  next_dock: string;
}

export interface Reading {
  at: string;
  temp_c: number;
}

export interface MapRoute {
  id: string;
  kind: 'rescue' | 'onward' | 'reroute' | 'replacement';
  path: LatLng[];
  truck_id?: string;
  /** seconds for the truck to animate along the path */
  duration_s?: number;
}

export interface Preference {
  id: string;
  rule: string;
  condition: string;
  effect: string;
  source_incident: string;
  reason: string;
  status: 'active' | 'review';
  created_at: string;
  applied_count: number;
}

export interface Workaround {
  id: string;
  provider: string;
  note: string;
  expires_at: string;
}

export interface Outcome {
  headline: string;
  arrival_at?: string;
  slack_min?: number;
  cost_inr?: number;
  cargo_saved: boolean;
  actions: number;
  healed: number;
}

export interface Rating {
  thumbs: 'up' | 'down';
  reason: string;
}

export type GhostEvent =
  | { type: 'incident.opened'; incident: Incident }
  | { type: 'incident.patch'; patch: Partial<Omit<Incident, 'facts' | 'evidence'>> }
  | { type: 'incident.fact'; fact: Fact }
  | { type: 'incident.evidence'; evidence: Evidence }
  | { type: 'stage'; stage: Stage }
  | { type: 'agent.handover'; to: AgentId; reason: string }
  | { type: 'agent.status'; agent: AgentId; status: 'idle' | 'thinking' | 'working'; note?: string }
  | { type: 'message'; message: ChatMessage }
  | { type: 'tool.start'; call: ToolCall }
  | { type: 'tool.end'; id: string; status: 'ok' | 'error'; summary?: string; latency_ms?: number }
  | { type: 'plan.candidates'; plans: Plan[] }
  | { type: 'plan.check'; plan_id: string; check: Check }
  | { type: 'plan.verdict'; plan_id: string; verdict: 'valid' | 'rejected'; reason?: string }
  | { type: 'plan.selected'; plan_id: string; reason: string; preferences?: string[] }
  | { type: 'healing'; event: HealingEvent }
  | { type: 'action'; receipt: ActionReceipt }
  | { type: 'telemetry'; truck_id: string; reading: Reading }
  | { type: 'truck'; truck: Partial<TruckState> & { id: string } }
  | { type: 'system.health'; system: SystemId; health: Health }
  | { type: 'map.route'; route: MapRoute }
  | { type: 'map.focus'; center: LatLng; zoom: number }
  | { type: 'outcome'; outcome: Outcome }
  | { type: 'preference'; preference: Preference }
  | { type: 'workaround'; workaround: Workaround }
  | { type: 'rating.request' };

export const STAGES: { id: Stage; label: string }[] = [
  { id: 'detect', label: 'Detect' },
  { id: 'understand', label: 'Understand' },
  { id: 'replan', label: 'Re-plan' },
  { id: 'validate', label: 'Validate' },
  { id: 'act', label: 'Act' },
  { id: 'notify', label: 'Notify' },
  { id: 'learn', label: 'Learn' },
];
