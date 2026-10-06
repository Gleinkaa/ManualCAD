import type { ArcCurve, CircleCurve, Curve, LineCurve, Vec2 } from './types';
import {
  GEOM_TOL, PARAM_TOL, TAU, angleOf, arcEnd, arcParam, arcStart, lineAt, lineParam,
  makeArc, makeLine, normAngle, onArcAngle, sweep, tolAt,
} from './curve';
import { intersect, intersectRaw } from './intersect';
import { translate } from './transform';
import { add, cross, dist, dot, len, norm, perp, scale, sub } from './vec';

/** Parallel copy at `distance`, on the side of `sidePoint`. Null if impossible (e.g. inward offset >= radius). */
export function offset(c: Curve, distance: number, sidePoint: Vec2): Curve | null {
  if (!(distance > 0)) return null;
  if (c.kind === 'line') {
    const d = sub(c.b, c.a);
    const s = cross(d, sub(sidePoint, c.a));
    if (len(d) === 0 || Math.abs(s) <= tolAt(len(d)) * len(d)) return null;
    return translate(c, scale(norm(perp(d)), Math.sign(s) * distance));
  }
  const r = dist(sidePoint, c.c) > c.r ? c.r + distance : c.r - distance;
  if (r <= tolAt(c.r)) return null;
  return { ...c, r };
}

/** Sorted, de-duplicated parameters. */
function uniqueSorted(ps: number[]): number[] {
  const out: number[] = [];
  for (const p of [...ps].sort((x, y) => x - y)) {
    if (!out.length || p - out[out.length - 1] > PARAM_TOL) out.push(p);
  }
  return out;
}

/** Bounding parameters around `p` within [lo0, hi0]. */
function bracket(params: number[], p: number, lo0: number, hi0: number): [number, number] {
  let lo = lo0;
  let hi = hi0;
  for (const t of params) {
    if (t < p) lo = t;
    else if (t > p) { hi = t; break; }
  }
  return [lo, hi];
}

/**
 * Remove the portion of `target` around `pick` that is bounded by intersections with `cutters`.
 * Returns the remaining pieces (0..2 curves; a trimmed circle becomes an arc).
 * Returns null if no cutter intersects `target` (nothing to trim).
 */
export function trim(target: Curve, pick: Vec2, cutters: Curve[]): Curve[] | null {
  const pts = cutters.filter((c) => c !== target).flatMap((c) => intersect(target, c));
  switch (target.kind) {
    case 'line': {
      const params = uniqueSorted(pts.map((p) => lineParam(target, p)).filter((t) => t > PARAM_TOL && t < 1 - PARAM_TOL));
      if (!params.length) return null;
      const tp = Math.min(1, Math.max(0, lineParam(target, pick)));
      const [lo, hi] = bracket(params, tp, 0, 1);
      const out: Curve[] = [];
      if (lo > 0) out.push(makeLine(target.a, lineAt(target, lo)));
      if (hi < 1) out.push(makeLine(lineAt(target, hi), target.b));
      return out;
    }
    case 'arc': {
      const sw = sweep(target);
      const params = uniqueSorted(
        pts.map((p) => arcParam(target, angleOf(target.c, p))).filter((s) => s > PARAM_TOL && s < sw - PARAM_TOL),
      );
      if (!params.length) return null;
      let sp = arcParam(target, angleOf(target.c, pick));
      if (sp > sw) sp = sp - sw < TAU - sp ? sw : 0;
      const [lo, hi] = bracket(params, sp, 0, sw);
      const out: Curve[] = [];
      if (lo > 0) out.push(makeArc(target.c, target.r, target.start, target.start + lo));
      if (hi < sw) out.push(makeArc(target.c, target.r, target.start + hi, target.end));
      return out;
    }
    case 'circle': {
      const angs = uniqueSorted(pts.map((p) => normAngle(angleOf(target.c, p))));
      if (angs.length > 1 && angs[angs.length - 1] - angs[0] > TAU - PARAM_TOL) angs.pop();
      if (angs.length < 2) return null;
      const pa = normAngle(angleOf(target.c, pick));
      // removed piece runs CCW from lo to hi; the kept arc is the rest
      const hi = angs.find((a) => a > pa) ?? angs[0];
      const lo = [...angs].reverse().find((a) => a <= pa) ?? angs[angs.length - 1];
      return [makeArc(target.c, target.r, hi, lo)];
    }
  }
}

/** Extend the end of a line/arc nearest `pick` to the nearest boundary it hits. Null if it hits none. */
export function extend(target: Curve, pick: Vec2, boundaries: Curve[]): Curve | null {
  if (target.kind === 'circle') return null;
  const pts = boundaries.filter((b) => b !== target).flatMap((b) => intersectRaw(target, b, true, false));
  if (target.kind === 'line') {
    const atEnd = dist(pick, target.b) < dist(pick, target.a);
    const ts = pts.map((p) => lineParam(target, p));
    if (atEnd) {
      const t = Math.min(...ts.filter((x) => x > 1 + PARAM_TOL));
      return Number.isFinite(t) ? makeLine(target.a, lineAt(target, t)) : null;
    }
    const t = Math.max(...ts.filter((x) => x < -PARAM_TOL));
    return Number.isFinite(t) ? makeLine(lineAt(target, t), target.b) : null;
  }
  const atEnd = dist(pick, arcEnd(target)) < dist(pick, arcStart(target));
  const gap = TAU - sweep(target);
  let best = Infinity;
  for (const p of pts) {
    const th = angleOf(target.c, p);
    const g = atEnd ? normAngle(th - target.end) : normAngle(target.start - th);
    if (g > PARAM_TOL && g < gap - PARAM_TOL && g < best) best = g;
  }
  if (!Number.isFinite(best)) return null;
  return atEnd
    ? makeArc(target.c, target.r, target.start, target.end + best)
    : makeArc(target.c, target.r, target.start - best, target.end);
}

/** Replace the far-away end of `l`: keeps `keep` (one of l.a/l.b) and orientation. */
function keepLine(l: LineCurve, keep: Vec2, to: Vec2): LineCurve {
  return keep === l.a ? makeLine(l.a, to) : makeLine(to, l.b);
}

interface Side { u: Vec2; far: Vec2; reach: number }

/** Direction from `from` along line `l` towards the picked side, and the endpoint kept on that side. */
function lineSide(l: LineCurve, pick: Vec2, from: Vec2): Side | null {
  const d = norm(sub(l.b, l.a));
  let s = dot(sub(pick, from), d);
  if (Math.abs(s) <= tolAt(from.x, from.y)) {
    const sa = dot(sub(l.a, from), d);
    const sb = dot(sub(l.b, from), d);
    s = Math.abs(sa) > Math.abs(sb) ? sa : sb;
  }
  const u = s >= 0 ? d : scale(d, -1);
  const far = dot(sub(l.a, from), u) >= dot(sub(l.b, from), u) ? l.a : l.b;
  const reach = dot(sub(far, from), u);
  return reach > tolAt(from.x, from.y) ? { u, far, reach } : null;
}

interface Corner { p: Vec2; a: Side; b: Side }

function lineCorner(a: LineCurve, pickA: Vec2, b: LineCurve, pickB: Vec2): Corner | null {
  const [p] = intersectRaw(a, b, true, true);
  if (!p) return null;
  const sa = lineSide(a, pickA, p);
  const sb = lineSide(b, pickB, p);
  return sa && sb ? { p, a: sa, b: sb } : null;
}

/** Fillet arc through tA and tB around `c`, oriented so it continues away from the kept directions kA. */
function filletArc(c: Vec2, r: number, tA: Vec2, kA: Vec2, tB: Vec2): ArcCurve {
  const aA = angleOf(c, tA);
  const aB = angleOf(c, tB);
  return dot(perp(sub(tA, c)), kA) < 0 ? makeArc(c, r, aA, aB) : makeArc(c, r, aB, aA);
}

interface Kept { curve: Curve; k: Vec2 }

/** Trim/extend `c` to the tangent point `t`, keeping the side of `pick`. k = direction into the kept part at t. */
function keepFrom(c: Curve, t: Vec2, pick: Vec2): Kept | null {
  if (c.kind === 'line') {
    const s = lineSide(c, pick, t);
    return s ? { curve: keepLine(c, s.far, t), k: s.u } : null;
  }
  const ccw = norm(perp(sub(t, c.c)));
  if (c.kind === 'circle') {
    return { curve: c, k: dot(sub(pick, t), ccw) >= 0 ? ccw : scale(ccw, -1) };
  }
  const th = angleOf(c.c, t);
  const sw = sweep(c);
  let curve: ArcCurve;
  let tIsStart: boolean;
  if (onArcAngle(c, th)) {
    const tp = Math.min(arcParam(c, th), sw);
    const sp = arcParam(c, angleOf(c.c, pick));
    tIsStart = sp > tp && sp <= sw + PARAM_TOL;
    curve = tIsStart ? makeArc(c.c, c.r, th, c.end) : makeArc(c.c, c.r, c.start, th);
  } else {
    tIsStart = normAngle(c.start - th) < normAngle(th - c.end);
    curve = tIsStart ? makeArc(c.c, c.r, th, c.end) : makeArc(c.c, c.r, c.start, th);
  }
  if (sweep(curve) * c.r <= tolAt(c.r) || sweep(curve) > TAU - PARAM_TOL) return null;
  return { curve, k: tIsStart ? ccw : scale(ccw, -1) };
}

/** Fillet-center carriers: curve offset by ±r (lines stay infinite, arcs become full circles). */
function offsetCarriers(c: Curve, r: number): Curve[] {
  if (c.kind === 'line') {
    if (r === 0) return [c];
    const n = scale(norm(perp(sub(c.b, c.a))), r);
    return [translate(c, n), translate(c, scale(n, -1))];
  }
  const circ = (rr: number): CircleCurve => ({ kind: 'circle', c: c.c, r: rr });
  if (r === 0) return [circ(c.r)];
  const out = [circ(c.r + r)];
  if (Math.abs(c.r - r) > tolAt(c.r)) out.push(circ(Math.abs(c.r - r)));
  return out;
}

/** Tangent point on the carrier of `c` for a fillet circle centred at `center` with radius r. */
function tangentPoint(c: Curve, center: Vec2, r: number): Vec2 | null {
  if (c.kind === 'line') return lineAt(c, lineParam(c, center));
  const d = dist(center, c.c);
  if (d <= tolAt(c.r)) return null;
  const u = scale(sub(center, c.c), 1 / d);
  // fillet circle encloses c: touches on the far side
  const inner = r > c.r && Math.abs(d - (r - c.r)) <= tolAt(r);
  return add(c.c, scale(u, inner ? -c.r : c.r));
}

function filletGeneric(a: Curve, pickA: Vec2, b: Curve, pickB: Vec2, r: number):
  { a: Curve; b: Curve; arc: ArcCurve | null } | null {
  let best: { c: Vec2; tA: Vec2; tB: Vec2; score: number } | null = null;
  for (const oa of offsetCarriers(a, r)) {
    for (const ob of offsetCarriers(b, r)) {
      for (const c of intersectRaw(oa, ob, true, true)) {
        const tA = tangentPoint(a, c, r);
        const tB = tangentPoint(b, c, r);
        if (!tA || !tB) continue;
        const score = dist(tA, pickA) + dist(tB, pickB);
        if (!best || score < best.score) best = { c, tA, tB, score };
      }
    }
  }
  if (!best) return null;
  const ka = keepFrom(a, best.tA, pickA);
  const kb = keepFrom(b, best.tB, pickB);
  if (!ka || !kb) return null;
  return { a: ka.curve, b: kb.curve, arc: r === 0 ? null : filletArc(best.c, r, best.tA, ka.k, best.tB) };
}

/**
 * Fillet two curves (v0.1: line/line required, line/arc and arc/arc optional) with radius r.
 * `pickA`/`pickB` choose which side of each curve is kept. r = 0 joins the curves at their corner.
 * Returns the trimmed curves and the fillet arc (null when r = 0), or null if impossible.
 */
export function fillet(a: Curve, pickA: Vec2, b: Curve, pickB: Vec2, r: number):
  { a: Curve; b: Curve; arc: ArcCurve | null } | null {
  if (!(r >= 0)) return null;
  if (a.kind !== 'line' || b.kind !== 'line') return filletGeneric(a, pickA, b, pickB, r);
  const k = lineCorner(a, pickA, b, pickB);
  if (!k) return null;
  if (r === 0) return { a: keepLine(a, k.a.far, k.p), b: keepLine(b, k.b.far, k.p), arc: null };
  const theta = Math.acos(Math.max(-1, Math.min(1, dot(k.a.u, k.b.u))));
  if (theta <= GEOM_TOL || theta >= Math.PI - GEOM_TOL) return null;
  const t = r / Math.tan(theta / 2);
  const tol = tolAt(t);
  if (t > k.a.reach + tol || t > k.b.reach + tol) return null;
  const tA = add(k.p, scale(k.a.u, t));
  const tB = add(k.p, scale(k.b.u, t));
  const c = add(k.p, scale(norm(add(k.a.u, k.b.u)), r / Math.sin(theta / 2)));
  return { a: keepLine(a, k.a.far, tA), b: keepLine(b, k.b.far, tB), arc: filletArc(c, r, tA, k.a.u, tB) };
}

/** Chamfer two lines: distance dA along `a` and dB along `b` from their corner. */
export function chamfer(a: Curve, pickA: Vec2, b: Curve, pickB: Vec2, dA: number, dB: number):
  { a: Curve; b: Curve; line: Curve } | null {
  if (a.kind !== 'line' || b.kind !== 'line' || !(dA >= 0) || !(dB >= 0)) return null;
  const k = lineCorner(a, pickA, b, pickB);
  if (!k) return null;
  if (dA > k.a.reach + tolAt(dA) || dB > k.b.reach + tolAt(dB)) return null;
  const cA = add(k.p, scale(k.a.u, dA));
  const cB = add(k.p, scale(k.b.u, dB));
  return { a: keepLine(a, k.a.far, cA), b: keepLine(b, k.b.far, cB), line: makeLine(cA, cB) };
}
