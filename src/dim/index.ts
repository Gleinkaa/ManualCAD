// CONTRACT: signatures are fixed. Bodies are implemented by the dim module owner.
import type { Dimension, SheetDoc } from '../model/types';
import type { Primitive } from '../plot/types';

/** The measured value in real mm (radius, diameter or distance), using associated geometry. */
export function measure(doc: SheetDoc, dim: Dimension): number {
  void doc; void dim;
  throw new Error('not implemented');
}

/** The final dimension text: override, or prefix + formatted value + suffix (ISO 129-1, decimal comma). */
export function dimensionText(doc: SheetDoc, dim: Dimension): string {
  void doc; void dim;
  throw new Error('not implemented');
}

/** Dimension lines, extension lines, terminators and text as SHEET-mm primitives, per ISO 129-1. */
export function plotDimension(doc: SheetDoc, dim: Dimension): Primitive[] {
  void doc; void dim;
  throw new Error('not implemented');
}
