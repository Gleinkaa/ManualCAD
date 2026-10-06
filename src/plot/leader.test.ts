import { describe, expect, it } from 'vitest';
import type { Curve, Vec2 } from '../geom/types';
import { newSheet } from '../model/doc';
import type { Hatch, Leader, SheetDoc, TextNote } from '../model/types';
import { textBox } from './annot';
import { plotAnnotation, type PlotOptions } from './index';
import type { Primitive } from './types';

const print: PlotOptions = { includeConstruction: false, screenColors: false };
const p = (x: number, y: number): Vec2 => ({ x, y });
const rect = (x0: number, y0: number, x1: number, y1: number): Curve[] => [
  { kind: 'line', a: p(x0, y0), b: p(x1, y0) },
  { kind: 'line', a: p(x1, y0), b: p(x1, y1) },
  { kind: 'line', a: p(x1, y1), b: p(x0, y1) },
  { kind: 'line', a: p(x0, y1), b: p(x0, y0) },
];

const sheet = (patch: Partial<SheetDoc> = {}): SheetDoc => ({ ...newSheet(), ...patch });

const leader = (over: Partial<Leader> = {}): Leader => ({
  kind: 'leader', id: 'L1', viewId: 'v-front', layer: '0',
  points: [p(0, 0), p(20, 10)], terminator: 'dot', style: 'note', text: '', height: 3.5,
  ...over,
});

const of = <K extends Primitive['kind']>(prims: Primitive[], kind: K) => prims.filter((q): q is Extract<Primitive, { kind: K }> => q.kind === kind);
const total = (prims: Primitive[]) =>
  of(prims, 'polyline').reduce((s, q) => s + Math.hypot(q.points[1].x - q.points[0].x, q.points[1].y - q.points[0].y), 0);

describe('plotLeader terminator and line', () => {
  const doc = sheet();
  const tip = { x: 120, y: 160 }; // toSheet(v-front, (0,0))

  it('draws the leader polyline through the sheet points', () => {
    const [line] = plotAnnotation(doc, leader(), print);
    expect(line).toMatchObject({ kind: 'polyline', closed: false, points: [tip, { x: 140, y: 170 }] });
  });

  it('an arrow terminator is a 3-point filled triangle at the tip', () => {
    const prims = plotAnnotation(doc, leader({ terminator: 'arrow' }), print);
    expect(of(prims, 'polyline')).toHaveLength(1);
    const [arrow] = of(prims, 'fill');
    expect(arrow.points).toHaveLength(3);
    expect(arrow.points[0]).toEqual(tip);
  });

  it('a dot terminator is a 16-point filled circle of diameter 5 × narrow width at the tip', () => {
    const prims = plotAnnotation(doc, leader({ terminator: 'dot' }), print);
    expect(of(prims, 'polyline')).toHaveLength(1);
    const [dot] = of(prims, 'fill');
    expect(dot.points).toHaveLength(16);
    for (const q of dot.points) expect(Math.hypot(q.x - tip.x, q.y - tip.y)).toBeCloseTo((5 * 0.25) / 2);
  });

  it('a none terminator adds no fill', () => {
    const prims = plotAnnotation(doc, leader({ terminator: 'none' }), print);
    expect(of(prims, 'fill')).toHaveLength(0);
    expect(of(prims, 'polyline')).toHaveLength(1);
  });
});

describe('plotLeader note reference line', () => {
  it('goes right and left-aligns the text when the last segment goes right', () => {
    const doc = sheet();
    const prims = plotAnnotation(doc, leader({ points: [p(0, 0), p(20, 10)], text: 'Ø8' }), print);
    const polys = of(prims, 'polyline');
    expect(polys).toHaveLength(2);
    const [ref] = [polys[1]];
    const last = { x: 140, y: 170 };
    expect(ref.points[0]).toEqual(last);
    expect(ref.points[1].x).toBeGreaterThan(last.x);
    expect(ref.points[1].y).toBe(last.y);
    const [t] = of(prims, 'text');
    expect(t).toMatchObject({ text: 'Ø8', align: 'left', baseline: 'bottom', height: 3.5 });
    expect(t.pos.x).toBeGreaterThan(last.x);
    expect(t.pos.y).toBeGreaterThan(last.y);
  });

  it('goes left and right-aligns the text when the last segment goes left', () => {
    const doc = sheet();
    const prims = plotAnnotation(doc, leader({ points: [p(20, 10), p(0, 0)], text: 'Ø8' }), print);
    const polys = of(prims, 'polyline');
    expect(polys).toHaveLength(2);
    const ref = polys[1];
    const last = { x: 120, y: 160 };
    expect(ref.points[0]).toEqual(last);
    expect(ref.points[1].x).toBeLessThan(last.x);
    expect(ref.points[1].y).toBe(last.y);
    const [t] = of(prims, 'text');
    expect(t).toMatchObject({ text: 'Ø8', align: 'right', baseline: 'bottom' });
    expect(t.pos.x).toBeLessThan(last.x);
    expect(t.pos.y).toBeGreaterThan(last.y);
  });
});

describe('plotLeader item number', () => {
  it('centres text beyond the end of the leader, at twice the dimension text height', () => {
    const doc = sheet();
    const l = leader({ style: 'item', text: '2', height: 7, points: [p(0, 0), p(20, 10)] });
    const prims = plotAnnotation(doc, l, print);
    // only the leader line: an item number has no reference line
    expect(of(prims, 'polyline')).toHaveLength(1);
    const [t] = of(prims, 'text');
    expect(t).toMatchObject({ text: '2', height: 7, align: 'center', baseline: 'middle' });
    const last = { x: 140, y: 170 };
    const len = Math.hypot(20, 10);
    const u = { x: 20 / len, y: 10 / len };
    const beyond = (t.pos.x - last.x) * u.x + (t.pos.y - last.y) * u.y;
    expect(beyond).toBeGreaterThan(0.25 * 7); // at least the text gap beyond the end
    expect(t.pos.x).toBeGreaterThan(last.x);
    expect(t.pos.y).toBeGreaterThan(last.y);
  });
});

describe('plotLeader stays finite on degenerate points', () => {
  it('extends the item number along the last non-degenerate segment when the last two points coincide', () => {
    const doc = sheet();
    const l = leader({ style: 'item', text: '2', height: 7, points: [p(0, 0), p(20, 0), p(20, 0)] });
    const [t] = of(plotAnnotation(doc, l, print), 'text');
    expect(Number.isFinite(t.pos.x)).toBe(true);
    expect(Number.isFinite(t.pos.y)).toBe(true);
    expect(t.pos.x).toBeGreaterThan(140);
    expect(t.pos.y).toBeCloseTo(160);
  });

  it('omits the arrow and keeps the text finite when every point coincides', () => {
    const doc = sheet();
    const l = leader({ style: 'item', terminator: 'arrow', text: '2', height: 7, points: [p(5, 5), p(5, 5)] });
    const prims = plotAnnotation(doc, l, print);
    expect(of(prims, 'fill')).toHaveLength(0);
    const [t] = of(prims, 'text');
    expect(Number.isFinite(t.pos.x)).toBe(true);
    expect(Number.isFinite(t.pos.y)).toBe(true);
  });
});

describe('hatching is interrupted behind text (ISO 128-50)', () => {
  const note = (): TextNote => ({ kind: 'text', id: 't1', viewId: 'v-front', layer: '0', pos: p(20, 10), text: 'Ø20', height: 3.5, angle: 0, align: 'left' });
  const hatch = (): Hatch => ({ kind: 'hatch', id: 'h1', viewId: 'v-front', layer: '0', loops: [rect(0, 0, 40, 20)], angle: 45, spacing: 2 });

  /** Liang–Barsky: does the open segment a→b cross the axis-aligned box at all? */
  const crosses = (box: Vec2[], a: Vec2, b: Vec2): boolean => {
    const minX = Math.min(...box.map((v) => v.x));
    const maxX = Math.max(...box.map((v) => v.x));
    const minY = Math.min(...box.map((v) => v.y));
    const maxY = Math.max(...box.map((v) => v.y));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    const clip = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    return clip(-dx, a.x - minX) && clip(dx, maxX - a.x) && clip(-dy, a.y - minY) && clip(dy, maxY - a.y);
  };

  it('leaves the text box free and shortens the hatch', () => {
    const withNote = sheet({ annotations: [hatch(), note()] });
    const prims = plotAnnotation(withNote, hatch(), print);
    const textPrim = plotAnnotation(withNote, note(), print)[0];
    if (textPrim.kind !== 'text') throw new Error('text expected');
    const box = textBox(textPrim, 0);
    const segs = of(prims, 'polyline');
    expect(segs.length).toBeGreaterThan(0);
    // no hatch segment enters the plain (margin-0) text box: the clip margin keeps it clear
    for (const s of segs) expect(crosses(box, s.points[0], s.points[1])).toBe(false);

    // the same hatch without any text is longer and does cross the plain text box
    const without = sheet({ annotations: [hatch()] });
    const prims2 = plotAnnotation(without, hatch(), print);
    expect(of(prims2, 'polyline').some((s) => crosses(box, s.points[0], s.points[1]))).toBe(true);
    expect(total(prims2)).toBeGreaterThan(total(prims));
  });
});
