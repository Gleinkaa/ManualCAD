// Freehand break lines (ISO 128-2 01.1) built from tangent-continuous circular arcs, so every curve
// operation (intersections, trim, snaps, hatch boundaries) works on them unchanged.
import { add, dot, len, norm, perp, scale, sub } from './vec';
import type { Curve, Vec2 } from './types';

const EPS = 1e-9;
/** Tilt of the end tangents against the chord for a two-point break line: gives a gentle S wave. */
const WAVE = (18 * Math.PI) / 180;

function rotate(u: Vec2, a: number): Vec2 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: u.x * c - u.y * s, y: u.x * s + u.y * c };
}

/** The arc (or line) leaving `p` in direction `t` and ending at `q`. */
function tangentArc(p: Vec2, t: Vec2, q: Vec2): Curve {
  const pq = sub(q, p);
  const n = perp(t); // left normal
  const h = dot(pq, n);
  const l2 = dot(pq, pq);
  if (Math.abs(h) < EPS * Math.max(1, Math.sqrt(l2))) return { kind: 'line', a: p, b: q };
  const r = l2 / (2 * h); // signed: > 0 centre on the left → counter-clockwise
  const c = add(p, scale(n, r));
  const ang = (v: Vec2) => Math.atan2(v.y - c.y, v.x - c.x);
  return r > 0
    ? { kind: 'arc', c, r, start: ang(p), end: ang(q) }
    : { kind: 'arc', c, r: -r, start: ang(q), end: ang(p) };
}

/** Biarc from p0 (tangent t0) to p1 (tangent t1), equal tangent lengths. */
export function biarc(p0: Vec2, t0: Vec2, p1: Vec2, t1: Vec2): Curve[] {
  const v = sub(p1, p0);
  const t = add(t0, t1);
  const vt = dot(v, t);
  const den = 2 * (1 - dot(t0, t1));
  let d: number;
  if (Math.abs(den) < 1e-12) {
    const vt1 = dot(v, t1);
    if (Math.abs(vt1) < EPS) return [{ kind: 'line', a: p0, b: p1 }];
    d = dot(v, v) / (4 * vt1);
  } else {
    d = (-vt + Math.sqrt(vt * vt + den * dot(v, v))) / den;
  }
  const a = add(p0, scale(t0, d));
  const b = sub(p1, scale(t1, d));
  const m = scale(add(a, b), 0.5);
  if (len(sub(m, p0)) < EPS || len(sub(p1, m)) < EPS) return [{ kind: 'line', a: p0, b: p1 }];
  return [tangentArc(p0, t0, m), tangentArc(m, norm(sub(b, a)), p1)];
}

/**
 * A smooth freehand-looking curve through `points` as a chain of arcs: two points give an S wave,
 * more points a Catmull-Rom-like smooth curve through each of them.
 */
export function freehandCurve(points: Vec2[]): Curve[] {
  const pts = points.filter((p, i) => i === 0 || len(sub(p, points[i - 1])) > EPS);
  if (pts.length < 2) return [];
  if (pts.length === 2) {
    const u = norm(sub(pts[1], pts[0]));
    return biarc(pts[0], rotate(u, WAVE), pts[1], rotate(u, WAVE));
  }
  const n = pts.length;
  const tan: Vec2[] = pts.map((p, i) => (i === 0 || i === n - 1 ? p : norm(sub(pts[i + 1], pts[i - 1]))));
  // natural ends: mirror the neighbouring tangent about the end chord
  const end = (p: Vec2, q: Vec2, tq: Vec2): Vec2 => {
    const c = norm(sub(q, p));
    return norm(sub(scale(c, 2 * dot(tq, c)), tq));
  };
  tan[0] = end(pts[0], pts[1], tan[1]);
  tan[n - 1] = end(pts[n - 2], pts[n - 1], tan[n - 2]);
  const out: Curve[] = [];
  for (let i = 0; i + 1 < n; i++) out.push(...biarc(pts[i], tan[i], pts[i + 1], tan[i + 1]));
  return out;
}
