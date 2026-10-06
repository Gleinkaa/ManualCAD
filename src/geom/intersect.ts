import type { BBox, Curve, LineCurve, Vec2 } from './types';
import { bbox, makeLine, tolAt, withinExtent } from './curve';
import { add, cross, dist, dot, len, perp, scale, sub } from './vec';
import { EPS } from './types';

interface Round { c: Vec2; r: number }

function lineLine(p: LineCurve, q: LineCurve): Vec2[] {
  const d1 = sub(p.b, p.a);
  const d2 = sub(q.b, q.a);
  const den = cross(d1, d2);
  if (Math.abs(den) <= EPS * len(d1) * len(d2)) return [];
  const t = cross(sub(q.a, p.a), d2) / den;
  return [add(p.a, scale(d1, t))];
}

function lineCircle(l: LineCurve, c: Round): Vec2[] {
  const d = sub(l.b, l.a);
  const L = len(d);
  if (L === 0) return [];
  const u = scale(d, 1 / L);
  const f = add(l.a, scale(u, dot(sub(c.c, l.a), u)));
  const h = dist(f, c.c);
  const tol = tolAt(c.r);
  if (h > c.r + tol) return [];
  if (Math.abs(h - c.r) <= tol) return [f];
  const s = Math.sqrt(c.r * c.r - h * h);
  return [sub(f, scale(u, s)), add(f, scale(u, s))];
}

function circleCircle(a: Round, b: Round): Vec2[] {
  const d = dist(a.c, b.c);
  const tol = tolAt(a.r, b.r);
  if (d <= tol) return [];
  if (d > a.r + b.r + tol || d < Math.abs(a.r - b.r) - tol) return [];
  const u = scale(sub(b.c, a.c), 1 / d);
  const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
  const base = add(a.c, scale(u, x));
  if (Math.abs(d - (a.r + b.r)) <= tol || Math.abs(d - Math.abs(a.r - b.r)) <= tol) return [base];
  const h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
  const n = perp(u);
  return [add(base, scale(n, h)), sub(base, scale(n, h))];
}

export function dedupe(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    if (!out.some((q) => dist(p, q) <= tolAt(p.x, p.y))) out.push(p);
  }
  return out;
}

/** Intersections with per-curve extension (infinite line / full circle). */
export function intersectRaw(a: Curve, b: Curve, extA: boolean, extB: boolean): Vec2[] {
  let pts: Vec2[];
  if (a.kind === 'line' && b.kind === 'line') pts = lineLine(a, b);
  else if (a.kind === 'line') pts = lineCircle(a, b as Round);
  else if (b.kind === 'line') pts = lineCircle(b, a);
  else pts = circleCircle(a, b);
  return dedupe(pts.filter((p) => (extA || withinExtent(a, p)) && (extB || withinExtent(b, p))));
}

/**
 * Intersection points of two curves, restricted to the actual extents of segments/arcs.
 * With `extended: true`, lines are treated as infinite and arcs as full circles.
 */
export function intersect(a: Curve, b: Curve, opts?: { extended?: boolean }): Vec2[] {
  const ext = opts?.extended ?? false;
  return intersectRaw(a, b, ext, ext);
}

function boxEdges(box: BBox): LineCurve[] {
  const { min, max } = box;
  const p = [min, { x: max.x, y: min.y }, max, { x: min.x, y: max.y }];
  return p.map((q, i) => makeLine(q, p[(i + 1) % 4]));
}

function segmentHitsBox(a: Vec2, b: Vec2, box: BBox): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: [number, number][] = [
    [-dx, a.x - box.min.x], [dx, box.max.x - a.x],
    [-dy, a.y - box.min.y], [dy, box.max.y - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

/** True when the curve lies completely inside the box (used for window selection). */
export function insideBox(c: Curve, box: BBox): boolean {
  const b = bbox(c);
  const tol = tolAt(box.min.x, box.min.y, box.max.x, box.max.y);
  return b.min.x >= box.min.x - tol && b.min.y >= box.min.y - tol
    && b.max.x <= box.max.x + tol && b.max.y <= box.max.y + tol;
}

/** True when the curve intersects or lies inside the box (used for crossing selection). */
export function intersectsBox(c: Curve, box: BBox): boolean {
  if (c.kind === 'line') return segmentHitsBox(c.a, c.b, box);
  return insideBox(c, box) || boxEdges(box).some((e) => intersect(c, e).length > 0);
}
