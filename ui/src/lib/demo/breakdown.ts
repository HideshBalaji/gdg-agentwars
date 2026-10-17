import { DESTINATIONS } from '../fleet';
import { uid } from '../format';
import { useStore } from '../store';
import { bookWithFallback, drive, mkPlan, RELIABILITY, truckPos } from './common';
import { check, makeCtx, rank, type Run } from './engine';

const SITE = { id: 'LOC-TN07', name: 'NH-48, 3 km east of Hosur', lat: 12.716, lng: 77.87 };

export async function breakdown(run: Run) {
  const ctx = makeCtx(run);
  const id = 'INC-0217';
  const deadlineMs = ctx.now() + 232 * 60_000;
  ctx.emit({
    type: 'incident.opened',
    incident: {
      id, type: 'truck_breakdown', title: 'TN-07 breakdown · NH-48 near Hosur', status: 'open',
      detected_at: ctx.iso(), truck_id: 'TN-07', shipment_id: 'SH-1042', location: SITE,
      destination: DESTINATIONS.hospital, evidence: [], facts: [],
    },
  });
  ctx.emit({ type: 'truck', truck: { id: 'TN-07', status: 'broken' } });
  for (let i = 20; i > 0; i--) ctx.emit({ type: 'telemetry', truck_id: 'TN-07', reading: { at: ctx.iso(-i * 3), temp_c: 5.1 - i * 0.045 } });
  let temp = 5.1;
  ctx.every(2500, () => {
    temp += 0.02 + Math.random() * 0.01;
    ctx.emit({ type: 'telemetry', truck_id: 'TN-07', reading: { at: ctx.iso(), temp_c: temp } });
  });
  ctx.stage('detect');
  ctx.system('Driver app: TN-07 stopped on NH-48, 3 km east of Hosur. Engine fault P0217 (overheat).');
  await ctx.wait(900);
  const photo = { id: uid('ev'), kind: 'photo' as const, name: 'driver-photo.jpg', url: '/demo/driver-photo-tn07.svg', synthetic: true };
  const voice = {
    id: uid('ev'), kind: 'voice' as const, name: 'voice-note.m4a', url: '/demo/voice-note-tn07.m4a', synthetic: true,
    transcript: 'Control, this is Ravi on TN-07. Engine died near Hosur toll, smoke from the bonnet. Reefer is on battery, maybe two hours. Vaccine load for Bengaluru Central.',
  };
  await ctx.external('Ravi K. · Driver TN-07', 'Engine died, smoke from the front. Reefer on battery.', [photo, voice]);
  ctx.emit({ type: 'incident.evidence', evidence: photo });
  ctx.emit({ type: 'incident.evidence', evidence: voice });
  await ctx.say('dispatcher', 'On it. Vaccine cargo, so I am opening a rescue. Intake, read the driver evidence.');
  await ctx.handover('intake', 'Multimodal evidence to parse');

  ctx.stage('understand');
  await ctx.tool('intake', 'gemini', 'analyze_image', 'driver-photo.jpg', { ms: 1300, summary: 'Reefer TN 07 BX 4471 · smoke at engine bay' });
  ctx.fact({ label: 'Vehicle', value: 'TN-07 (plate read from photo)', source: 'photo', confidence: 0.98, tone: 'info' });
  ctx.fact({ label: 'Failure', value: 'Engine overheat, smoke visible', source: 'photo', confidence: 0.86, tone: 'bad' });
  await ctx.tool('intake', 'gemini', 'transcribe_audio', 'voice-note.m4a', { ms: 1100, summary: '18 s · English (India)' });
  ctx.fact({ label: 'Reefer', value: 'On battery, ~2 h left', source: 'voice', confidence: 0.9, tone: 'warn' });
  await ctx.tool('intake', 'logistics_mcp', 'get_shipment', 'shipment_id="SH-1042"', { ms: 600, summary: '420 kg vaccines · +2–8 °C' });
  ctx.emit({ type: 'incident.patch', patch: { cargo: { name: 'Vaccines', weight_kg: 420, temp_min_c: 2, temp_max_c: 8, value_inr: 1840000, priority: 'critical' } } });
  ctx.fact({ label: 'Cargo', value: '420 kg vaccines, +2 to +8 °C', source: 'mcp', tone: 'info' });
  await ctx.tool('intake', 'logistics_mcp', 'get_temperature_history', 'truck_id="TN-07"', { ms: 500, summary: '20 readings · +0.9 °C/h' });
  ctx.fact({ label: 'Temperature', value: '5.1 °C, rising 0.9 °C/h', source: 'sensor', tone: 'warn' });
  ctx.fact({ label: 'Rescue window', value: '3 h 52 m (demo estimate)', source: 'sensor', tone: 'bad' });
  ctx.emit({ type: 'incident.patch', patch: { rescue_deadline: new Date(deadlineMs).toISOString(), status: 'planning' } });
  await ctx.say('intake', 'Parsed: engine overheat (86% confidence from the photo), reefer on battery. 420 kg of vaccines at 5.1 °C and rising. Demo rescue window: 3 h 52 m.');
  await ctx.handover('route_risk', 'Find a reefer that beats the deadline');

  ctx.stage('replan');
  ctx.emit({ type: 'map.focus', center: { lat: 12.75, lng: 77.8 }, zoom: 1.5 });
  await ctx.tool('route_risk', 'weather', 'get_weather', '12.716, 77.870', { ms: 500, summary: 'Light rain · 22 °C · no alerts' });
  await ctx.tool('route_risk', 'logistics_mcp', 'list_trucks_near', 'lat=12.716, lng=77.870, radius_km=25', { ms: 900, summary: '6 trucks in range' });
  const healRetry = uid('heal');
  await ctx.tool('route_risk', 'maps', 'compute_routes', 'origins=6, destination=TN-07', { ms: 1200, summary: '', error: 'DEADLINE_EXCEEDED after 1.2 s' });
  ctx.healing({ id: healRetry, level: 'retry', tool: 'compute_routes', provider: 'Maps Routes', failure: 'Timeout', remedy: 'Retry 1/3 after 400 ms', result: 'in_progress' });
  await ctx.tool('route_risk', 'maps', 'compute_routes', 'origins=6, destination=TN-07 (retry)', { ms: 700, summary: '6 routes' });
  ctx.healing({ id: healRetry, level: 'retry', tool: 'compute_routes', provider: 'Maps Routes', failure: 'Timeout', remedy: 'Retry 1/3 succeeded', result: 'recovered' });

  const base = { handling: 20, onward: 52, deadlineMs, to: SITE };
  const p1 = mkPlan(ctx, { ...base, id: 'P1', label: 'TN-22 · own fleet', truck_id: 'TN-22', carrier_id: 'own', eta: 6, cost: 3900, risk: 'low', attempt: 1, from: truckPos('TN-22'), summary: 'Closest truck' });
  const p2 = mkPlan(ctx, { ...base, id: 'P2', label: 'KA-19 · ColdLine', truck_id: 'KA-19', carrier_id: 'coldline', eta: 9, cost: 11600, risk: 'low', attempt: 1, from: truckPos('KA-19'), summary: 'Closest reefer' });
  ctx.emit({ type: 'plan.candidates', plans: [p1, p2] });
  await ctx.say('route_risk', 'Closest options: TN-22 (6 min) and KA-19 (9 min). Sending both to Validator.');
  ctx.stage('validate');
  await ctx.validate(p1, [check('Reefer unit', false, 'TN-22 is a dry van'), check('Capacity', true), check('Deadline', true)]);
  await ctx.validate(p2, [check('Reefer unit', true), check('Capacity', false, '150 kg free < 420 kg'), check('Deadline', true)]);
  const healVal = uid('heal');
  ctx.healing({ id: healVal, level: 'validation', tool: 'validate_plan', failure: 'P1 no reefer · P2 150 kg free', remedy: 'Back to Dispatcher → re-plan (attempt 2/3)', result: 'in_progress' });
  await ctx.say('dispatcher', 'Both rejected. Re-planning with hard filters: reefer, 420 kg free, enough driver hours. Attempt 2 of 3.');

  ctx.stage('replan');
  await ctx.tool('route_risk', 'logistics_mcp', 'list_trucks_near', 'radius_km=30, needs_reefer=true, min_free_kg=420', { ms: 800, summary: '4 reefers' });
  const p3 = mkPlan(ctx, { ...base, id: 'P3', label: 'KA-11 · ColdLine', truck_id: 'KA-11', carrier_id: 'coldline', eta: 14, cost: 18400, risk: 'low', attempt: 2, from: truckPos('KA-11'), summary: 'Fastest' });
  const p4 = mkPlan(ctx, { ...base, id: 'P4', label: 'KA-08 · PolarRoute', truck_id: 'KA-08', carrier_id: 'polar', eta: 17, cost: 22600, risk: 'low', attempt: 2, from: truckPos('KA-08'), summary: 'Premium backup' });
  const p5 = mkPlan(ctx, { ...base, id: 'P5', label: 'KA-04 · FrostFleet', truck_id: 'KA-04', carrier_id: 'frostfleet', eta: 27, cost: 11200, risk: 'medium', attempt: 2, from: truckPos('KA-04'), summary: 'Cheapest' });
  const p6 = mkPlan(ctx, { ...base, id: 'P6', label: 'KA-27 · FrostFleet', truck_id: 'KA-27', carrier_id: 'frostfleet', eta: 4, cost: 6800, risk: 'high', attempt: 2, from: truckPos('KA-27'), summary: 'Parked nearby' });
  ctx.emit({ type: 'plan.candidates', plans: [p3, p4, p5, p6] });
  ctx.stage('validate');
  const ok = [check('Reefer unit', true), check('Capacity', true), check('Deadline', true), check('Driver hours', true)];
  await ctx.validate(p3, ok);
  await ctx.validate(p4, ok);
  await ctx.validate(p5, ok);
  await ctx.validate(p6, [check('Reefer unit', true), check('Capacity', true), check('Deadline', true), check('Driver hours', false, '0.4 h left < 1.6 h trip')]);
  ctx.healing({ id: healVal, level: 'validation', tool: 'validate_plan', failure: 'P1 no reefer · P2 150 kg free', remedy: '3 valid plans on attempt 2', result: 'recovered' });
  await ctx.handover('dispatcher', 'Choose a plan');

  const r = rank([p3, p4, p5], useStore.getState().preferences, RELIABILITY);
  ctx.emit({
    type: 'plan.selected', plan_id: r.plan.id, preferences: r.applied.map((p) => p.id),
    reason: r.by === 'cost' ? `Learned preference ${r.applied[0].id}: slack > 60 min, so cheapest feasible carrier.` : 'Fastest feasible arrival. No learned cost preference yet, so ranking is time-first.',
  });
  ctx.stage('act');
  await ctx.handover('negotiator', 'Book the carrier');
  const order = [r.plan, ...[p3, p4, p5].filter((p) => p !== r.plan).sort((a, b) => a.eta_to_site_min - b.eta_to_site_min)];
  const booked = await bookWithFallback(ctx, id, order, { chaos: true, cargo: '420 kg vaccines at +2–8 °C', site: SITE.name });
  if (!booked) return;
  const truck = booked.plan.truck_id!;
  await ctx.tool('negotiator', 'logistics_mcp', 'assign_load', `shipment_id="SH-1042", truck_id="${truck}"`, { ms: 600, summary: 'Assignment AS-3310 (replay-safe)' });
  ctx.action({ id: uid('act'), kind: 'assign', title: `SH-1042 → ${truck}`, detail: 'Load reassigned via logistics-mcp', status: 'confirmed', system: 'logistics_mcp' });
  ctx.emit({ type: 'truck', truck: { id: truck, status: 'rescue', cargo: 'Vaccines · SH-1042' } });
  drive(ctx, 'rescue', truck, 'rescue', truckPos(truck), SITE, 7);

  ctx.stage('notify');
  await ctx.handover('comms', 'Notify everyone');
  const healRepair = uid('heal');
  await ctx.tool('comms', 'logistics_mcp', 'book_dock_slot', 'warehouse_id="DST-BCH", time="3:40 AM"', { ms: 600, summary: '', error: "422: 'time' must be ISO-8601" });
  ctx.healing({ id: healRepair, level: 'repair', tool: 'book_dock_slot', failure: "422: 'time' must be ISO-8601", remedy: 'Repaired args → 2026-10-18T03:40:00+05:30', result: 'in_progress' });
  await ctx.tool('comms', 'logistics_mcp', 'book_dock_slot', 'warehouse_id="DST-BCH", time="2026-10-18T03:40:00+05:30"', { ms: 600, summary: 'Dock 3 reserved' });
  ctx.healing({ id: healRepair, level: 'repair', tool: 'book_dock_slot', failure: "422: 'time' must be ISO-8601", remedy: 'Repaired args → 2026-10-18T03:40:00+05:30', result: 'recovered' });
  await ctx.tool('comms', 'calendar', 'events.insert', '"Dock 3 · SH-1042" 03:40–04:00', { ms: 500, summary: 'Event created' });
  ctx.action({ id: uid('act'), kind: 'dock', title: 'Dock 3 · 03:40–04:00', detail: 'Bengaluru Central Hospital receiving', status: 'confirmed', system: 'calendar' });
  await ctx.tool('comms', 'sheets', 'values.update', 'Fleet!A2:F11', { ms: 500, summary: '2 rows updated' });
  ctx.action({ id: uid('act'), kind: 'sheet', title: 'Fleet board updated', detail: `TN-07 → BROKEN · ${truck} → RESCUE`, status: 'confirmed', system: 'sheets' });
  await ctx.tool('comms', 'gmail', 'messages.send', 'to="receiving@bch.demo"', { ms: 600, summary: 'Sent' });
  ctx.action({ id: uid('act'), kind: 'email', title: 'Hospital notified', detail: 'New ETA sent to demo recipient', status: 'confirmed', system: 'gmail' });
  await ctx.external('Bengaluru Central · Receiving', 'Thanks. Dock 3 will be ready at 03:40.');
  drive(ctx, 'onward', truck, 'onward', SITE, DESTINATIONS.hospital, 10);
  await ctx.handover('dispatcher', 'Wrap up');
  const s = useStore.getState();
  ctx.emit({
    type: 'outcome',
    outcome: {
      headline: `Vaccines moved to ${truck}, ${Math.round(booked.plan.slack_min / 60)}+ h before the deadline`,
      arrival_at: booked.plan.arrival_at, slack_min: booked.plan.slack_min, cost_inr: booked.plan.cost_inr,
      cargo_saved: !booked.pending, actions: s.actions.length, healed: s.healing.length,
    },
  });
  ctx.stage('learn');
  await ctx.say('dispatcher', 'Rescue done (simulated actions). Rate this decision so I can learn.');
  ctx.emit({ type: 'rating.request' });
}
