import type { LatLng } from './contract';

/** Bengaluru – Hosur – Krishnagiri corridor. */
export const BBOX = { minLng: 77.45, maxLng: 78.3, minLat: 12.45, maxLat: 13.08 };
export const MAP_W = 1000;
export const MAP_H = 760;

export function project(p: LatLng) {
  return {
    x: ((p.lng - BBOX.minLng) / (BBOX.maxLng - BBOX.minLng)) * MAP_W,
    y: ((BBOX.maxLat - p.lat) / (BBOX.maxLat - BBOX.minLat)) * MAP_H,
  };
}

export function pathD(points: LatLng[]) {
  return points
    .map((p, i) => {
      const { x, y } = project(p);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function km(a: LatLng, b: LatLng) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function nearestIndex(road: LatLng[], p: LatLng) {
  let best = 0;
  let bestD = Infinity;
  road.forEach((r, i) => {
    const d = km(r, p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Path from `from` to `to` that follows the road's waypoints between them. */
export function alongRoad(road: LatLng[], from: LatLng, to: LatLng): LatLng[] {
  const i = nearestIndex(road, from);
  const j = nearestIndex(road, to);
  const mid = i <= j ? road.slice(i, j + 1) : road.slice(j, i + 1).reverse();
  return [from, ...mid, to];
}

/** Point at fraction t (0..1) along a polyline, by distance. */
export function pointAt(path: LatLng[], t: number): LatLng {
  if (path.length === 1) return path[0];
  const segs = path.slice(1).map((p, i) => km(path[i], p));
  const total = segs.reduce((a, b) => a + b, 0);
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      const f = segs[i] ? Math.min(1, target / segs[i]) : 0;
      return {
        lat: path[i].lat + (path[i + 1].lat - path[i].lat) * f,
        lng: path[i].lng + (path[i + 1].lng - path[i].lng) * f,
      };
    }
    target -= segs[i];
  }
  return path[path.length - 1];
}

export function pathKm(path: LatLng[]) {
  return path.slice(1).reduce((sum, p, i) => sum + km(path[i], p), 0);
}
