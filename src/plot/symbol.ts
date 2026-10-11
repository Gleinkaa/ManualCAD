// Symbols (CONTEXT.md "Symbol") to sheet primitives: surface texture (ISO 21920-1, layout of ISO 1302) and
// taper/slope (ISO 3040). Every size comes from the sheet's lettering height h, every line is a narrow line.
import { ARROW_ANGLE, ARROW_LENGTH_FACTOR, TEXT_GAP_FACTOR } from '../dim';
import { add, norm, perp, scale, sub } from '../geom';
import type { Vec2 } from '../geom/types';
import { taperNarrowSign } from '../model/annot';
import { getView, toSheet } from '../model/doc';
import { LINE_GROUPS, SURFACE_SYMBOL, TAPER_SYMBOL } from '../model/standards';
import type { SheetDoc, SurfaceFields, SurfaceSymbol, TaperSymbol } from '../model/types';
import { textWidth } from './font';
import type { PlotOptions } from './sheet';
import { BLACK, SCREEN_COLORS } from './style';
import type { Primitive, StrokeStyle } from './types';

type TextPrimitive = Extract<Primitive, { kind: 'text' }>;

/** A text of a symbol and the field it shows: a surface texture position, or the taper/slope ratio. */
export interface SymbolText {
  field: keyof SurfaceFields | 'ratio' | 'open' | 'close';
  prim: TextPrimitive;
}

/**
 * A symbol in its own frame: paper mm, origin at the anchor (the surface symbol's vertex, the taper symbol's
 * reference line start), x along the symbol, unrotated. `lines` holds strokes and fills, `texts` the lettering:
 * one per field, empty fields included so an exported block can carry them as attributes.
 */
export interface SymbolLayout {
  lines: Primitive[];
  texts: SymbolText[];
}

/** Lettering height of symbols: the sheet's dimension text height (ISO 129-1, line group). */
export function symbolTextHeight(doc: SheetDoc): number {
  return LINE_GROUPS[doc.lineGroup].dimText;
}

function thinStyle(doc: SheetDoc, opts: PlotOptions): StrokeStyle {
  return { width: LINE_GROUPS[doc.lineGroup].narrow, dash: [], dashOffset: 0, color: opts.screenColors ? SCREEN_COLORS.thin : BLACK };
}

const TAN30 = Math.tan(Math.PI / 6);

/**
 * Surface texture symbol for lettering height `h`, vertex at the origin, standing upright. Legs at 60° to the
 * surface, short leg H1 = 1.4 h, long leg H2 = 3 h; the bar on the long leg reaches over the longest of a, b, c.
 * Positions (ISO 1302): a and b under the bar, c above it, d right of the V, e left of it.
 */
export function surfaceSymbolLayout(s: Pick<SurfaceSymbol, 'removal' | 'fields' | 'collective'>, h: number, style: StrokeStyle): SymbolLayout {
  const cot = 1 / Math.tan(SURFACE_SYMBOL.legAngle); // horizontal run per unit of leg height
  const h1 = SURFACE_SYMBOL.shortLeg * h;
  const h2 = SURFACE_SYMBOL.longLeg * h;
  const gap = TEXT_GAP_FACTOR * h;
  // a collective indication takes no texts: the values are dropped, but their (empty) places stay so the DXF
  // export still writes the BBRZ attribute definitions the importer recognises the block by
  const f: SurfaceFields = s.collective ? { roughness: '', second: '', process: '', lay: '', allowance: '' } : s.fields;
  const top = { x: h2 * cot, y: h2 };
  const tw = Math.max(textWidth(f.roughness, h), textWidth(f.second, h), textWidth(f.process, h));
  const bar = Math.max(h1, tw > 0 ? tw + 2 * gap : 0);
  const lines: Primitive[] = [
    { kind: 'polyline', points: [{ x: -h1 * cot, y: h1 }, { x: 0, y: 0 }, top, { x: top.x + bar, y: h2 }], closed: false, style },
  ];
  if (s.removal === 'required') lines.push({ kind: 'polyline', points: [{ x: -h1 * cot, y: h1 }, { x: h1 * cot, y: h1 }], closed: false, style });
  if (s.removal === 'prohibited') lines.push({ kind: 'arc', c: { x: 0, y: (2 * h1) / 3 }, r: h1 / 3, start: 0, end: 2 * Math.PI, style });
  const texts: SymbolText[] = [];
  // every field gets its place, empty ones too (DXF export writes them as attributes); plotting skips empty texts
  const text = (field: SymbolText['field'], value: string, pos: Vec2, align: TextPrimitive['align'], height = h) => {
    texts.push({ field, prim: { kind: 'text', pos, text: value, height, angle: 0, align, baseline: 'bottom', color: BLACK } });
  };
  const x = top.x + gap;
  text('roughness', f.roughness, { x, y: h2 - gap - h }, 'left');
  text('second', f.second, { x, y: h2 - 2 * (gap + h) }, 'left');
  text('process', f.process, { x, y: h2 + gap }, 'left');
  text('lay', f.lay, { x: h * TAN30 + gap, y: 0 }, 'left');
  text('allowance', f.allowance, { x: -(h * TAN30 + gap), y: 0 }, 'right');
  if (s.collective) {
    // the parentheses of a collective indication enclose the whole symbol, two lettering heights tall
    const ph = 2 * h;
    const y = (h2 - ph) / 2;
    text('open', '(', { x: -h1 * cot - gap, y }, 'right', ph);
    text('close', ')', { x: top.x + bar + gap, y }, 'left', ph);
  }
  return { lines, texts };
}

/**
 * Taper or slope symbol on a reference line for lettering height `h`: origin at the reference line start, which runs
 * towards `side` (+1 right, −1 left). After a gap come the triangle (h high, 2 h long) and the ratio; the reference
 * line ends a gap after the text. A taper triangle is symmetric about the line, a slope triangle stands on it.
 * The end the triangle narrows towards comes from the symbol's view-local direction, never from `side`.
 */
export function taperSymbolLayout(t: Pick<TaperSymbol, 'form' | 'ratio' | 'direction'>, side: 1 | -1, h: number, style: StrokeStyle): SymbolLayout {
  const gap = TEXT_GAP_FACTOR * h;
  const len = TAPER_SYMBOL.length * h;
  const high = TAPER_SYMBOL.height * h;
  const tw = textWidth(t.ratio, h);
  const width = len + (tw > 0 ? gap + tw : 0);
  const x0 = side > 0 ? gap : -gap - width;
  const narrowTowards = taperNarrowSign(t.form, t.direction);
  const wide = narrowTowards > 0 ? x0 : x0 + len; // the triangle's high or wide end
  const narrow = narrowTowards > 0 ? x0 + len : x0;
  const tri: Vec2[] =
    t.form === 'taper'
      ? [{ x: wide, y: -high / 2 }, { x: wide, y: high / 2 }, { x: narrow, y: 0 }]
      : [{ x: wide, y: 0 }, { x: wide, y: high }, { x: narrow, y: 0 }];
  const lines: Primitive[] = [
    { kind: 'polyline', points: [{ x: 0, y: 0 }, { x: side * (2 * gap + width), y: 0 }], closed: false, style },
    { kind: 'polyline', points: tri, closed: true, style },
  ];
  const texts: SymbolText[] = [{ field: 'ratio', prim: { kind: 'text', pos: { x: x0 + len + gap, y: gap }, text: t.ratio, height: h, angle: 0, align: 'left', baseline: 'bottom', color: BLACK } }];
  return { lines, texts };
}

/** Rotate by `angle` about the origin, then move to `at`. */
function placer(at: Vec2, angle: number): (p: Vec2) => Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return (p) => ({ x: at.x + p.x * c - p.y * s, y: at.y + p.x * s + p.y * c });
}

/** A layout's primitives placed on the sheet: rotated by `angle` about the origin, moved to `at`. */
export function placeLayout(layout: SymbolLayout, at: Vec2, angle: number, tag: string): Primitive[] {
  const f = placer(at, angle);
  const out: Primitive[] = [];
  for (const p of layout.lines) {
    if (p.kind === 'polyline' || p.kind === 'fill') out.push({ ...p, points: p.points.map(f), tag });
    else if (p.kind === 'arc') out.push({ ...p, c: f(p.c), start: p.start + angle, end: p.end + angle, tag });
  }
  for (const { prim } of layout.texts) if (prim.text) out.push({ ...prim, pos: f(prim.pos), angle: prim.angle + angle, tag });
  return out;
}

export function plotSurfaceSymbol(doc: SheetDoc, s: SurfaceSymbol, opts: PlotOptions, tag: string): Primitive[] {
  const layout = surfaceSymbolLayout(s, symbolTextHeight(doc), thinStyle(doc, opts));
  return placeLayout(layout, toSheet(getView(doc, s.viewId), s.pos), s.angle, tag);
}

/** Side the reference line leaves the last leader point towards: away from the leader, right when it ends vertical. */
export function referenceSide(pts: Vec2[]): 1 | -1 {
  const n = pts.length;
  if (n < 2) return 1;
  return pts[n - 1].x >= pts[n - 2].x ? 1 : -1;
}

/** Arrowhead at `tip` for a leader arriving along unit direction `w` (pointing at the tip). */
export function leaderArrow(tip: Vec2, w: Vec2, narrow: number, color: string, tag: string): Primitive {
  const al = ARROW_LENGTH_FACTOR * narrow;
  const base = sub(tip, scale(w, al));
  const q = scale(perp(w), al * Math.tan(ARROW_ANGLE / 2));
  return { kind: 'fill', points: [tip, add(base, q), sub(base, q)], color, tag };
}

export function plotTaperSymbol(doc: SheetDoc, t: TaperSymbol, opts: PlotOptions, tag: string): Primitive[] {
  const view = getView(doc, t.viewId);
  const pts = t.points.map((p) => toSheet(view, p));
  if (pts.length < 2) return [];
  const style = thinStyle(doc, opts);
  const out: Primitive[] = [{ kind: 'polyline', points: pts, closed: false, style, tag }];
  const d = sub(pts[0], pts[1]);
  if (d.x !== 0 || d.y !== 0) out.push(leaderArrow(pts[0], norm(d), style.width, style.color, tag));
  const layout = taperSymbolLayout(t, referenceSide(pts), symbolTextHeight(doc), style);
  out.push(...placeLayout(layout, pts[pts.length - 1], 0, tag));
  return out;
}
