// CONTRACT: signatures are fixed. Bodies are implemented by the plot module owner.
import type { LineTypeId, SheetDoc } from '../model/types';
import type { Curve } from '../geom/types';
import type { Primitive, StrokeStyle } from './types';
import { fitPattern, strokeStyle } from './style';
import { plotCurve as plotCurveTagged, type PlotOptions } from './sheet';

export * from './types';
export type { PlotOptions } from './sheet';
export { plotSheet, viewLabel, labelHeight } from './sheet';
export { plotFrame, frameGeometry, titleBlockFields, titleBlockValue, FRAME, TITLE_BLOCK } from './frame';
export { renderCanvas, type CanvasTransform } from './canvas';
export { FONT_FAMILY, loadFonts, textWidth, fontSizeForCapHeight } from './font';
export { SCREEN_COLORS } from './style';

/** Stroke style for a line type in the sheet's line group (width, ISO 128-2 dash lengths, colour). */
export function lineStyle(doc: SheetDoc, lineType: LineTypeId, opts: PlotOptions): StrokeStyle {
  return strokeStyle(doc, lineType, opts.screenColors);
}

/**
 * Dash style for one concrete curve: the pattern is stretched slightly so the curve starts and ends
 * with a full dash/long dash (ISO 128-2 centre line rule). `lengthMm` is the curve length on paper.
 */
export function fitDash(style: StrokeStyle, lengthMm: number): StrokeStyle {
  return fitPattern(style, lengthMm, false);
}

/** One entity curve (view-local) to sheet primitives. */
export function plotCurve(doc: SheetDoc, viewId: string, curve: Curve, lineType: LineTypeId, opts: PlotOptions): Primitive[] {
  return plotCurveTagged(doc, viewId, curve, lineType, opts);
}

/** Vector PDF of the sheet at exact 1:1 paper size (prints to scale), ISO 3098 font embedded. */
export async function exportPdf(doc: SheetDoc): Promise<Blob> {
  const pdf = await import('./pdf'); // keeps jsPDF out of the main bundle
  return pdf.exportPdf(doc);
}
