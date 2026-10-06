// Annotations (text, hatching, leaders) to sheet primitives.
import { ARROW_ANGLE, ARROW_LENGTH_FACTOR, plotDimension, TEXT_GAP_FACTOR } from '../dim';
import { add, clipOutsideConvex, hatchSegments, norm, perp, scale, sub } from '../geom';
import type { Curve, Vec2 } from '../geom/types';
import { getView, layerVisible, toSheet } from '../model/doc';
import { LEADER_DOT_FACTOR, LINE_GROUPS } from '../model/standards';
import type { Annotation, Hatch, Leader, SheetDoc, TextNote, View } from '../model/types';
import { textWidth } from './font';
import type { PlotOptions } from './sheet';
import { BLACK, SCREEN_COLORS } from './style';
import type { Primitive } from './types';

function curveToSheet(view: View, c: Curve): Curve {
  const f = (p: Vec2) => toSheet(view, p);
  if (c.kind === 'line') return { kind: 'line', a: f(c.a), b: f(c.b) };
  if (c.kind === 'circle') return { kind: 'circle', c: f(c.c), r: c.r * view.scale };
  return { ...c, c: f(c.c), r: c.r * view.scale };
}

function plotText(doc: SheetDoc, t: TextNote, tag: string): Primitive[] {
  const view = getView(doc, t.viewId);
  return [{ kind: 'text', pos: toSheet(view, t.pos), text: t.text, height: t.height, angle: t.angle, align: t.align, baseline: 'bottom', color: BLACK, tag }];
}

/** Hatch lines in sheet mm; the pattern is anchored at the sheet origin so neighbouring hatches line up. */
export function hatchSheetSegments(doc: SheetDoc, h: Hatch): [Vec2, Vec2][] {
  const view = getView(doc, h.viewId);
  return hatchSegments(h.loops.map((l) => l.map((c) => curveToSheet(view, c))), h.angle, h.spacing);
}

type TextPrimitive = Extract<Primitive, { kind: 'text' }>;

/** The rectangle a text primitive covers (cap height, estimated width), grown by `margin`, in sheet mm. */
export function textBox(t: TextPrimitive, margin: number): Vec2[] {
  const w = textWidth(t.text, t.height);
  const h = t.height;
  const x0 = t.align === 'left' ? 0 : t.align === 'center' ? -w / 2 : -w;
  const y0 = t.baseline === 'bottom' ? 0 : t.baseline === 'middle' ? -h / 2 : -h;
  const u = { x: Math.cos(t.angle), y: Math.sin(t.angle) };
  const v = perp(u);
  const at = (x: number, y: number) => add(t.pos, add(scale(u, x), scale(v, y)));
  return [at(x0 - margin, y0 - margin), at(x0 + w + margin, y0 - margin), at(x0 + w + margin, y0 + h + margin), at(x0 - margin, y0 + h + margin)];
}

/** Every visible text on the sheet that hatching must leave free: notes, leader texts and dimension values. */
function sheetTexts(doc: SheetDoc, opts: PlotOptions): TextPrimitive[] {
  const out: TextPrimitive[] = [];
  const keep = (prims: Primitive[]) => {
    for (const p of prims) if (p.kind === 'text') out.push(p);
  };
  for (const a of doc.annotations) if (a.kind !== 'hatch' && layerVisible(doc, a.layer)) keep(plotAnnotation(doc, a, opts));
  for (const d of doc.dimensions) if (layerVisible(doc, d.layer)) keep(plotDimension(doc, d));
  return out;
}

/** Hatching is interrupted around text inside the hatched area (ISO 128-50, Norm rule HATCH-TEXT). */
function plotHatch(doc: SheetDoc, h: Hatch, opts: PlotOptions, tag: string): Primitive[] {
  const style = { width: LINE_GROUPS[doc.lineGroup].narrow, dash: [], dashOffset: 0, color: opts.screenColors ? SCREEN_COLORS.thin : BLACK };
  const boxes = sheetTexts(doc, opts).map((t) => textBox(t, TEXT_GAP_FACTOR * t.height));
  return clipOutsideConvex(hatchSheetSegments(doc, h), boxes).map(([a, b]) => ({ kind: 'polyline', points: [a, b], closed: false, style, tag }));
}

/**
 * Leader per ISO 128-22: narrow line through the points, terminator at the tip. A note stands on a horizontal
 * reference line that leaves the last point away from the leader; an item number sits just beyond the last point.
 */
function plotLeader(doc: SheetDoc, l: Leader, opts: PlotOptions, tag: string): Primitive[] {
  const view = getView(doc, l.viewId);
  const pts = l.points.map((p) => toSheet(view, p));
  if (pts.length < 2) return [];
  const narrow = LINE_GROUPS[doc.lineGroup].narrow;
  const color = opts.screenColors ? SCREEN_COLORS.thin : BLACK;
  const style = { width: narrow, dash: [], dashOffset: 0, color };
  const out: Primitive[] = [{ kind: 'polyline', points: pts, closed: false, style, tag }];
  const tip = pts[0];
  const w = norm(sub(tip, pts[1]));
  if (l.terminator === 'arrow') {
    const al = ARROW_LENGTH_FACTOR * narrow;
    const base = sub(tip, scale(w, al));
    const q = scale(perp(w), al * Math.tan(ARROW_ANGLE / 2));
    out.push({ kind: 'fill', points: [tip, add(base, q), sub(base, q)], color, tag });
  } else if (l.terminator === 'dot') {
    const r = (LEADER_DOT_FACTOR * narrow) / 2;
    const n = 16;
    out.push({ kind: 'fill', points: Array.from({ length: n }, (_, i) => add(tip, { x: r * Math.cos((2 * Math.PI * i) / n), y: r * Math.sin((2 * Math.PI * i) / n) })), color, tag });
  }
  if (!l.text) return out;
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const h = l.height;
  const gap = TEXT_GAP_FACTOR * h;
  const tw = textWidth(l.text, h);
  if (l.style === 'note') {
    const dir = last.x >= prev.x ? 1 : -1;
    out.push({ kind: 'polyline', points: [last, { x: last.x + dir * (tw + 2 * gap), y: last.y }], closed: false, style, tag });
    out.push({ kind: 'text', pos: { x: last.x + dir * gap, y: last.y + gap }, text: l.text, height: h, angle: 0, align: dir > 0 ? 'left' : 'right', baseline: 'bottom', color: BLACK, tag });
    return out;
  }
  // item number: centre the text box on the leader's extension, a gap beyond its end
  const u = norm(sub(last, prev));
  const t = Math.min(Math.abs(u.x) > 1e-9 ? tw / 2 / Math.abs(u.x) : Infinity, Math.abs(u.y) > 1e-9 ? h / 2 / Math.abs(u.y) : Infinity);
  out.push({ kind: 'text', pos: add(last, scale(u, gap + t)), text: l.text, height: h, angle: 0, align: 'center', baseline: 'middle', color: BLACK, tag });
  return out;
}

/** Sheet primitives of one annotation, tagged `annot:<id>`. */
export function plotAnnotation(doc: SheetDoc, a: Annotation, opts: PlotOptions): Primitive[] {
  const tag = `annot:${a.id}`;
  if (a.kind === 'text') return plotText(doc, a, tag);
  if (a.kind === 'leader') return plotLeader(doc, a, opts, tag);
  return plotHatch(doc, a, opts, tag);
}
