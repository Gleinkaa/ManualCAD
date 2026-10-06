import type { BBox, Curve, Vec2 } from '../geom/types';
import { plotDimension } from '../dim';
import { getView, toSheet } from '../model/doc';
import { formatScale, LINE_GROUPS, LINE_TYPES } from '../model/standards';
import type { LineTypeId, SheetDoc, View } from '../model/types';
import { plotFrame } from './frame';
import { BLACK, fitPattern, SCREEN_COLORS, strokeStyle } from './style';
import type { Primitive } from './types';

export interface PlotOptions {
  /** Screen display shows construction lines; PDF/print never does. */
  includeConstruction: boolean;
  /** Use screen colours (per line type) instead of plain black. */
  screenColors: boolean;
}

const TAU = 2 * Math.PI;

/** Counter-clockwise sweep of an arc in (0, 2π]. */
export function arcSweep(start: number, end: number): number {
  const s = (end - start) % TAU;
  return s <= 0 ? s + TAU : s;
}

export function plotCurve(doc: SheetDoc, viewId: string, curve: Curve, lineType: LineTypeId, opts: PlotOptions, tag?: string): Primitive[] {
  if (lineType === 'construction' && !opts.includeConstruction) return [];
  const view = getView(doc, viewId);
  const base = strokeStyle(doc, lineType, opts.screenColors);
  switch (curve.kind) {
    case 'line': {
      const a = toSheet(view, curve.a);
      const b = toSheet(view, curve.b);
      const style = fitPattern(base, Math.hypot(b.x - a.x, b.y - a.y), false);
      return [{ kind: 'polyline', points: [a, b], closed: false, style, tag }];
    }
    case 'circle': {
      const r = curve.r * view.scale;
      const style = fitPattern(base, TAU * r, true);
      return [{ kind: 'arc', c: toSheet(view, curve.c), r, start: 0, end: TAU, style, tag }];
    }
    case 'arc': {
      const r = curve.r * view.scale;
      const style = fitPattern(base, arcSweep(curve.start, curve.end) * r, false);
      return [{ kind: 'arc', c: toSheet(view, curve.c), r, start: curve.start, end: curve.start + arcSweep(curve.start, curve.end), style, tag }];
    }
  }
}

/** Label text of a view per ISO 128-3: none for the main (first) view, else its name plus the scale if it differs. */
export function viewLabel(doc: SheetDoc, view: View): string | null {
  const main = doc.views[0];
  // Views in projection relation need no designation (ISO 128-3).
  if (!main || view.id === main.id || view.link) return null;
  const differs = Math.abs(view.scale - main.scale) > 1e-9;
  return differs ? `${view.name} (${formatScale(view.scale)})` : view.name;
}

/** Designation letters are √2 × the dimension text height (ISO 128-3 / ISO 3098 series). */
export function labelHeight(doc: SheetDoc): number {
  return LINE_GROUPS[doc.lineGroup].dimText === 3.5 ? 5 : 7;
}

function curveBox(c: Curve): BBox {
  if (c.kind === 'line') {
    return { min: { x: Math.min(c.a.x, c.b.x), y: Math.min(c.a.y, c.b.y) }, max: { x: Math.max(c.a.x, c.b.x), y: Math.max(c.a.y, c.b.y) } };
  }
  if (c.kind === 'circle') return { min: { x: c.c.x - c.r, y: c.c.y - c.r }, max: { x: c.c.x + c.r, y: c.c.y + c.r } };
  const sweep = arcSweep(c.start, c.end);
  const angles = [c.start, c.start + sweep];
  for (let q = Math.ceil(c.start / (Math.PI / 2)) * (Math.PI / 2); q < c.start + sweep; q += Math.PI / 2) angles.push(q);
  const ps: Vec2[] = angles.map((a) => ({ x: c.c.x + c.r * Math.cos(a), y: c.c.y + c.r * Math.sin(a) }));
  return {
    min: { x: Math.min(...ps.map((p) => p.x)), y: Math.min(...ps.map((p) => p.y)) },
    max: { x: Math.max(...ps.map((p) => p.x)), y: Math.max(...ps.map((p) => p.y)) },
  };
}

/** Dimensions are thin lines: retag them and give them the thin line colour. */
function dimPrimitive(p: Primitive, tag: string, color: string): Primitive {
  if (p.kind === 'polyline' || p.kind === 'arc') return { ...p, tag, style: { ...p.style, color } };
  return { ...p, tag, color };
}

function layerVisible(doc: SheetDoc, name: string): boolean {
  return doc.layers.find((l) => l.name === name)?.visible ?? true;
}

export function plotSheet(doc: SheetDoc, opts: PlotOptions): Primitive[] {
  const out = plotFrame(doc, opts);
  const boxes = new Map<string, BBox>();
  for (const e of doc.entities) {
    if (!layerVisible(doc, e.layer)) continue;
    if (!LINE_TYPES[e.lineType].plotted && !opts.includeConstruction) continue;
    out.push(...plotCurve(doc, e.viewId, e.geom, e.lineType, opts, `entity:${e.id}`));
    if (e.lineType === 'construction') continue;
    const b = curveBox(e.geom);
    const prev = boxes.get(e.viewId);
    boxes.set(e.viewId, prev ? {
      min: { x: Math.min(prev.min.x, b.min.x), y: Math.min(prev.min.y, b.min.y) },
      max: { x: Math.max(prev.max.x, b.max.x), y: Math.max(prev.max.y, b.max.y) },
    } : b);
  }
  const dimColor = opts.screenColors ? SCREEN_COLORS.thin : BLACK;
  for (const d of doc.dimensions) {
    if (!layerVisible(doc, d.layer)) continue;
    out.push(...plotDimension(doc, d).map((p) => dimPrimitive(p, `dim:${d.id}`, dimColor)));
  }
  const h = labelHeight(doc);
  for (const view of doc.views) {
    const text = viewLabel(doc, view);
    if (!text) continue;
    const box = boxes.get(view.id);
    const top = box ? toSheet(view, { x: (box.min.x + box.max.x) / 2, y: box.max.y }) : view.origin;
    out.push({ kind: 'text', pos: { x: top.x, y: top.y + h }, text, height: h, angle: 0, align: 'center', baseline: 'bottom', color: BLACK, tag: `label:${view.id}` });
  }
  return out;
}
