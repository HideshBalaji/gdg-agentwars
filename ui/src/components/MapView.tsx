import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Crosshair, Map as MapIcon, Minus, Plus } from 'lucide-react';
import type { LatLng, MapRoute, TruckState } from '../lib/contract';
import { HUBS } from '../lib/fleet';
import { pathKm, pointAt } from '../lib/geo';
import { useStore } from '../lib/store';
import { useTheme } from '../lib/actions';
import { SchematicMap } from './SchematicMap';
import { Card, CardHeader } from './ui';

const STYLE = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
};

const cssColor = (name: string) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(`--c-${name}`).trim().split(/\s+/).join(',')})`;
const ll = (p: LatLng): [number, number] => [p.lng, p.lat];

/** Map panel: real basemap when tiles load, the schematic otherwise. */
export function MapPanel({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <Card className={className}>
      <CardHeader title="Map" icon={MapIcon}>
        <Legend />
      </CardHeader>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-b-lg">
        {failed ? <SchematicMap /> : <LiveMap onFail={() => setFailed(true)} />}
      </div>
    </Card>
  );
}

type TruckRole = 'broken' | 'rescue' | 'candidate' | 'rejected' | 'fleet';

function LiveMap({ onFail }: { onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  // MapLibre owns each marker's outer element (classes + transform); we style an inner child.
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; outer: HTMLDivElement; el: HTMLDivElement }>());
  const routeStart = useRef(new Map<string, number>());
  const [ready, setReady] = useState(false);
  const theme = useTheme((s) => s.theme);
  const styleTheme = useRef(useTheme.getState().theme);
  const s = useStore();

  // Create the map once.
  useEffect(() => {
    if (!box.current) return;
    let loaded = false;
    const m = new maplibregl.Map({
      container: box.current,
      style: STYLE[useTheme.getState().theme],
      center: ll(useStore.getState().focus.center),
      zoom: 9.3,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    map.current = m;
    // Ready as soon as the style is usable; slow tiles keep streaming in afterwards.
    const timer = setTimeout(() => !loaded && onFail(), 15_000);
    m.on('style.load', () => {
      addLayers(m);
      if (!loaded) {
        loaded = true;
        clearTimeout(timer);
        setReady(true);
      }
    });
    // A single failed tile is not fatal; only a style that cannot load sends us to the schematic.
    m.on('error', (e: { error?: Error; sourceId?: string; tile?: unknown }) => {
      console.warn('[map]', e.error?.message ?? e);
      if (!loaded && !e.sourceId && !e.tile) {
        clearTimeout(timer);
        onFail();
      }
    });
    // Layout changes (steps expanding, drawer, breakpoints) resize the panel, not the window.
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
      markers.current.forEach(({ marker }) => marker.remove());
      markers.current.clear();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme switch: swap the basemap. A diffed setStyle silently drops our route layers,
  // so force a full reload; style.load then re-adds them.
  useEffect(() => {
    if (!ready || styleTheme.current === theme) return;
    styleTheme.current = theme;
    map.current?.setStyle(STYLE[theme], { diff: false });
  }, [theme, ready]);

  // Camera follows the incident; once a rescue route exists, frame it.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const site = s.incident?.location;
    const route = s.routes[s.routes.length - 1];
    if (route && route.path.length > 1) {
      fit(m, route.path);
    } else if (site) {
      const plan = s.plans.find((p) => p.id === s.selected?.plan_id);
      const t = plan?.truck_id ? s.trucks[plan.truck_id] : undefined;
      if (t) fit(m, [site, t]);
      else m.flyTo({ center: ll(site), zoom: 10.6, duration: 1400, essential: true });
    } else {
      m.flyTo({ center: ll(s.focus.center), zoom: 9.3, duration: 1200 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, s.incident?.id, s.selected?.plan_id, s.routes.length]);

  // Route lines.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    if (!m.getSource('routes') && m.isStyleLoaded()) addLayers(m);
    const src = m.getSource('routes') as GeoJSONSource | undefined;
    src?.setData(routesGeo(s.routes));
    s.routes.forEach((r) => !routeStart.current.has(r.id) && routeStart.current.set(r.id, performance.now()));
  }, [ready, s.routes, theme]);

  // Markers: incident, hubs, trucks.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const want = new Set<string>();
    // Rows (dot + label) anchor on the left edge of the 14px pin box, so the dot sits on the point.
    const put = (id: string, at: LatLng, html: string, className: string, z = 1, layout: 'row' | 'center' | 'below' = 'row') => {
      want.add(id);
      let entry = markers.current.get(id);
      if (!entry) {
        const outer = document.createElement('div');
        const el = document.createElement('div');
        outer.appendChild(el);
        const anchor = layout === 'row' ? 'left' : layout === 'below' ? 'top' : 'center';
        const offset: [number, number] = layout === 'row' ? [-7, 0] : layout === 'below' ? [0, -7] : [0, 0];
        const marker = new maplibregl.Marker({ element: outer, anchor, offset }).setLngLat(ll(at)).addTo(m);
        entry = { marker, outer, el };
        markers.current.set(id, entry);
      }
      if (entry.el.innerHTML !== html) entry.el.innerHTML = html;
      if (entry.el.className !== className) entry.el.className = className;
      entry.outer.style.zIndex = String(z);
      if (!s.routes.some((r) => r.truck_id === id.replace('truck:', ''))) entry.marker.setLngLat(ll(at));
    };

    HUBS.forEach((h) => put(`hub:${h.id}`, h, `<span class="gd-hub" title="${esc(h.name)}"></span>`, 'gd-marker', 0, 'center'));
    // Destination name sits under its dot so an arriving truck's tag never covers it.
    if (s.incident?.destination) {
      put('dest', s.incident.destination, `<span class="gd-pin"><span class="gd-dest"></span></span><span class="gd-tag">${esc(s.incident.destination.name)}</span>`, 'gd-marker gd-col', 2, 'below');
    }
    const planFor = Object.fromEntries(s.plans.map((p) => [p.truck_id, p]));
    Object.values(s.trucks).forEach((t) => {
      const role = roleOf(t, planFor[t.id], s);
      const chosen = !!s.selected;
      const label = role === 'broken' ? `${t.id} · Broken down` : role === 'rescue' ? `${t.id} · Rescue` : (role === 'candidate' || role === 'rejected') && !chosen ? t.id : '';
      const pin = `<span class="gd-pin" title="${esc(t.id)}"><span class="gd-dot gd-${role}"></span></span>`;
      put(`truck:${t.id}`, t, `${pin}${label ? `<span class="gd-tag gd-tag-${role}">${esc(label)}</span>` : ''}`, 'gd-marker gd-row', role === 'broken' || role === 'rescue' ? 5 : role === 'fleet' ? 1 : 3);
    });
    markers.current.forEach((entry, id) => {
      if (!want.has(id)) {
        entry.marker.remove();
        markers.current.delete(id);
      }
    });
  }, [ready, s.trucks, s.plans, s.verdicts, s.selected, s.incident, s.routes]);

  // Animate trucks that are driving a route.
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const step = () => {
      const now = performance.now();
      useStore.getState().routes.forEach((r) => {
        if (!r.truck_id) return;
        const entry = markers.current.get(`truck:${r.truck_id}`);
        const start = routeStart.current.get(r.id) ?? now;
        const dur = (r.duration_s ?? 0) * 1000;
        const t = dur ? Math.min(1, (now - start) / dur) : 1;
        entry?.marker.setLngLat(ll(pointAt(r.path, t)));
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  const zoom = (d: number) => map.current?.easeTo({ zoom: (map.current?.getZoom() ?? 9) + d, duration: 250 });
  const recenter = () => {
    const m = map.current;
    const st = useStore.getState();
    if (!m) return;
    const route = st.routes[st.routes.length - 1];
    if (route) fit(m, route.path);
    else m.flyTo({ center: ll(st.incident?.location ?? st.focus.center), zoom: st.incident ? 10.6 : 9.3 });
  };

  const counts = mapCounts();
  return (
    <>
      {/* maplibre-gl.css forces position:relative on the container, so size it from a wrapper. */}
      <div className="absolute inset-0"><div ref={box} className="h-full w-full" /></div>
      {!ready && <div className="absolute inset-0 animate-pulse bg-surface-2" />}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-line bg-surface/90 px-2.5 py-1.5 text-2xs text-fg-3 shadow-sm backdrop-blur">
        {counts}
      </div>
      <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-md border border-line bg-surface/95 shadow-sm backdrop-blur">
        <MapButton label="Zoom in" onClick={() => zoom(0.8)}><Plus className="h-3.5 w-3.5" /></MapButton>
        <MapButton label="Zoom out" onClick={() => zoom(-0.8)}><Minus className="h-3.5 w-3.5" /></MapButton>
        <MapButton label="Re-centre" onClick={recenter}><Crosshair className="h-3.5 w-3.5" /></MapButton>
      </div>
    </>
  );
}

function mapCounts() {
  const st = useStore.getState();
  const trucks = Object.keys(st.trucks).length;
  if (!st.plans.length) return `${trucks} trucks · ${HUBS.length} cold hubs`;
  const rejected = st.plans.filter((p) => st.verdicts[p.id]?.verdict === 'rejected').length;
  return `${st.plans.length - rejected} feasible · ${rejected} rejected · ${trucks} trucks`;
}

function roleOf(t: TruckState, plan: { id: string } | undefined, s: ReturnType<typeof useStore.getState>): TruckRole {
  if (t.status === 'broken') return 'broken';
  if (plan && s.selected?.plan_id === plan.id) return 'rescue';
  if (plan && s.verdicts[plan.id]?.verdict === 'rejected') return 'rejected';
  if (plan) return 'candidate';
  return 'fleet';
}

function fit(m: maplibregl.Map, pts: LatLng[]) {
  const lngs = pts.map((p) => p.lng);
  const lats = pts.map((p) => p.lat);
  const bounds: LngLatBoundsLike = [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
  const km = pathKm(pts);
  m.fitBounds(bounds, { padding: { top: 60, bottom: 56, left: 56, right: 150 }, maxZoom: km < 8 ? 12.5 : 11.5, duration: 1400 });
}

function routesGeo(routes: MapRoute[]) {
  return {
    type: 'FeatureCollection' as const,
    features: routes.map((r) => ({
      type: 'Feature' as const,
      properties: { kind: r.kind },
      geometry: { type: 'LineString' as const, coordinates: r.path.map(ll) },
    })),
  };
}

function addLayers(m: maplibregl.Map) {
  if (m.getSource('routes')) return;
  const accent = cssColor('accent');
  m.addSource('routes', { type: 'geojson', data: routesGeo(useStore.getState().routes) });
  m.addLayer({ id: 'route-glow', type: 'line', source: 'routes', paint: { 'line-color': accent, 'line-width': 8, 'line-opacity': 0.18 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  m.addLayer({ id: 'route-line', type: 'line', source: 'routes', paint: { 'line-color': accent, 'line-width': 3 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex h-7 w-7 items-center justify-center border-b border-line text-fg-3 last:border-b-0 hover:bg-surface-2 hover:text-fg">
      {children}
    </button>
  );
}

function Legend() {
  const items: [string, string][] = [
    ['Breakdown', 'bg-red'],
    ['Rescue truck', 'bg-accent'],
    ['Option', 'bg-amber'],
    ['Cold hub', 'rounded-[2px] border border-violet bg-surface'],
  ];
  return (
    <div className="hidden items-center gap-3 text-2xs text-fg-3 md:flex">
      {items.map(([label, cls]) => (
        <span key={label} className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${cls}`} />{label}</span>
      ))}
    </div>
  );
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
