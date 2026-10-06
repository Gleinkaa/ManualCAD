import type { Vec2 } from '../geom/types';

/** Device-independent drawing primitives in SHEET mm (origin bottom-left, y up). */

export interface StrokeStyle {
  width: number;             // paper mm
  /** Dash/gap lengths in paper mm, alternating, starting with a dash. Empty = continuous. */
  dash: number[];
  /** Dash pattern offset in paper mm (renderers pass this straight through). */
  dashOffset: number;
  color: string;             // CSS color; plot output forces black
}

export type Primitive =
  | { kind: 'polyline'; points: Vec2[]; closed: boolean; style: StrokeStyle; tag?: string }
  | { kind: 'arc'; c: Vec2; r: number; start: number; end: number; style: StrokeStyle; tag?: string }
  | { kind: 'fill'; points: Vec2[]; color: string; tag?: string }
  | {
      kind: 'text';
      pos: Vec2;
      text: string;
      height: number;        // cap height in paper mm
      angle: number;         // radians, CCW
      align: 'left' | 'center' | 'right';
      baseline: 'bottom' | 'middle' | 'top';
      color: string;
      tag?: string;
    };
