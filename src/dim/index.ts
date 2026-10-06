// CONTRACT: signatures are fixed. Bodies are implemented by the dim module owner.
import { add, dist, dot, norm, perp, scale, sub } from '../geom';
import type { CircleCurve, ArcCurve, Vec2 } from '../geom/types';
import { getView, resolveAnchor, toSheet } from '../model/doc';
import { LINE_GROUPS } from '../model/standards';
import type { Dimension, LinearDimension, RadialDimension, SheetDoc } from '../model/types';
import type { Primitive, StrokeStyle } from '../plot/types';
import {
  ARROW_ANGLE,
  ARROW_LENGTH_FACTOR,
  EXTENSION_OVERSHOOT_FACTOR,
  MAX_DECIMALS,
  OUTSIDE_TAIL_FACTOR,
  TEXT_GAP_FACTOR,
  TEXT_WIDTH_FACTOR,
} from './rules';

export * from './rules';

const COLOR = '#000';
const EPS = 1e-9;

/** The measured value in real mm (radius, diameter or distance), using associated geometry. */
export function measure(doc: SheetDoc, dim: Dimension): number {
  if (dim.kind === 'linear') {
    const a = resolveAnchor(doc, dim.a);
    const b = resolveAnchor(doc, dim.b);
    if (dim.orientation === 'horizontal') return Math.abs(b.x - a.x);
    if (dim.orientation === 'vertical') return Math.abs(b.y - a.y);
    return dist(a, b);
  }
  const r = radialCurve(doc, dim).r;
  return dim.kind === 'radius' ? r : 2 * r;
}

/** The final dimension text: override, or prefix + formatted value + suffix (ISO 129-1, decimal comma). */
export function dimensionText(doc: SheetDoc, dim: Dimension): string {
  const t = dim.text;
  if (t.override !== null) return t.override;
  let symbol = '';
  if (dim.kind === 'radius' && !t.prefix.includes('R')) symbol = 'R';
  if (dim.kind === 'diameter' && !/[⌀Øø]/.test(t.prefix)) symbol = '⌀';
  return t.prefix + symbol + formatValue(measure(doc, dim)) + t.suffix;
}

/** Dimension lines, extension lines, terminators and text as SHEET-mm primitives, per ISO 129-1. */
export function plotDimension(doc: SheetDoc, dim: Dimension): Primitive[] {
  const ctx = context(doc, dim);
  if (dim.kind === 'linear') return plotLinear(doc, dim, ctx);
  if (!findCurve(doc, dim)) return [];
  return dim.kind === 'radius' ? plotRadius(doc, dim, ctx) : plotDiameter(doc, dim, ctx);
}

/** Decimal comma, no trailing zeros, at most 3 decimals: 12.5 → "12,5", 40 → "40". */
export function formatValue(value: number): string {
  const f = 10 ** MAX_DECIMALS;
  let r = Math.round(value * f) / f;
  if (r === 0) r = 0; // drop -0
  return r.toFixed(MAX_DECIMALS).replace(/\.?0+$/, '').replace('.', ',');
}

/** Estimated paper width of `text` at cap height `h` (ISO 3098 type B, see TEXT_WIDTH_FACTOR). */
export function textWidth(text: string, h: number): number {
  return [...text].length * TEXT_WIDTH_FACTOR * h;
}

/** Text angle for a line in direction `u`, readable from the bottom or the right (ISO 129-1 method 1). */
export function readableAngle(u: Vec2): number {
  let a = Math.atan2(u.y, u.x);
  if (a > Math.PI / 2 + 1e-6) a -= Math.PI;
  else if (a <= -Math.PI / 2 + 1e-6) a += Math.PI;
  return a;
}

interface Ctx {
  tag: string;
  style: StrokeStyle;
  h: number;            // text height
  al: number;           // arrow length
  gap: number;          // text gap above the dimension line
  overshoot: number;    // extension line overshoot
}

function context(doc: SheetDoc, dim: Dimension): Ctx {
  const g = LINE_GROUPS[doc.lineGroup];
  return {
    tag: dim.id,
    style: { width: g.narrow, dash: [], dashOffset: 0, color: COLOR },
    h: g.dimText,
    al: ARROW_LENGTH_FACTOR * g.narrow,
    gap: TEXT_GAP_FACTOR * g.dimText,
    overshoot: EXTENSION_OVERSHOOT_FACTOR * g.narrow,
  };
}

function findCurve(doc: SheetDoc, dim: RadialDimension): CircleCurve | ArcCurve | null {
  const g = doc.entities.find((e) => e.id === dim.entityId)?.geom;
  return g && g.kind !== 'line' ? g : null;
}

function radialCurve(doc: SheetDoc, dim: RadialDimension): CircleCurve | ArcCurve {
  const g = findCurve(doc, dim);
  if (!g) throw new Error(`dimension ${dim.id}: entity ${dim.entityId} is not a circle or arc`);
  return g;
}

// --- linear ---

function plotLinear(doc: SheetDoc, dim: LinearDimension, c: Ctx): Primitive[] {
  const view = getView(doc, dim.viewId);
  const A = toSheet(view, resolveAnchor(doc, dim.a));
  const B = toSheet(view, resolveAnchor(doc, dim.b));
  let u: Vec2;
  let n: Vec2;
  if (dim.orientation === 'horizontal') {
    u = { x: 1, y: 0 };
    n = { x: 0, y: 1 };
  } else if (dim.orientation === 'vertical') {
    u = { x: 0, y: 1 };
    n = { x: 1, y: 0 };
  } else {
    u = dist(A, B) < EPS ? { x: 1, y: 0 } : norm(sub(B, A));
    n = perp(u);
  }
  // The dimension line runs at `offset` from the midpoint of the measured points, along n.
  const M = scale(add(A, B), 0.5);
  const foot = (p: Vec2) => add(p, scale(n, dot(sub(M, p), n) + dim.offset));
  let P1 = foot(A);
  let P2 = foot(B);
  if (dot(sub(P2, P1), u) < 0) [P1, P2] = [P2, P1];

  const prims: Primitive[] = [];
  for (const [p, P] of [[A, foot(A)], [B, foot(B)]] as const) {
    const d = sub(P, p);
    if (Math.hypot(d.x, d.y) < EPS) continue;
    prims.push(line(c, p, add(P, scale(norm(d), c.overshoot))));
  }
  prims.push(...dimensionLine(c, P1, P2, u, dimensionText(doc, dim), false, null, null));
  return prims;
}

/**
 * Dimension line between two terminator points with text. Arrows inside when line, text and both arrows fit;
 * otherwise arrows outside pointing in, and text outside beyond P2 when it does not fit either.
 * `textOut` forces arrows and text outside, with the text starting that far beyond P2.
 * `from` (e.g. a circle centre): inside text is centred between `from` and P2's arrow if it fits there.
 */
function dimensionLine(
  c: Ctx, P1: Vec2, P2: Vec2, u: Vec2, text: string, forceOutside: boolean, textOut: number | null, from: Vec2 | null,
): Primitive[] {
  const L = dist(P1, P2);
  const tw = textWidth(text, c.h);
  const tail = c.al * (1 + OUTSIDE_TAIL_FACTOR);
  const textMid = (arrowsInside: boolean) => {
    if (from) {
      const free = dist(from, P2) - (arrowsInside ? c.al : 0);
      if (free >= tw + 2 * c.gap) return add(from, scale(u, free / 2));
    }
    return scale(add(P1, P2), 0.5);
  };
  if (!forceOutside && L >= 2 * c.al + tw + 2 * c.gap) {
    return [line(c, P1, P2), arrow(c, P1, scale(u, -1)), arrow(c, P2, u), label(c, textMid(true), u, text)];
  }
  const prims = [arrow(c, P1, u), arrow(c, P2, scale(u, -1))];
  const start = sub(P1, scale(u, tail));
  if (textOut === null && L >= tw + 2 * c.gap) {
    prims.push(line(c, start, add(P2, scale(u, tail))), label(c, textMid(false), u, text));
  } else {
    const s0 = Math.max(textOut ?? 0, c.al + c.gap);
    prims.push(line(c, start, add(P2, scale(u, s0 + tw))), label(c, add(P2, scale(u, s0 + tw / 2)), u, text));
  }
  return prims;
}

// --- radial ---

function plotRadius(doc: SheetDoc, dim: RadialDimension, c: Ctx): Primitive[] {
  const view = getView(doc, dim.viewId);
  const g = radialCurve(doc, dim);
  const C = toSheet(view, g.c);
  const R = g.r * view.scale;
  const angle = g.kind === 'arc' ? clampToArc(dim.angle, g) : dim.angle;
  const d = { x: Math.cos(angle), y: Math.sin(angle) };
  const P = add(C, scale(d, R));
  const text = dimensionText(doc, dim);
  const tw = textWidth(text, c.h);
  const arrowOutside = R < 2 * c.al;
  const textOutside = dim.leader > 0 || R < c.al + tw + 2 * c.gap;

  if (!textOutside) {
    return [line(c, C, P), arrow(c, P, d), label(c, add(C, scale(d, (R - c.al) / 2)), d, text)];
  }
  const s0 = Math.max(dim.leader, arrowOutside ? c.al + c.gap : c.gap);
  const end = add(P, scale(d, s0 + tw));
  return [
    line(c, arrowOutside ? P : C, end),
    arrow(c, P, arrowOutside ? scale(d, -1) : d),
    label(c, add(P, scale(d, s0 + tw / 2)), d, text),
  ];
}

/** `angle` if it lies on the arc, else the nearer arc end, so the arrow always touches the arc. */
export function clampToArc(angle: number, arc: ArcCurve): number {
  const TAU = 2 * Math.PI;
  const mod = (x: number) => ((x % TAU) + TAU) % TAU;
  const span = mod(arc.end - arc.start) || TAU;
  const t = mod(angle - arc.start);
  if (t <= span + 1e-12) return angle;
  return t - span < TAU - t ? arc.end : arc.start;
}

function plotDiameter(doc: SheetDoc, dim: RadialDimension, c: Ctx): Primitive[] {
  const view = getView(doc, dim.viewId);
  const g = radialCurve(doc, dim);
  const C = toSheet(view, g.c);
  const R = g.r * view.scale;
  const d = { x: Math.cos(dim.angle), y: Math.sin(dim.angle) };
  const P1 = sub(C, scale(d, R));
  const P2 = add(C, scale(d, R));
  const out = dim.leader > 0;
  return dimensionLine(c, P1, P2, d, dimensionText(doc, dim), out, out ? dim.leader : null, C);
}

// --- primitives ---

function line(c: Ctx, a: Vec2, b: Vec2): Primitive {
  return { kind: 'polyline', points: [a, b], closed: false, style: c.style, tag: c.tag };
}

/** Closed filled arrowhead with its tip at `tip`, pointing in direction `w`. */
function arrow(c: Ctx, tip: Vec2, w: Vec2): Primitive {
  const base = sub(tip, scale(w, c.al));
  const q = scale(perp(w), c.al * Math.tan(ARROW_ANGLE / 2));
  return { kind: 'fill', points: [tip, add(base, q), sub(base, q)], color: COLOR, tag: c.tag };
}

/** Text centred at `at` along a line in direction `u`, standing `gap` above it on the readable side. */
function label(c: Ctx, at: Vec2, u: Vec2, text: string): Primitive {
  const angle = readableAngle(u);
  const up = { x: -Math.sin(angle), y: Math.cos(angle) };
  return {
    kind: 'text',
    pos: add(at, scale(up, c.gap)),
    text,
    height: c.h,
    angle,
    align: 'center',
    baseline: 'bottom',
    color: COLOR,
    tag: c.tag,
  };
}
