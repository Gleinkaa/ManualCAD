import type { Vec2 } from '../geom/types';
import { formatScale, LINE_GROUPS, sheetSize } from '../model/standards';
import type { SheetDoc, TitleBlockField } from '../model/types';
import { textWidth } from './font';
import type { PlotOptions } from './sheet';
import { BLACK } from './style';
import type { Primitive, StrokeStyle } from './types';

/** ISO 5457: drawing frame 20 mm from the trimmed edge on the left (filing margin), 10 mm elsewhere. */
export const FRAME = { left: 20, right: 10, bottom: 10, top: 10, width: 0.7 };
/** ISO 5457: centring marks 0.7 mm wide, from the trimmed edge to 5 mm into the drawing space. */
export const CENTRING_MARK_INSET = 5;
/** ISO 7200: 180 mm wide (fits A4 portrait), same block on every format, bottom right of the frame. */
export const TITLE_BLOCK = { width: 180, height: 48 };

/** ISO 3098 type B series; text is shrunk along it until it fits its field. */
const TEXT_SERIES = [7, 5, 3.5, 2.5, 1.8];
const CAPTION_H = 2.5;
const VALUE_H = 3.5;

interface Cell {
  field: TitleBlockField | null;
  caption: string;
  x: number;   // relative to the title block's bottom-left corner
  y: number;
  w: number;
  h: number;
  valueH: number;
  center?: boolean;
}

// Layout after ISO 7200 Fig. 1 (identification row at the bottom, legal owner left, title above the
// identification number, administrative row on top) plus the Austrian-practice row for scale,
// material and general tolerance on top. Captions per ÖNORM EN ISO 7200 (German).
const CELLS: Cell[] = [
  { field: 'owner', caption: '', x: 0, y: 0, w: 55, h: 28, valueH: 5, center: true },
  { field: 'drawingNumber', caption: 'Zeichnungsnummer', x: 55, y: 0, w: 60, h: 10, valueH: 5 },
  { field: 'revision', caption: 'Änd.', x: 115, y: 0, w: 12, h: 10, valueH: VALUE_H },
  { field: 'date', caption: 'Ausgabedatum', x: 127, y: 0, w: 30, h: 10, valueH: VALUE_H },
  { field: 'sheet', caption: 'Blatt', x: 157, y: 0, w: 23, h: 10, valueH: VALUE_H },
  { field: 'title', caption: 'Benennung', x: 55, y: 10, w: 125, h: 18, valueH: 7 },
  { field: 'createdBy', caption: 'Erstellt durch', x: 0, y: 28, w: 45, h: 10, valueH: VALUE_H },
  { field: 'approvedBy', caption: 'Genehmigt von', x: 45, y: 28, w: 45, h: 10, valueH: VALUE_H },
  { field: 'documentType', caption: 'Dokumentart', x: 90, y: 28, w: 90, h: 10, valueH: VALUE_H },
  { field: null, caption: '', x: 0, y: 38, w: 22, h: 10, valueH: 0 }, // projection method symbol
  { field: 'scale', caption: 'Maßstab', x: 22, y: 38, w: 28, h: 10, valueH: VALUE_H },
  { field: 'material', caption: 'Werkstoff', x: 50, y: 38, w: 65, h: 10, valueH: VALUE_H },
  { field: 'generalTolerance', caption: 'Allgemeintoleranz', x: 115, y: 38, w: 65, h: 10, valueH: VALUE_H },
];

export interface FrameGeometry {
  sheet: { w: number; h: number };
  frame: { x0: number; y0: number; x1: number; y1: number };
  titleBlock: { x0: number; y0: number; x1: number; y1: number };
}

export function frameGeometry(doc: SheetDoc): FrameGeometry {
  const sheet = sheetSize(doc.format, doc.orientation);
  const frame = { x0: FRAME.left, y0: FRAME.bottom, x1: sheet.w - FRAME.right, y1: sheet.h - FRAME.top };
  const titleBlock = { x0: frame.x1 - TITLE_BLOCK.width, y0: frame.y0, x1: frame.x1, y1: frame.y0 + TITLE_BLOCK.height };
  return { sheet, frame, titleBlock };
}

/** Sheet-mm rectangles of the editable title block fields (for hit testing in the app). */
export function titleBlockFields(doc: SheetDoc): { field: TitleBlockField; x: number; y: number; w: number; h: number }[] {
  const { titleBlock: tb } = frameGeometry(doc);
  return CELLS.filter((c) => c.field).map((c) => ({ field: c.field!, x: tb.x0 + c.x, y: tb.y0 + c.y, w: c.w, h: c.h }));
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

  out.push(...plotTitleBlock(doc, tb, narrow));
  return out;
}

function plotTitleBlock(doc: SheetDoc, tb: FrameGeometry['titleBlock'], narrow: number): Primitive[] {
  const tag = 'titleblock';
  const out: Primitive[] = [];
  const at = (x: number, y: number): Vec2 => ({ x: tb.x0 + x, y: tb.y0 + y });
  const thin = solid(narrow);

  // Outline: left and top edge (bottom and right coincide with the frame).
  out.push(line([at(0, 0), at(0, TITLE_BLOCK.height), at(TITLE_BLOCK.width, TITLE_BLOCK.height)], solid(FRAME.width), tag));
  // Inner rulings: one line per cell edge that isn't on the outline, deduplicated.
  const seen = new Set<string>();
  const rule = (x0: number, y0: number, x1: number, y1: number): void => {
    const onOutline = (x0 === x1 && (x0 === 0 || x0 === TITLE_BLOCK.width)) || (y0 === y1 && (y0 === 0 || y0 === TITLE_BLOCK.height));
    const key = `${x0},${y0},${x1},${y1}`;
    if (onOutline || seen.has(key)) return;
    seen.add(key);
    out.push(line([at(x0, y0), at(x1, y1)], thin, tag));
  };
  for (const c of CELLS) {
    rule(c.x, c.y + c.h, c.x + c.w, c.y + c.h);
    rule(c.x + c.w, c.y, c.x + c.w, c.y + c.h);
  }

  for (const c of CELLS) {
    if (c.caption) {
      const h = fitTextHeight(c.caption, CAPTION_H, c.w - 2);
      out.push(text(at(c.x + 1, c.y + c.h - 1), c.caption, h, 'left', 'top', tag));
    }
    if (!c.field) continue;
    const value = titleBlockValue(doc, c.field);
    if (!value) continue;
    if (c.center) {
      out.push(text(at(c.x + c.w / 2, c.y + c.h / 2), value, fitTextHeight(value, c.valueH, c.w - 4), 'center', 'middle', `${tag}:${c.field}`));
    } else {
      const h = fitTextHeight(value, c.valueH, c.w - 3);
      out.push(text(at(c.x + 1.5, c.y + (c.h > 10 ? 3 : 1.5)), value, h, 'left', 'bottom', `${tag}:${c.field}`));
    }
  }

  out.push(...projectionSymbol(at(11, 43), thin, tag));
  return out;
}

/** First-angle projection method symbol (ISO 5456-2) for lettering height h = 3.5, centred at `c`. */
function projectionSymbol(c: Vec2, style: StrokeStyle, tag: string): Primitive[] {
  const h = 3.5;
  const p = (x: number, y: number): Vec2 => ({ x: c.x + x, y: c.y + y });
  const centre: StrokeStyle = { ...style, dash: [3, 0.6, 0.3, 0.6] };
  return [
    // Truncated cone, front view: small end left, large end right.
    line([p(-8.5, -h / 2), p(-1.5, -h), p(-1.5, h), p(-8.5, h / 2)], style, tag, true),
    // View from the left, placed on the right (first angle).
    { kind: 'arc', c: p(5, 0), r: h, start: 0, end: 2 * Math.PI, style, tag },
    { kind: 'arc', c: p(5, 0), r: h / 2, start: 0, end: 2 * Math.PI, style, tag },
    line([p(-9.5, 0), p(9.5, 0)], centre, tag),
    line([p(5, -h - 1), p(5, h + 1)], centre, tag),
  ];
}
