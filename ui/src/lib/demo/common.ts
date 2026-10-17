import type { LatLng, Plan, Place } from '../contract';
import { CARRIERS, CARRIER_NAME, NH48 } from '../fleet';
import { alongRoad, pathKm } from '../geo';
import { fmtDur, fmtInr, fmtTime, uid } from '../format';
import { useStore } from '../store';
import type { Ctx } from './engine';

export const RELIABILITY = Object.fromEntries(CARRIERS.map((c) => [c.id, c.reliability]));

export const carrierSystem = (carrierId?: string) =>
  CARRIERS.find((c) => c.id === carrierId)?.system ?? 'logistics_mcp';

export const truckPos = (id: string): LatLng => {
  const t = useStore.getState().trucks[id];
  return { lat: t.lat, lng: t.lng };
};

export function mkPlan(
  ctx: Ctx,
  o: {
    id: string;
    label: string;
    kind?: Plan['kind'];
    truck_id?: string;
    carrier_id?: string;
    hub_id?: string;
    eta: number;
    handling: number;
    onward: number;
    cost: number;
    risk: Plan['risk'];
    attempt: number;
    from: LatLng;
    to: LatLng;
    deadlineMs: number;
    summary: string;
  },
): Plan {
  const path = alongRoad(NH48, o.from, o.to);
  const safeAt = ctx.now() + (o.eta + o.handling) * 60_000;
  return {
    id: o.id,
    label: o.label,
    kind: o.kind ?? 'transfer',
    truck_id: o.truck_id,
    carrier_id: o.carrier_id,
    hub_id: o.hub_id,
    eta_to_site_min: o.eta,
    arrival_at: new Date(ctx.now() + (o.eta + o.handling + o.onward) * 60_000).toISOString(),
    slack_min: Math.round((o.deadlineMs - safeAt - o.onward * 60_000 * (o.kind === 'reroute_hub' ? 0 : 1)) / 60_000),
    cost_inr: o.cost,
    distance_km: Math.round(pathKm(path) * 10) / 10,
    risk: o.risk,
    attempt: o.attempt,
    path,
    summary: o.summary,
  };
}

/** Drives a truck along a road path on the map. */
export function drive(ctx: Ctx, id: string, truck_id: string, kind: 'rescue' | 'onward' | 'reroute' | 'replacement', from: LatLng, to: LatLng | Place, seconds: number) {
  const path = alongRoad(NH48, from, to);
  ctx.emit({ type: 'map.route', route: { id, kind, path, truck_id, duration_s: seconds / useStore.getState().speed } });
  return path;
}

/**
 * Books the first plan in `order`, healing through the carrier fallback chain:
 * retry → reconcile → next healthy carrier → Gmail booking request.
 */
export async function bookWithFallback(
  ctx: Ctx,
  incidentId: string,
  order: Plan[],
  opts: { chaos: boolean; cargo: string; site: string },
): Promise<{ plan: Plan; ref: string; pending?: boolean } | null> {
  let fallbackId: string | null = null;

  for (let i = 0; i < order.length; i++) {
    const plan = order[i];
    const system = carrierSystem(plan.carrier_id);
    const name = CARRIER_NAME[plan.carrier_id ?? 'own'];
    const key = `${incidentId}-book-${i + 1}`;

    const workaround = useStore.getState().workarounds.find((w) => w.provider === name);
    if (workaround && ctx.isDown(system)) {
      ctx.healing({
        id: uid('heal'),
        level: 'learned',
        tool: 'book_transfer',
        provider: name,
        failure: `${name} marked unhealthy earlier (workaround until ${fmtTime(workaround.expires_at)})`,
        remedy: `Skipped ${name} without calling it; probe scheduled`,
        result: 'recovered',
      });
      await ctx.say('watchdog', `Skipping ${name}: it failed earlier tonight and its workaround is still active. Going straight to the next feasible carrier.`);
      continue;
    }

    if (i > 0) {
      ctx.emit({
        type: 'plan.selected',
        plan_id: plan.id,
        reason: `Fallback: next feasible plan with a healthy provider (${plan.truck_id} via ${name}, ${plan.eta_to_site_min} min to site, ${fmtDur(plan.slack_min)} slack).`,
      });
      await ctx.wait(500);
    }

    await ctx.say(
      'negotiator',
      `${name} desk: I need ${plan.truck_id} for a cold transfer at ${opts.site}. ${opts.cargo}. Pickup now. Can you confirm?`,
    );
    const quoted = await ctx.tool('negotiator', system, 'request_quote', `truck="${plan.truck_id}", site="${opts.site}"`, {
      ms: 650,
      summary: `${fmtInr(plan.cost_inr)} · hold 5 min`,
    });
    if (quoted) {
      await ctx.external(`${name} dispatch`, `${plan.truck_id} is free. Quote ${fmtInr(plan.cost_inr)}, holding for 5 minutes.`);
    }

    let ok = quoted;
    if (quoted) {
      const call = ctx.toolStart('negotiator', system, 'book_transfer', `truck="${plan.truck_id}", idempotency_key="${key}"`);
      const killed = opts.chaos && i === 0 ? await ctx.chaosWindow(system, 10_000) : (await ctx.wait(900), false);
      if (killed || ctx.isDown(system)) {
        await ctx.wait(500);
        ctx.toolEnd(call, false, '503 Service Unavailable', 2100);
        ok = false;
      } else {
        const ref = `${plan.carrier_id?.slice(0, 2).toUpperCase()}-${Math.floor(40000 + Math.random() * 50000)}`;
        ctx.toolEnd(call, true, `Booking ${ref} confirmed`, 900);
        ctx.action({
          id: uid('act'),
          kind: 'booking',
          title: `${name} booking ${ref}`,
          detail: `${plan.truck_id} for ${opts.site} · ${fmtInr(plan.cost_inr)} · key ${key}`,
          status: 'confirmed',
          system,
          ref,
        });
        if (fallbackId) {
          ctx.healing({
            id: fallbackId,
            level: 'fallback',
            tool: 'book_transfer',
            provider: `${CARRIER_NAME[order[0].carrier_id ?? 'own']} → ${name}`,
            failure: 'Primary carrier down after 2 retries',
            remedy: `Booked ${plan.truck_id} via ${name} (${ref})`,
            result: 'recovered',
          });
        }
        return { plan, ref };
      }
    }

    if (!ok) {
      // Level 1: bounded retry with backoff.
      const retryId = uid('heal');
      ctx.healing({
        id: retryId,
        level: 'retry',
        tool: 'book_transfer',
        provider: name,
        failure: '503 Service Unavailable',
        remedy: 'Retry 1/2 after 500 ms backoff',
        result: 'in_progress',
        attempt: '1/2',
      });
      ctx.status('watchdog', 'working', 'retry book_transfer');
      await ctx.wait(700);
      await ctx.tool('watchdog', system, 'book_transfer', `retry=1, idempotency_key="${key}"`, { ms: 700, summary: '' });
      ctx.healing({
        id: retryId,
        level: 'retry',
        tool: 'book_transfer',
        provider: name,
        failure: '503, then connection refused',
        remedy: 'Retry 2/2 after 1 s backoff',
        result: 'in_progress',
        attempt: '2/2',
      });
      await ctx.wait(900);
      await ctx.tool('watchdog', system, 'book_transfer', `retry=2, idempotency_key="${key}"`, { ms: 800, summary: '' });
      ctx.healing({
        id: retryId,
        level: 'retry',
        tool: 'book_transfer',
        provider: name,
        failure: `${name} unreachable after 2 retries`,
        remedy: 'Retries exhausted → escalate to fallback',
        result: 'failed',
        attempt: '2/2',
      });

      // Reconcile before switching provider: the first call may have landed.
      await ctx.tool('watchdog', 'logistics_mcp', 'list_carriers', 'region="KA-TN"', {
        ms: 600,
        summary: `${name}: DOWN · others healthy`,
      });
      ctx.emit({ type: 'system.health', system, health: 'down' });
      ctx.action({
        id: uid('act'),
        kind: 'booking',
        title: `Reconcile ${name} key ${key}`,
        detail: 'Outcome unknown → cancel-if-exists queued for when the API is back',
        status: 'pending',
        system,
      });
      await ctx.say(
        'watchdog',
        `${name} is down (503, then connection refused). The first booking may have landed, so I've queued a cancel-if-exists on key ${key} instead of booking twice. Falling back to the next carrier.`,
      );
      ctx.emit({
        type: 'workaround',
        workaround: {
          id: uid('wa'),
          provider: name,
          note: `API down during ${incidentId} → skip for 30 min, then probe`,
          expires_at: ctx.iso(30),
        },
      });
      fallbackId = fallbackId ?? uid('heal');
      ctx.healing({
        id: fallbackId,
        level: 'fallback',
        tool: 'book_transfer',
        provider: `${name} → next carrier`,
        failure: 'Primary carrier down after 2 retries',
        remedy: 'Fallback chain: next healthy carrier → Gmail booking request',
        result: 'in_progress',
      });
      ctx.healing({
        id: uid('heal'),
        level: 'learned',
        tool: 'provider_health',
        provider: name,
        failure: `${name} unhealthy`,
        remedy: `Stored workaround: skip ${name} for 30 min, probe at ${fmtTime(ctx.iso(30))}`,
        result: 'recovered',
      });
    }
  }

  // Every API carrier failed: last rung of the chain is an email request.
  await ctx.handover('comms', 'All carrier APIs failed; send an emailed booking request');
  const last = order[order.length - 1];
  await ctx.tool('comms', 'gmail', 'messages.send', `to="desk@polarroute.demo", subject="Urgent reefer booking ${incidentId}"`, {
    ms: 800,
    summary: 'Sent · awaiting reply',
  });
  ctx.action({
    id: uid('act'),
    kind: 'booking',
    title: 'Emailed booking request',
    detail: 'Pending confirmation. An email request is not a confirmed booking.',
    status: 'pending',
    system: 'gmail',
  });
  if (fallbackId) {
    ctx.healing({
      id: fallbackId,
      level: 'fallback',
      tool: 'book_transfer',
      provider: 'all carriers → Gmail',
      failure: 'No carrier API reachable',
      remedy: 'Booking request emailed; incident stays open until confirmed',
      result: 'pending',
    });
  }
  return last ? { plan: last, ref: 'EMAIL-PENDING', pending: true } : null;
}
