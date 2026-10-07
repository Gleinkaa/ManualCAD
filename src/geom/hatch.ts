// Hatch line generation: parallel lines clipped to closed loops.
import { bbox, sweep, TAU } from './curve';
import type { Curve, Vec2 } from './types';

/** Upper bound on generated hatch lines, so a tiny spacing cannot hang the renderer. */
const MAX_LINES = 20000;

/** A piece of a loop curve that is monotone across the hatch lines, as a function to find its crossing. */
interface Piece {
  d0: number;          // signed distance of the start from the line family origin, along the normal
  d1: number;          // same at the end
  cross(c: number): Vec2;
}

function linePiece(a: Vec2, b: Vec2, n: Vec2, o: Vec2): Piece {
  const d0 = (a.x - o.x) * n.x + (a.y - o.y) * n.y;
  const d1 = (b.x - o.x) * n.x + (b.y - o.y) * n.y;
  return {
    d0,
    d1,
    cross: (c) => {
      const t = (c - d0) / (d1 - d0);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    },
  };
}

/**
 * Split an arc (start angle, CCW sweep) at the angles where it is extreme along `n`, so every piece
 * crosses each hatch line at most once.
 */
function arcPieces(cx: Vec2, r: number, start: number, sw: number, n: Vec2, o: Vec2): Piece[] {
  const alpha = Math.atan2(n.y, n.x);
  const dc = (cx.x - o.x) * n.x + (cx.y - o.y) * n.y;
  const cuts = [0, sw];
  for (const ext of [alpha, alpha + Math.PI]) {
    let t = (ext - start) % TAU;
    if (t < 0) t += TAU;
    if (t > 1e-12 && t < sw - 1e-12) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  const out: Piece[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const p0 = start + cuts[i];
    const p1 = start + cuts[i + 1];
    const d0 = dc + r * Math.cos(p0 - alpha);
    const d1 = dc + r * Math.cos(p1 - alpha);
    out.push({
      d0,
      d1,
      cross: (c) => {
        const q = Math.max(-1, Math.min(1, (c - dc) / r));
        const w = Math.acos(q);
        // the solution of cos(φ − α) = q inside [p0, p1]
        let best = p0;
        let bestErr = Infinity;
        for (const cand of [alpha + w, alpha - w]) {
          let t = (cand - p0) % TAU;
          if (t < 0) t += TAU;
          if (t > TAU - 1e-9) t = 0;
          const err = t <= p1 - p0 ? 0 : Math.min(t - (p1 - p0), TAU - t);
          if (err < bestErr) {
            bestErr = err;
            best = p0 + Math.min(t, p1 - p0);
          }
        }
        return { x: cx.x + r * Math.cos(best), y: cx.y + r * Math.sin(best) };
      },
    });
  }
  return out;
}

function piecesOf(c: Curve, n: Vec2, o: Vec2): Piece[] {
  if (c.kind === 'line') return [linePiece(c.a, c.b, n, o)];
  if (c.kind === 'circle') return arcPieces(c.c, c.r, 0, TAU, n, o);
  return arcPieces(c.c, c.r, c.start, sweep(c), n, o);
}

/**
 * Segments of the parallel lines at `angleDeg` (CCW from +x), `spacing` apart, one of them through
 * `origin`, clipped to the even-odd interior of `loops` (each a closed chain of curves).
 * Lines through a vertex or tangent to an arc must not leak outside the loops.
 */
export function hatchSegments(loops: Curve[][], angleDeg: number, spacing: number, origin: Vec2 = { x: 0, y: 0 }): [Vec2, Vec2][] {
  const curves = loops.flat();
  if (curves.length === 0 || !(spacing > 0)) return [];
  const th = (angleDeg * Math.PI) / 180;
  const u = { x: Math.cos(th), y: Math.sin(th) };
  const n = { x: -u.y, y: u.x };
  const pieces = curves.flatMap((c) => piecesOf(c, n, origin));

  let lo = Infinity;
  let hi = -Infinity;
  for (const c of curves) {
    const b = bbox(c);
    for (const p of [b.min, b.max, { x: b.min.x, y: b.max.y }, { x: b.max.x, y: b.min.y }]) {
      const d = (p.x - origin.x) * n.x + (p.y - origin.y) * n.y;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
  }
  const k0 = Math.ceil(lo / spacing);
  const k1 = Math.floor(hi / spacing);
  if (k1 - k0 + 1 > MAX_LINES) return [];

  const out: [Vec2, Vec2][] = [];
  const minLen = spacing * 1e-6;
  for (let k = k0; k <= k1; k++) {
    // A sub-micron offset keeps the lines off vertices that sit exactly on the grid, where line and
    // arc pieces sharing the vertex could disagree in the last bits about which side it is on.
    const c = (k + 1.2345678e-7) * spacing;
    // Half-open crossing rule: an endpoint exactly on the line counts as above it. A vertex shared by
    // two pieces is then counted once when the boundary passes through, and twice or never when it
    // only touches the line (a corner or a tangent), so the parity stays right.
    const hits: number[] = [];
    for (const p of pieces) {
      if ((p.d0 > c) === (p.d1 > c)) continue;
      const q = p.cross(c);
      hits.push((q.x - origin.x) * u.x + (q.y - origin.y) * u.y);
    }
    hits.sort((a, b) => a - b);
    for (let i = 0; i + 1 < hits.length; i += 2) {
      if (hits[i + 1] - hits[i] <= minLen) continue;
      const at = (s: number): Vec2 => ({ x: origin.x + u.x * s + n.x * c, y: origin.y + u.y * s + n.y * c });
      out.push([at(hits[i]), at(hits[i + 1])]);
    }
  }
  return out;
}
