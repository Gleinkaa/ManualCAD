// Annotations (text, hatching) to sheet primitives.
import { hatchSegments } from '../geom';
import type { Curve, Vec2 } from '../geom/types';
import { getView, toSheet } from '../model/doc';
import { LINE_GROUPS } from '../model/standards';
import type { Annotation, Hatch, SheetDoc, TextNote, View } from '../model/types';
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

function plotHatch(doc: SheetDoc, h: Hatch, opts: PlotOptions, tag: string): Primitive[] {
  const style = { width: LINE_GROUPS[doc.lineGroup].narrow, dash: [], dashOffset: 0, color: opts.screenColors ? SCREEN_COLORS.thin : BLACK };
  return hatchSheetSegments(doc, h).map(([a, b]) => ({ kind: 'polyline', points: [a, b], closed: false, style, tag }));
}

/** Sheet primitives of one annotation, tagged `annot:<id>`. */
export function plotAnnotation(doc: SheetDoc, a: Annotation, opts: PlotOptions): Primitive[] {
  const tag = `annot:${a.id}`;
  return a.kind === 'text' ? plotText(doc, a, tag) : plotHatch(doc, a, opts, tag);
}
