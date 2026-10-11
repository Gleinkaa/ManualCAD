import type { Vec2 } from '../geom/types';
import { formatScale, LINE_GROUPS, sheetSize } from '../model/standards';
import { TITLE_BLOCK_TEMPLATES, titleBlockTemplate, type PartsListLayout, type TitleBlockTemplate } from '../model/titleblock';
import type { PartsListRow, SheetDoc, TitleBlockField } from '../model/types';
import { textWidth } from './font';
import type { PlotOptions } from './sheet';
import { BLACK, fitPattern, strokeStyle } from './style';
import type { Primitive, StrokeStyle } from './types';

/** ISO 5457: drawing frame 20 mm from the trimmed edge on the left (filing margin), 10 mm elsewhere. */
export const FRAME = { left: 20, right: 10, bottom: 10, top: 10, width: 0.7 };
/** ISO 5457: centring marks 0.7 mm wide, from the trimmed edge to 5 mm into the drawing space. */
export const CENTRING_MARK_INSET = 5;
/** ISO 7200: 180 mm wide (fits A4 portrait), same block on every format, bottom right of the frame. */
export const TITLE_BLOCK = { width: TITLE_BLOCK_TEMPLATES.iso7200.width, height: TITLE_BLOCK_TEMPLATES.iso7200.height };

/** ISO 3098 type B series; text is shrunk along it until it fits its field. */
const TEXT_SERIES = [7, 5, 3.5, 2.5, 1.8];
const CAPTION_H = 2.5;

/** ISO 7573 parts list of the ISO 7200 template; the sheet's own layout comes from its title block template. */
export const PARTS_LIST = { headerHeight: TITLE_BLOCK_TEMPLATES.iso7200.partsList.headerHeight, rowHeight: TITLE_BLOCK_TEMPLATES.iso7200.partsList.rowHeight };

interface PartsColumn {
  field: keyof PartsListRow;
  caption: string[];         // one or two caption lines
  w: number;
  center?: boolean;
}

// Captions per ÖNORM EN ISO 7573 (German); widths sum to TITLE_BLOCK.width.
export const PARTS_COLUMNS: PartsColumn[] = TITLE_BLOCK_TEMPLATES.iso7200.partsList.columns.map(({ field, caption, w, center }) => ({ field, caption, w, center }));

export interface FrameGeometry {
  sheet: { w: number; h: number };
  frame: { x0: number; y0: number; x1: number; y1: number };
  titleBlock: { x0: number; y0: number; x1: number; y1: number };
}

export function frameGeometry(doc: SheetDoc): FrameGeometry {
  const sheet = sheetSize(doc.format, doc.orientation);
  const frame = { x0: FRAME.left, y0: FRAME.bottom, x1: sheet.w - FRAME.right, y1: sheet.h - FRAME.top };
  const t = titleBlockTemplate(doc);
  const titleBlock = { x0: frame.x1 - t.width, y0: frame.y0, x1: frame.x1, y1: frame.y0 + t.height };
  return { sheet, frame, titleBlock };
}

/** Sheet-mm rectangles of the editable title block fields (for hit testing in the app). */
export function titleBlockFields(doc: SheetDoc): { field: TitleBlockField; x: number; y: number; w: number; h: number }[] {
  const { titleBlock: tb } = frameGeometry(doc);
  return titleBlockTemplate(doc).fields.map((f) => ({ field: f.field, x: tb.x0 + f.box.x, y: tb.y0 + f.box.y, w: f.box.w, h: f.box.h }));
}

/** Sheet-mm rectangle of the parts list above the title block (empty list: the header line only, zero height). */
export function partsListRect(doc: SheetDoc): { x0: number; y0: number; x1: number; y1: number } {
  const { titleBlock: tb } = frameGeometry(doc);
  const pl = titleBlockTemplate(doc).partsList;
  const n = doc.partsList?.length ?? 0;
  return { x0: tb.x0, y0: tb.y1, x1: tb.x1, y1: n ? tb.y1 + pl.headerHeight + n * pl.rowHeight : tb.y1 };
}

/** The value shown in a title block field; the scale defaults to the main view's scale. */
export function titleBlockValue(doc: SheetDoc, field: TitleBlockField): string {
  const v = doc.titleBlock[field]?.trim() ?? '';
  if (v || field !== 'scale' || !doc.views[0]) return v;
  return formatScale(doc.views[0].scale);
}

/** Largest series height ≤ preferred at which the text fits `width`. */
export function fitTextHeight(text: string, preferred: number, width: number): number {
  const series = TEXT_SERIES.filter((h) => h <= preferred);
  return series.find((h) => textWidth(text, h) <= width) ?? series[series.length - 1] ?? preferred;
}

const solid = (width: number): StrokeStyle => ({ width, dash: [], dashOffset: 0, color: BLACK });

function line(points: Vec2[], style: StrokeStyle, tag: string, closed = false): Primitive {
  return { kind: 'polyline', points, closed, style, tag };
}

function text(pos: Vec2, s: string, height: number, align: 'left' | 'center', baseline: 'bottom' | 'middle' | 'top', tag: string): Primitive {
  return { kind: 'text', pos, text: s, height, angle: 0, align, baseline, color: BLACK, tag };
}

export function plotFrame(doc: SheetDoc, opts: PlotOptions): Primitive[] {
  void opts; // frame and title block are black on screen too
  const { sheet, frame: f, titleBlock: tb } = frameGeometry(doc);
  const narrow = LINE_GROUPS[doc.lineGroup].narrow;
  const out: Primitive[] = [];

  // Trimmed sheet edge (the paper edge itself in the PDF).
  out.push(line([{ x: 0, y: 0 }, { x: sheet.w, y: 0 }, { x: sheet.w, y: sheet.h }, { x: 0, y: sheet.h }], solid(narrow), 'sheet-edge', true));
  out.push(line([{ x: f.x0, y: f.y0 }, { x: f.x1, y: f.y0 }, { x: f.x1, y: f.y1 }, { x: f.x0, y: f.y1 }], solid(FRAME.width), 'frame', true));

  // Centring marks on the axes of symmetry of the trimmed sheet.
  const cx = sheet.w / 2;
  const cy = sheet.h / 2;
  const m = CENTRING_MARK_INSET;
  const bottomEnd = cx > tb.x0 && cx < tb.x1 ? f.y0 : f.y0 + m; // stop at the frame where the title block sits
  const mark = solid(FRAME.width);
  out.push(line([{ x: 0, y: cy }, { x: f.x0 + m, y: cy }], mark, 'frame'));
  out.push(line([{ x: sheet.w, y: cy }, { x: f.x1 - m, y: cy }], mark, 'frame'));
  out.push(line([{ x: cx, y: sheet.h }, { x: cx, y: f.y1 - m }], mark, 'frame'));
  out.push(line([{ x: cx, y: 0 }, { x: cx, y: bottomEnd }], mark, 'frame'));

  const template = titleBlockTemplate(doc);
  out.push(...plotTitleBlock(doc, template, tb, narrow));
  out.push(...plotPartsList(doc.partsList ?? [], template.partsList, tb, narrow));
  return out;
}

function plotPartsList(rows: PartsListRow[], layout: PartsListLayout, tb: FrameGeometry['titleBlock'], narrow: number): Primitive[] {
  if (rows.length === 0) return [];
  const tag = 'partslist';
  const out: Primitive[] = [];
  const { headerHeight: hh, rowHeight: rh, columns } = layout;
  const y0 = tb.y1;
  const top = y0 + hh + rows.length * rh;
  const thin = solid(narrow);
  const wide = solid(FRAME.width);
  // Outline: left and top edge (the bottom is the title block's top, the right edge the frame).
  out.push(line([{ x: tb.x0, y: y0 }, { x: tb.x0, y: top }, { x: tb.x1, y: top }], wide, tag));
  // The header is separated from the item rows by a wide line.
  out.push(line([{ x: tb.x0, y: y0 + hh }, { x: tb.x1, y: y0 + hh }], wide, tag));
  for (let i = 1; i < rows.length; i++) {
    const y = y0 + hh + i * rh;
    out.push(line([{ x: tb.x0, y }, { x: tb.x1, y }], thin, tag));
  }
  let x = tb.x0;
  for (const c of columns.slice(0, -1)) {
    x += c.w;
    out.push(line([{ x, y: y0 }, { x, y: top }], thin, tag));
  }

  x = tb.x0;
  for (const c of columns) {
    const h = Math.min(...c.caption.map((t) => fitTextHeight(t, CAPTION_H, c.w - 2)));
    const lines = c.caption.length;
    c.caption.forEach((t, k) => {
      // one caption line centred in the header, two lines stacked around the centre
      const cy = y0 + hh / 2 + (lines === 1 ? 0 : (k === 0 ? 1 : -1) * (h * 0.5 + 0.6));
      out.push(text({ x: x + c.w / 2, y: cy }, t, h, 'center', 'middle', tag));
    });
    rows.forEach((row, i) => {
      const value = row[c.field]?.trim();
      if (!value) return;
      const h = fitTextHeight(value, layout.valueH, c.w - 3);
      const cy = y0 + hh + i * rh + rh / 2;
      const pos = c.center ? { x: x + c.w / 2, y: cy } : { x: x + 1.5, y: cy };
      out.push(text(pos, value, h, c.center ? 'center' : 'left', 'middle', `${tag}:${i}:${c.field}`));
    });
    x += c.w;
  }
  return out;
}

function plotTitleBlock(doc: SheetDoc, t: TitleBlockTemplate, tb: FrameGeometry['titleBlock'], narrow: number): Primitive[] {
  const tag = 'titleblock';
  const out: Primitive[] = [];
  const at = (x: number, y: number): Vec2 => ({ x: tb.x0 + x, y: tb.y0 + y });
  const thin = solid(narrow);

  // Outline: left and top edge (bottom and right coincide with the frame); inner rulings narrow (ADR-0006).
  out.push(line([at(0, 0), at(0, t.height), at(t.width, t.height)], solid(FRAME.width), tag));
  for (const [x0, y0, x1, y1] of t.rules) out.push(line([at(x0, y0), at(x1, y1)], thin, tag));

  for (const c of t.captions) {
    out.push(text(at(c.x, c.y), c.text, fitTextHeight(c.text, CAPTION_H, c.w), c.align, c.baseline, tag));
  }
  for (const f of t.fields) {
    const value = titleBlockValue(doc, f.field);
    if (!value) continue;
    const b = f.box;
    const h = fitTextHeight(value, f.valueH, b.w - (f.align === 'center' ? 4 : 3));
    const x = f.align === 'center' ? b.x + b.w / 2 : b.x + 1.5;
    const y = f.baseline === 'middle' ? b.y + b.h / 2 : b.y + f.baseline;
    out.push(text(at(x, y), value, h, f.align, f.baseline === 'middle' ? 'middle' : 'bottom', `${tag}:${f.field}`));
  }

  if (t.projection) out.push(...projectionSymbol(doc, at(t.projection.x, t.projection.y), t.projection.h, thin, tag));
  return out;
}

/** First-angle projection method symbol (ISO 5456-2) for lettering height h, centred at `c`. */
function projectionSymbol(doc: SheetDoc, c: Vec2, h: number, style: StrokeStyle, tag: string): Primitive[] {
  const k = h / 3.5; // the layout below is drawn for h = 3.5
  const p = (x: number, y: number): Vec2 => ({ x: c.x + x * k, y: c.y + y * k });
  // Centre lines from the line-type system (ADR-0001), fitted to each length like any drawn line.
  // At this size the short vertical axis is below one period and comes out continuous (fitPattern).
  const centreBase = strokeStyle(doc, 'center', false); // the frame is black on screen too
  const centre = (len: number): StrokeStyle => fitPattern(centreBase, len, false);
  return [
    // Truncated cone, front view: small end left, large end right.
    line([p(-8.5, -3.5 / 2), p(-1.5, -3.5), p(-1.5, 3.5), p(-8.5, 3.5 / 2)], style, tag, true),
    // View from the left, placed on the right (first angle).
    { kind: 'arc', c: p(5, 0), r: h, start: 0, end: 2 * Math.PI, style, tag },
    { kind: 'arc', c: p(5, 0), r: h / 2, start: 0, end: 2 * Math.PI, style, tag },
    line([p(-9.5, 0), p(9.5, 0)], centre(19 * k), tag),
    line([p(5, -3.5 - 1), p(5, 3.5 + 1)], centre((2 * 3.5 + 2) * k), tag),
  ];
}
