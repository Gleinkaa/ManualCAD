// Closed regions formed by curves: what HATCH's "pick internal point" finds.
import { angleOf, arcParam, distanceTo, endpoints, lineParam, makeArc, makeLine, midpoint, normAngle, sweep, TAU } from './curve';
import { intersect } from './intersect';
import type { ArcCurve, Curve, Vec2 } from './types';
import { dist } from './vec';

/** A piece of an input curve between two graph vertices (or a whole free-standing circle). */
interface Edge {
  curve: Curve;
  u: number;   // vertex at the curve's start (line a / arc start)
  v: number;   // vertex at the curve's end
}

/** A directed traversal of an edge. */
interface Half {
  edge: number;
  fwd: boolean;
  from: number;
  to: number;
  angle: number;       // tangent direction leaving `from`, [0, 2π)
  curvature: number;   // signed curvature along the travel direction (left turn > 0)
}

/** Angle step used to approximate arcs as polygons for area and containment tests. */
const ARC_STEP = Math.PI / 180;

function scaleOf(curves: Curve[]): number {
  let m = 1;
  for (const c of curves) {
    const pts = c.kind === 'line' ? [c.a, c.b] : [c.c];
    for (const p of pts) m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
    if (c.kind !== 'line') m = Math.max(m, c.r);
  }
  return m;
}

/** Split points of each curve: its endpoints, intersections with the others, others' endpoints lying on it. */
function splitPoints(curves: Curve[], tol: number): Vec2[][] {
  const pts: Vec2[][] = curves.map((c) => {
    const e = endpoints(c);
    return e ? [e[0], e[1]] : [];
  });
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const hits = intersect(curves[i], curves[j]);
      pts[i].push(...hits);
      pts[j].push(...hits);
    }
  }
  // T-junctions and collinear overlaps: an endpoint touching another curve splits it.
  for (let i = 0; i < curves.length; i++) {
    const e = endpoints(curves[i]);
    if (!e) continue;
    for (let j = 0; j < curves.length; j++) {
      if (j === i) continue;
      for (const p of e) if (distanceTo(curves[j], p) <= tol) pts[j].push(p);
    }
  }
  return pts;
}

/** Curve parameter used to order split points: line t, arc/circle angle measured CCW from the start. */
function paramOf(c: Curve, p: Vec2): number {
  if (c.kind === 'line') return lineParam(c, p);
  if (c.kind === 'arc') return arcParam(c, angleOf(c.c, p));
  return normAngle(angleOf(c.c, p));
}

/** Pieces of `c` between consecutive split points (circles without split points stay whole). */
function pieces(c: Curve, pts: Vec2[], tol: number): Curve[] {
  if (c.kind === 'line') {
    const L = dist(c.a, c.b);
    const ts = uniqueSorted([0, 1, ...pts.map((p) => Math.min(1, Math.max(0, lineParam(c, p))))], L > 0 ? tol / L : 1);
    if (ts[ts.length - 1] < 1) ts[ts.length - 1] = 1; // the last split point merged with the end
    // exact input endpoints at both ends so neighbouring curves meet at the same vertex
    const pt = (t: number): Vec2 => (t === 0 ? c.a : t === 1 ? c.b : at(c.a, c.b, t));
    const out: Curve[] = [];
    for (let i = 0; i + 1 < ts.length; i++) out.push(makeLine(pt(ts[i]), pt(ts[i + 1])));
    return out;
  }
  const angTol = tol / c.r;
  if (c.kind === 'circle') {
    const as = uniqueSorted(pts.map((p) => paramOf(c, p)), angTol, true);
    if (as.length === 0) return [c];
    if (as.length === 1) as.push(normAngle(as[0] + Math.PI));
    as.sort((a, b) => a - b);
    return as.map((a, i) => makeArc(c.c, c.r, a, as[(i + 1) % as.length]));
  }
  const sw = sweep(c);
  const ts = uniqueSorted(pts.map((p) => {
    const t = paramOf(c, p);
    return t > sw + angTol ? (TAU - t < angTol ? 0 : t) : Math.min(t, sw);
  }).filter((t) => t <= sw + angTol), angTol);
  const out: ArcCurve[] = [];
  let prev = 0;
  for (const t of [...ts.filter((x) => x > angTol && x < sw - angTol), sw]) {
    if (t - prev > angTol) {
      out.push({ kind: 'arc', c: c.c, r: c.r, start: normAngle(c.start + prev), end: normAngle(c.start + t) });
      prev = t;
    }
  }
  // keep the original end angles exact so neighbouring curves meet at the same vertex
  if (out.length > 0) {
    out[0] = { ...out[0], start: c.start };
    out[out.length - 1] = { ...out[out.length - 1], end: c.end };
  }
  return out;
}

function at(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function uniqueSorted(vals: number[], tol: number, periodic = false): number[] {
  const s = [...vals].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of s) if (out.length === 0 || v - out[out.length - 1] > tol) out.push(v);
  // wrap-around duplicates near 0 and 2π
  if (periodic && out.length > 1 && TAU - out[out.length - 1] + out[0] <= tol) out.pop();
  return out;
}

/** Tangent angle leaving the curve's start (fwd) or its end (reverse), and the signed curvature. */
function departure(c: Curve, fwd: boolean): { angle: number; curvature: number } {
  if (c.kind === 'line') {
    const d = fwd ? { x: c.b.x - c.a.x, y: c.b.y - c.a.y } : { x: c.a.x - c.b.x, y: c.a.y - c.b.y };
    return { angle: normAngle(Math.atan2(d.y, d.x)), curvature: 0 };
  }
  const a = c as ArcCurve;
  // CCW tangent at θ is θ + 90°; travelling backwards (CW) it is θ − 90° from the end.
  return fwd
    ? { angle: normAngle(a.start + Math.PI / 2), curvature: 1 / a.r }
    : { angle: normAngle(a.end - Math.PI / 2), curvature: -1 / a.r };
}

/** Polygon approximation of a curve in the given direction (without its final point). */
function sample(c: Curve, fwd: boolean): Vec2[] {
  if (c.kind === 'line') return [fwd ? c.a : c.b];
  if (c.kind === 'circle') {
    const n = Math.max(16, Math.ceil(TAU / ARC_STEP));
    return Array.from({ length: n }, (_, i) => polarPt(c.c, c.r, (i / n) * TAU));
  }
  const sw = sweep(c);
  const n = Math.max(2, Math.ceil(sw / ARC_STEP));
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = fwd ? (i / n) * sw : sw - (i / n) * sw;
    pts.push(polarPt(c.c, c.r, c.start + t));
  }
  return pts;
}

function polarPt(c: Vec2, r: number, a: number): Vec2 {
  return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
}

function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function inside(poly: Vec2[], p: Vec2): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

interface Face {
  curves: Curve[];
  poly: Vec2[];
  area: number;        // signed: > 0 bounded face, < 0 the outline of a connected component
  component: number;
}

/** Build the planar graph of `curves` and trace all its faces. */
function faces(curves: Curve[]): Face[] {
  const tol = 1e-6 * scaleOf(curves);
  const split = splitPoints(curves, tol);

  const verts: Vec2[] = [];
  const vertex = (p: Vec2): number => {
    for (let i = 0; i < verts.length; i++) if (dist(verts[i], p) <= tol) return i;
    verts.push(p);
    return verts.length - 1;
  };

  const edges: Edge[] = [];
  const out: Face[] = [];
  let components = 0;
  for (let i = 0; i < curves.length; i++) {
    for (const piece of pieces(curves[i], split[i], tol)) {
      if (piece.kind === 'circle') {
        const poly = sample(piece, true);
        out.push({ curves: [piece], poly, area: signedArea(poly), component: components++ });
        continue;
      }
      const [s, e] = endpoints(piece)!;
      const u = vertex(s);
      const v = vertex(e);
      if (u === v && piece.kind === 'line') continue;
      // drop duplicates (overlapping input curves)
      const mid = midpoint(piece)!;
      const dup = edges.some((x) => ((x.u === u && x.v === v) || (x.u === v && x.v === u)) && distanceTo(x.curve, mid) <= tol && distanceTo(piece, midpoint(x.curve)!) <= tol);
      if (!dup) edges.push({ curve: piece, u, v });
    }
  }

  // Prune dangling edges: repeatedly drop edges ending in a vertex of degree 1.
  const alive = edges.map(() => true);
  for (let changed = true; changed;) {
    changed = false;
    const deg = verts.map(() => 0);
    edges.forEach((e, i) => {
      if (!alive[i]) return;
      deg[e.u]++;
      deg[e.v]++;
    });
    edges.forEach((e, i) => {
      if (alive[i] && (deg[e.u] === 1 || deg[e.v] === 1)) {
        alive[i] = false;
        changed = true;
      }
    });
  }

  const halves: Half[] = [];
  const outgoing: number[][] = verts.map(() => []);
  edges.forEach((e, i) => {
    if (!alive[i]) return;
    for (const fwd of [true, false]) {
      const d = departure(e.curve, fwd);
      const h: Half = { edge: i, fwd, from: fwd ? e.u : e.v, to: fwd ? e.v : e.u, ...d };
      outgoing[h.from].push(halves.length);
      halves.push(h);
    }
  });
  // CCW order around each vertex; equal tangents: the one curving more to the left is further CCW.
  for (const list of outgoing) {
    list.sort((a, b) => {
      const ha = halves[a];
      const hb = halves[b];
      let d = ha.angle - hb.angle;
      if (Math.abs(d) > TAU - 1e-9) d = 0;
      return Math.abs(d) > 1e-9 ? d : ha.curvature - hb.curvature;
    });
  }
  const twin = (h: number): number => (h % 2 === 0 ? h + 1 : h - 1);
  /** Next half-edge of the face on the left: at the end vertex, the edge just clockwise of the way back. */
  const next = (h: number): number => {
    const t = twin(h);
    const list = outgoing[halves[t].from];
    const k = list.indexOf(t);
    return list[(k - 1 + list.length) % list.length];
  };

  // Connected components, so islands can be told apart from faces of the same part.
  const comp = verts.map(() => -1);
  for (let s = 0; s < verts.length; s++) {
    if (comp[s] >= 0 || outgoing[s].length === 0) continue;
    const stack = [s];
    comp[s] = components;
    while (stack.length) {
      const x = stack.pop()!;
      for (const h of outgoing[x]) {
        const y = halves[h].to;
        if (comp[y] < 0) {
          comp[y] = components;
          stack.push(y);
        }
      }
    }
    components++;
  }

  const used = halves.map(() => false);
  for (let h0 = 0; h0 < halves.length; h0++) {
    if (used[h0]) continue;
    const cs: Curve[] = [];
    const poly: Vec2[] = [];
    let h = h0;
    for (let guard = 0; !used[h] && guard <= halves.length; guard++) {
      used[h] = true;
      const he = halves[h];
      const c = edges[he.edge].curve;
      cs.push(c);
      poly.push(...sample(c, he.fwd));
      h = next(h);
    }
    out.push({ curves: cs, poly, area: signedArea(poly), component: comp[halves[h0].from] });
  }
  return out;
}

/**
 * The boundary of the smallest closed region around `p` formed by `curves` (one coordinate space).
 * Curves are split at their mutual intersections; dangling pieces are ignored. Returns the outer loop
 * first, then the islands inside it (loops of other curves that lie inside the outer loop but do not
 * contain `p`), each as a closed chain of curves. Null when `p` is not enclosed.
 */
export function findRegion(curves: Curve[], p: Vec2): Curve[][] | null {
  const all = faces(curves);
  // Bounded faces have positive area; a free circle is both a face and its own outline.
  const bounded = all.filter((f) => f.area > 0 && inside(f.poly, p));
  if (bounded.length === 0) return null;
  const outer = bounded.reduce((a, b) => (b.area < a.area ? b : a));
  // Islands: outlines of other components lying inside the outer loop and not around p,
  // outermost only (anything inside an island is not hatched again).
  const outlines = all.filter((f) => f.component !== outer.component && (f.area < 0 || f.curves[0].kind === 'circle'));
  const candidates = outlines.filter((f) => inside(outer.poly, f.poly[0]) && !inside(f.poly, p));
  const islands = candidates.filter((f) => !candidates.some((g) => g !== f && Math.abs(g.area) > Math.abs(f.area) && inside(g.poly, f.poly[0])));
  return [outer.curves, ...islands.map((f) => f.curves)];
}
