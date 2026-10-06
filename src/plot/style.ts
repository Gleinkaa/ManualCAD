import { DASH_LENGTHS, LINE_GROUPS, LINE_TYPES } from '../model/standards';
import type { LineTypeId, SheetDoc } from '../model/types';
import type { StrokeStyle } from './types';

export const BLACK = '#000000';

/** Screen colours per line type (on white paper). Print/PDF always uses black. */
export const SCREEN_COLORS: Record<LineTypeId, string> = {
  visible: '#000000',
  thin: '#34466b',
  hidden: '#8a5a2b',
  center: '#9b2f3f',
  phantom: '#6b4f96',
  construction: '#7fb4e6',
};

export function strokeStyle(doc: SheetDoc, lineType: LineTypeId, screenColors: boolean): StrokeStyle {
  const def = LINE_TYPES[lineType];
  const width = LINE_GROUPS[doc.lineGroup][def.weight];
  return {
    width,
    dash: def.pattern.map((el) => DASH_LENGTHS[el] * width),
    dashOffset: 0,
    color: screenColors ? SCREEN_COLORS[lineType] : BLACK,
  };
}

/**
 * Stretch/shrink the pattern so `lengthMm` holds n whole periods plus one closing dash (open curves),
 * or exactly n periods (closed curves, the seam falls inside a dash). Too short for that → continuous.
 */
export function fitPattern(style: StrokeStyle, lengthMm: number, closed: boolean): StrokeStyle {
  if (style.dash.length === 0) return style;
  const period = style.dash.reduce((s, d) => s + d, 0);
  const first = style.dash[0];
  const tail = closed ? 0 : first;
  const n = Math.round((lengthMm - tail) / period);
  // Need at least one full period, and the stretch must stay moderate.
  if (n < 1 || lengthMm < period + tail * 0.75) return { ...style, dash: [], dashOffset: 0 };
  const k = lengthMm / (n * period + tail);
  return { ...style, dash: style.dash.map((d) => d * k), dashOffset: 0 };
}
