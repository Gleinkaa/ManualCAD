// CONTRACT: signatures are fixed. Bodies are implemented by the plot module owner.
import type { LineTypeId, SheetDoc } from '../model/types';
import type { Curve } from '../geom/types';
import type { Primitive, StrokeStyle } from './types';

export * from './types';

export interface PlotOptions {
  /** Screen display shows construction lines; PDF/print never does. */
  includeConstruction: boolean;
  /** Use screen colours (per line type) instead of plain black. */
  screenColors: boolean;
}

/** Stroke style for a line type in the sheet's line group (width, ISO 128-2 dash lengths, colour). */
export function lineStyle(doc: SheetDoc, lineType: LineTypeId, opts: PlotOptions): StrokeStyle {
  void doc; void lineType; void opts;
  throw new Error('not implemented');
}

/**
 * Dash style for one concrete curve: the pattern is stretched slightly so the curve starts and ends
 * with a full dash/long dash (ISO 128-2 centre line rule). `lengthMm` is the curve length on paper.
 */
export function fitDash(style: StrokeStyle, lengthMm: number): StrokeStyle {
  void style; void lengthMm;
  throw new Error('not implemented');
}

/** One entity curve (view-local) to sheet primitives. */
export function plotCurve(doc: SheetDoc, viewId: string, curve: Curve, lineType: LineTypeId, opts: PlotOptions): Primitive[] {
  void doc; void viewId; void curve; void lineType; void opts;
  throw new Error('not implemented');
}

/** Frame + centring marks (ISO 5457) and title block (ISO 7200). */
export function plotFrame(doc: SheetDoc, opts: PlotOptions): Primitive[] {
  void doc; void opts;
  throw new Error('not implemented');
}

/** Everything visible on the sheet: frame, title block, entities, dimensions, view labels. Hidden layers skipped. */
export function plotSheet(doc: SheetDoc, opts: PlotOptions): Primitive[] {
  void doc; void opts;
  throw new Error('not implemented');
}

/** Maps sheet mm to canvas pixels: px = (mm - pan) * zoom, with y flipped by the renderer. */
export interface CanvasTransform {
  zoom: number;              // px per sheet mm
  panX: number;              // sheet mm at canvas left edge
  panY: number;              // sheet mm at canvas bottom edge
  heightPx: number;          // canvas height in px (for the y flip)
}

/** Draws primitives to a 2D canvas. Line widths are drawn at true paper width, but never thinner than 1 px. */
export function renderCanvas(ctx: CanvasRenderingContext2D, prims: Primitive[], t: CanvasTransform): void {
  void ctx; void prims; void t;
  throw new Error('not implemented');
}

/** Vector PDF of the sheet at exact 1:1 paper size (prints to scale), ISO 3098 font embedded. */
export function exportPdf(doc: SheetDoc): Promise<Blob> {
  void doc;
  return Promise.reject(new Error('not implemented'));
}

/** Loads the ISO 3098 font (osifont) for canvas use. Resolves when ready. */
export function loadFonts(): Promise<void> {
  return Promise.resolve();
}

/** CSS font-family name to use for canvas text. */
export const FONT_FAMILY = 'osifont';
