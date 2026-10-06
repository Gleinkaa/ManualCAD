// Norm rules as data. Each entry names its source standard.
import type { LineGroupId, LineTypeId, Orientation, SheetFormat } from './types';

export interface NormRule {
  id: string;
  source: string;
  text: string;
}

/** Paper sizes per ISO 216, in mm, portrait (w < h). */
export const SHEET_SIZES: Record<SheetFormat, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
};

export function sheetSize(format: SheetFormat, orientation: Orientation): { w: number; h: number } {
  const s = SHEET_SIZES[format];
  return orientation === 'portrait' ? { w: s.w, h: s.h } : { w: s.h, h: s.w };
}

/** Line widths and text heights per line group (ISO 128-2 / ISO 129-1). */
export const LINE_GROUPS: Record<LineGroupId, { wide: number; narrow: number; dimText: number }> = {
  '0.5': { wide: 0.5, narrow: 0.25, dimText: 3.5 },
  '0.7': { wide: 0.7, narrow: 0.35, dimText: 5 },
};

export type DashElement = 'dash' | 'gap' | 'longDash' | 'dot';

export interface LineTypeDef {
  id: LineTypeId;
  label: string;
  isoNo: string | null;
  weight: 'wide' | 'narrow';
  /** Repeating pattern; empty = continuous. Lengths come from DASH_LENGTHS × line width. */
  pattern: DashElement[];
  plotted: boolean;
}

export const LINE_TYPES: Record<LineTypeId, LineTypeDef> = {
  visible: { id: 'visible', label: 'Visible edge', isoNo: '01.2', weight: 'wide', pattern: [], plotted: true },
  thin: { id: 'thin', label: 'Thin continuous', isoNo: '01.1', weight: 'narrow', pattern: [], plotted: true },
  hidden: { id: 'hidden', label: 'Hidden edge', isoNo: '02.1', weight: 'narrow', pattern: ['dash', 'gap'], plotted: true },
  center: { id: 'center', label: 'Centre line', isoNo: '04.1', weight: 'narrow', pattern: ['longDash', 'gap', 'dot', 'gap'], plotted: true },
  phantom: { id: 'phantom', label: 'Phantom', isoNo: '05.1', weight: 'narrow', pattern: ['longDash', 'gap', 'dot', 'gap', 'dot', 'gap'], plotted: true },
  construction: { id: 'construction', label: 'Construction', isoNo: null, weight: 'narrow', pattern: [], plotted: false },
};

/** Line element lengths as multiples of the line width d (ISO 128-2, table of line elements). */
export const DASH_LENGTHS: Record<DashElement, number> = {
  dot: 0.5,
  gap: 3,
  dash: 12,
  longDash: 24,
};

/** Standard scales per ISO 5455. */
export const STANDARD_SCALES: number[] = [50, 20, 10, 5, 2, 1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100];

export function formatScale(s: number): string {
  return s >= 1 ? `${round(s)}:1` : `1:${round(1 / s)}`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export const NORM_RULES: NormRule[] = [
  { id: 'LT-WIDTH', source: 'ISO 128-2', text: 'Line widths follow the chosen line group; wide:narrow = 2:1.' },
  { id: 'LT-CENTER', source: 'ISO 128-2', text: 'Centre lines are narrow long-dashed dotted lines and start and end with a long dash.' },
  { id: 'DIM-TEXT-ABOVE', source: 'ISO 129-1', text: 'Dimension values stand above the dimension line, readable from the bottom or right.' },
  { id: 'DIM-UNITS', source: 'ISO 129-1', text: 'Lengths are in mm without unit symbol.' },
  { id: 'SHEET-FRAME', source: 'ISO 5457', text: 'Drawing frame with 20 mm filing margin on the left and 10 mm elsewhere.' },
  { id: 'TB-POSITION', source: 'ISO 7200', text: 'The title block sits in the bottom-right corner of the drawing area.' },
];
