import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Maximize2, Minus, Plus } from 'lucide-react';
import type { LatLng, TruckState } from '../lib/contract';
import { HUBS, PLACES, ROADS, STATE_BORDER } from '../lib/fleet';
import { MAP_H, MAP_W, pathD, project } from '../lib/geo';
import { useStore } from '../lib/store';

/** Eases the camera towards its target so zoom/pan feel continuous. */
function useCamera(target: { center: LatLng; zoom: number }) {
  const [cam, setCam] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = { ...cam };
    from.current = a;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 900);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      setCam({
        center: { lat: a.center.lat + (target.center.lat - a.center.lat) * e, lng: a.center.lng + (target.center.lng - a.center.lng) * e },
        zoom: a.zoom + (target.zoom - a.zoom) * e,
      });
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.center.lat, target.center.lng, target.zoom]);
  return cam;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 800, h: 400 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Hand-drawn schematic, used when basemap tiles can't load (offline demos). */
export function SchematicMap() {
  const { trucks, routes, incident, focus, plans, verdicts, selected, sweepAt } = useStore();
  const [userZoom, setUserZoom] = useState(1);
  useEffect(() => setUserZoom(1), [incident?.id]);
  const cam = useCamera({ center: focus.center, zoom: focus.zoom * userZoom });
  const [box, size] = useSize<HTMLDivElement>();

  const c = project(cam.center);
  const vw = MAP_W / cam.zoom;
  const vh = MAP_H / cam.zoom;
  // `slice` scales by the larger ratio; u converts screen px into SVG units.
  const u = 1 / Math.max(size.w / vw, size.h / vh);

  const planFor = Object.fromEntries(plans.map((p) => [p.truck_id, p]));
  const candidates = plans.filter((p) => verdicts[p.id]?.verdict !== 'rejected').length;
  const rejected = plans.filter((p) => verdicts[p.id]?.verdict === 'rejected').length;

  return (
      <div ref={box} className="relative h-full min-h-0 overflow-hidden">
        <svg className="absolute inset-0 h-full w-full" viewBox={`${c.x - vw / 2} ${c.y - vh / 2} ${vw} ${vh}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label="Map of the NH-48 corridor">
          <path d={pathD(STATE_BORDER)} fill="none" stroke="rgb(var(--map-border))" strokeDasharray="6 6" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {ROADS.map((r) => (
            <path key={r.id} d={pathD(r.path)} fill="none" stroke={r.major ? 'rgb(var(--map-road-major))' : 'rgb(var(--map-road))'} strokeWidth={r.major ? 3 : 1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ))}
          {PLACES.map((p) => {
            const q = project(p);
            return (
              <g key={p.id}>
                <circle cx={q.x} cy={q.y} r={2.5 * u} fill="rgb(var(--c-fg-4))" />
                <text x={q.x + 6 * u} y={q.y - 6 * u} fontSize={11 * u} fill="rgb(var(--c-fg-3))">{p.name}</text>
              </g>
            );
          })}
          {HUBS.map((h) => {
            const q = project(h);
            return (
              <g key={h.id}>
                <rect x={q.x - 4 * u} y={q.y - 4 * u} width={8 * u} height={8 * u} rx={2 * u} fill="rgb(var(--c-surface))" stroke="rgb(var(--c-violet))" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
                {cam.zoom >= 1.5 && <text x={q.x + 8 * u} y={q.y + 3.5 * u} fontSize={10 * u} fill="rgb(var(--c-fg-3))">{h.name}</text>}
              </g>
            );
          })}

          {routes.map((r) => (
            <g key={r.id}>
              <motion.path d={pathD(r.path)} fill="none" stroke="rgb(var(--c-accent))" strokeOpacity={0.25} strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke"
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: r.duration_s ?? 1.5, ease: 'linear' }} />
              <motion.path d={pathD(r.path)} fill="none" stroke="rgb(var(--c-accent))" strokeWidth={2} strokeLinecap="round" strokeDasharray="4 6" vectorEffect="non-scaling-stroke"
                initial={{ pathLength: 0, strokeDashoffset: 0 }} animate={{ pathLength: 1, strokeDashoffset: -40 }}
                transition={{ pathLength: { duration: r.duration_s ?? 1.5, ease: 'linear' }, strokeDashoffset: { duration: 1.2, repeat: Infinity, ease: 'linear' } }} />
            </g>
          ))}

          {incident?.location && (() => {
            const q = project(incident.location);
            return (
              <g>
                <motion.circle cx={q.x} cy={q.y} r={10 * u} fill="none" stroke="rgb(var(--c-red))" strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                  initial={{ opacity: 0.7, scale: 1 }} animate={{ opacity: 0, scale: 3 }} transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
                  style={{ transformOrigin: `${q.x}px ${q.y}px`, transformBox: 'view-box' }} />
                {sweepAt > 0 && (
                  <motion.circle key={sweepAt} cx={q.x} cy={q.y} r={10 * u} fill="rgb(var(--c-accent))" fillOpacity={0.06} stroke="rgb(var(--c-accent))" strokeOpacity={0.5} strokeWidth={1} vectorEffect="non-scaling-stroke"
                    initial={{ scale: 0.5, opacity: 1 }} animate={{ scale: 18, opacity: 0 }} transition={{ duration: 1.8, ease: 'easeOut' }}
                    style={{ transformOrigin: `${q.x}px ${q.y}px`, transformBox: 'view-box' }} />
                )}
              </g>
            );
          })()}

          {Object.values(trucks).map((t) => {
            const route = [...routes].reverse().find((r) => r.truck_id === t.id);
            const plan = planFor[t.id];
            const state = t.status === 'broken' ? 'broken' : plan && selected?.plan_id === plan.id ? 'selected' : plan && verdicts[plan.id]?.verdict === 'rejected' ? 'rejected' : plan ? 'candidate' : 'fleet';
            const pts = route ? route.path.map(project) : [project(t)];
            return (
              <motion.g key={t.id + (route?.id ?? '')} initial={{ x: pts[0].x, y: pts[0].y }} animate={{ x: pts.map((q) => q.x), y: pts.map((q) => q.y) }}
                transition={{ duration: route?.duration_s ?? 0, ease: 'linear' }}>
                <TruckPin truck={t} state={state} u={u} showLabel={state !== 'fleet' || cam.zoom >= 1.6} />
              </motion.g>
            );
          })}
        </svg>

        <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md border border-line bg-surface/90 px-2.5 py-1.5 text-2xs text-fg-3 backdrop-blur">
          <span><b className="font-mono font-medium text-fg">{Object.keys(trucks).length}</b> trucks</span>
          <span><b className="font-mono font-medium text-fg">{HUBS.length}</b> cold hubs</span>
          {plans.length > 0 && <span><b className="font-mono font-medium text-fg">{candidates}</b> feasible · <b className="font-mono font-medium text-fg">{rejected}</b> rejected</span>}
        </div>

        <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-md border border-line bg-surface/90 backdrop-blur">
          <ZoomButton label="Zoom in" onClick={() => setUserZoom((z) => Math.min(4, z * 1.4))}><Plus className="h-3.5 w-3.5" /></ZoomButton>
          <ZoomButton label="Zoom out" onClick={() => setUserZoom((z) => Math.max(0.5, z / 1.4))}><Minus className="h-3.5 w-3.5" /></ZoomButton>
          <ZoomButton label="Reset zoom" onClick={() => setUserZoom(1)}><Maximize2 className="h-3 w-3" /></ZoomButton>
        </div>
      </div>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex h-7 w-7 items-center justify-center border-b border-line text-fg-3 last:border-b-0 hover:bg-surface-2 hover:text-fg">
      {children}
    </button>
  );
}

const PIN: Record<string, { fill: string; label?: string; text: string }> = {
  broken: { fill: 'rgb(var(--c-red))', label: 'Broken down', text: 'rgb(var(--c-red))' },
  selected: { fill: 'rgb(var(--c-accent))', label: 'Rescue', text: 'rgb(var(--c-accent))' },
  candidate: { fill: 'rgb(var(--c-amber))', text: 'rgb(var(--c-fg-2))' },
  rejected: { fill: 'rgb(var(--c-fg-4))', text: 'rgb(var(--c-fg-4))' },
  fleet: { fill: 'rgb(var(--c-fg-3))', text: 'rgb(var(--c-fg-3))' },
};

function TruckPin({ truck, state, u, showLabel }: { truck: TruckState; state: string; u: number; showLabel: boolean }) {
  const s = PIN[state];
  const r = (state === 'broken' || state === 'selected' ? 5 : 3.5) * u;
  const tagged = !!s.label;
  const label = tagged ? `${truck.id} · ${s.label}` : truck.id;
  const tw = label.length * 6.1 * u + 12 * u;
  return (
    <g>
      {state === 'selected' && <circle r={r * 2.2} fill="rgb(var(--c-accent))" fillOpacity={0.15} />}
      <circle r={r} fill={s.fill} stroke="rgb(var(--c-surface))" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {tagged ? (
        <g transform={`translate(${9 * u}, ${-9 * u})`}>
          <rect width={tw} height={18 * u} rx={4 * u} fill="rgb(var(--c-surface))" stroke="rgb(var(--map-border))" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <text x={6 * u} y={12.5 * u} fontSize={10 * u} fontFamily="Geist Mono, monospace" fill={s.text}>{label}</text>
        </g>
      ) : showLabel ? (
        <text x={7 * u} y={3.5 * u} fontSize={10 * u} fontFamily="Geist Mono, monospace" fill={s.text} textDecoration={state === 'rejected' ? 'line-through' : undefined}>{label}</text>
      ) : (
        <title>{truck.id}</title>
      )}
    </g>
  );
}
