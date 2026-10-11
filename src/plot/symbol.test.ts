import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../geom/types';
import { newSheet } from '../model/doc';
import type { Hatch, SheetDoc, SurfaceSymbol, TaperSymbol } from '../model/types';
import { plotAnnotation, plotSheet, type PlotOptions } from './index';
import type { Primitive } from './types';

const print: PlotOptions = { includeConstruction: false, screenColors: false };
const p = (x: number, y: number): Vec2 => ({ x, y });
const ORIGIN = p(120, 160); // toSheet(v-front, (0,0)) on a new sheet

const surface = (over: Partial<SurfaceSymbol> = {}): SurfaceSymbol => ({
  kind: 'surface', id: 'S1', viewId: 'v-front', layer: '0', pos: p(0, 0), angle: 0, removal: 'any',
  fields: { roughness: '', second: '', process: '', lay: '', allowance: '' }, collective: false,
  ...over,
});
const taper = (over: Partial<TaperSymbol> = {}): TaperSymbol => ({
  kind: 'taper', id: 'T1', viewId: 'v-front', layer: '0', form: 'taper', points: [p(0, 0), p(10, 10)], ratio: '1:5', direction: { x: 1, y: 0 },
  ...over,
});

const of = <K extends Primitive['kind']>(prims: Primitive[], kind: K) => prims.filter((q): q is Extract<Primitive, { kind: K }> => q.kind === kind);
const texts = (prims: Primitive[]) => of(prims, 'text');
const rel = (q: Vec2, o = ORIGIN) => ({ x: q.x - o.x, y: q.y - o.y });

describe('surface texture symbol (ISO 21920-1)', () => {
  const doc = newSheet(); // line group 0.5: h = 3.5, narrow 0.25

  it('draws the V with legs at 60°, short leg 1.4 h, long leg 3 h, and the bar on the long leg', () => {
    const [v] = of(plotAnnotation(doc, surface(), print), 'polyline');
    const [shortTop, vertex, longTop, barEnd] = v.points.map((q) => rel(q));
    expect(vertex).toEqual({ x: 0, y: 0 });
    expect(shortTop.y).toBeCloseTo(1.4 * 3.5);
    expect(longTop.y).toBeCloseTo(3 * 3.5);
    expect(Math.atan2(longTop.y, longTop.x)).toBeCloseTo(Math.PI / 3);
    expect(Math.atan2(shortTop.y, shortTop.x)).toBeCloseTo((2 * Math.PI) / 3);
    expect(barEnd.y).toBeCloseTo(longTop.y);
    expect(barEnd.x).toBeGreaterThan(longTop.x);
    expect(v.style.width).toBe(0.25); // narrow line of the line group
  });

  it('closes the V with a bar when material removal is required, and puts a circle in it when prohibited', () => {
    const req = of(plotAnnotation(doc, surface({ removal: 'required' }), print), 'polyline');
    expect(req).toHaveLength(2);
    const bar = req[1].points.map((q) => rel(q));
    expect(bar[0].y).toBeCloseTo(1.4 * 3.5);
    expect(bar[1].y).toBeCloseTo(1.4 * 3.5);
    expect(bar[1].x).toBeCloseTo(-bar[0].x);

    const pro = plotAnnotation(doc, surface({ removal: 'prohibited' }), print);
    const [circle] = of(pro, 'arc');
    expect(circle.r).toBeCloseTo((1.4 * 3.5) / 3); // inscribed in the V
    expect(rel(circle.c).y).toBeCloseTo((2 * 1.4 * 3.5) / 3);
    expect(of(plotAnnotation(doc, surface(), print), 'arc')).toHaveLength(0);
  });

  it('places a and b under the bar, c above it, d right and e left of the V', () => {
    const fields = { roughness: 'Ra 3,2', second: 'Rz 12,5', process: 'geschliffen', lay: '=', allowance: '0,2' };
    const prims = plotAnnotation(doc, surface({ fields }), print);
    const [v] = of(prims, 'polyline');
    const barY = rel(v.points[2]).y;
    const at = (t: string) => texts(prims).find((q) => q.text === t)!;
    expect(rel(at('Ra 3,2').pos).y + 3.5).toBeLessThan(barY);
    expect(rel(at('Rz 12,5').pos).y).toBeLessThan(rel(at('Ra 3,2').pos).y - 3.5);
    expect(rel(at('geschliffen').pos).y).toBeGreaterThan(barY);
    expect(rel(at('=').pos).x).toBeGreaterThan(0);
    expect(at('0,2')).toMatchObject({ align: 'right' });
    expect(rel(at('0,2').pos).x).toBeLessThan(0);
    for (const t of texts(prims)) expect(t.height).toBe(3.5);
  });

  it('lengthens the bar to cover the longest text', () => {
    const short = of(plotAnnotation(doc, surface(), print), 'polyline')[0].points[3].x;
    const long = of(plotAnnotation(doc, surface({ fields: { roughness: 'Ra 0,8', second: '', process: 'feinstgeschliffen', lay: '', allowance: '' } }), print), 'polyline')[0].points[3].x;
    expect(long).toBeGreaterThan(short + 10);
  });

  it('sizes from the line group: 0.7 letters at 5 mm and draws 0.35 lines', () => {
    const big: SheetDoc = { ...newSheet(), lineGroup: '0.7' };
    const [v] = of(plotAnnotation(big, surface(), print), 'polyline');
    expect(rel(v.points[2]).y).toBeCloseTo(15);
    expect(v.style.width).toBe(0.35);
  });

  it('turns with its angle: at 90° the symbol stands towards −x and its texts read upwards', () => {
    const prims = plotAnnotation(doc, surface({ angle: Math.PI / 2, fields: { roughness: 'Ra 1,6', second: '', process: '', lay: '', allowance: '' } }), print);
    const longTop = rel(of(prims, 'polyline')[0].points[2]);
    expect(longTop.x).toBeCloseTo(-3 * 3.5);
    expect(texts(prims)[0].angle).toBeCloseTo(Math.PI / 2);
  });

  it('encloses a collective indication in parentheses twice the lettering height', () => {
    const prims = plotAnnotation(doc, surface({ collective: true }), print);
    expect(texts(prims).map((t) => t.text)).toEqual(['(', ')']);
    expect(texts(prims)[0].height).toBe(7);
  });

  it('never plots field texts on a collective indication, even when its fields carry values', () => {
    const fields = { roughness: 'Ra 3,2', second: 'Rz 12,5', process: 'geschliffen', lay: '=', allowance: '0,2' };
    const prims = plotAnnotation(doc, surface({ collective: true, fields }), print);
    expect(texts(prims).map((t) => t.text)).toEqual(['(', ')']);
  });

  it('interrupts hatching around its texts (HATCH-TEXT)', () => {
    const sq: Hatch = {
      kind: 'hatch', id: 'H', viewId: 'v-front', layer: '0', angle: 45, spacing: 1,
      loops: [[{ kind: 'line', a: p(-30, -30), b: p(30, -30) }, { kind: 'line', a: p(30, -30), b: p(30, 30) }, { kind: 'line', a: p(30, 30), b: p(-30, 30) }, { kind: 'line', a: p(-30, 30), b: p(-30, -30) }]],
    };
    const plain = { ...newSheet(), annotations: [sq] };
    const withSym = { ...newSheet(), annotations: [sq, surface({ fields: { roughness: 'Ra 3,2', second: '', process: '', lay: '', allowance: '' } })] };
    const count = (d: SheetDoc) => plotSheet(d, print).filter((q) => q.tag === 'annot:H').length;
    expect(count(withSym)).toBeGreaterThan(count(plain));
  });
});

describe('taper and slope symbol (ISO 3040)', () => {
  const doc = newSheet();

  it('draws the leader with an arrowhead at the tip and a reference line from the last point', () => {
    const prims = plotAnnotation(doc, taper(), print);
    const lines = of(prims, 'polyline');
    expect(lines[0].points).toEqual([ORIGIN, p(130, 170)]);
    const [arrow] = of(prims, 'fill');
    expect(arrow.points[0]).toEqual(ORIGIN);
    const ref = lines[1];
    expect(ref.points[0]).toEqual(p(130, 170));
    expect(ref.points[1].y).toBe(170);
    expect(ref.points[1].x).toBeGreaterThan(130);
  });

  it('taper: an isosceles triangle h high and 2 h long, symmetric about the reference line, ratio after it', () => {
    const prims = plotAnnotation(doc, taper(), print);
    const tri = of(prims, 'polyline').find((q) => q.closed)!.points.map((q) => rel(q, p(130, 170)));
    const xs = tri.map((q) => q.x);
    const ys = tri.map((q) => q.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(3.5);
    expect(Math.max(...ys) + Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(7);
    // direction 1: the apex (the narrow end) is on the right
    expect(tri.find((q) => Math.abs(q.y) < 1e-9)!.x).toBeCloseTo(Math.max(...xs));
    const [ratio] = texts(prims);
    expect(ratio.text).toBe('1:5');
    expect(ratio.pos.x - 130).toBeGreaterThan(Math.max(...xs));
  });

  it('points the other way with direction (−1, 0)', () => {
    const tri = of(plotAnnotation(doc, taper({ direction: { x: -1, y: 0 } }), print), 'polyline').find((q) => q.closed)!.points;
    const apex = tri.find((q) => Math.abs(q.y - 170) < 1e-9)!;
    expect(apex.x).toBeCloseTo(Math.min(...tri.map((q) => q.x)));
  });

  it('slope: a right triangle standing on the reference line', () => {
    const tri = of(plotAnnotation(doc, taper({ form: 'slope', direction: { x: 1, y: -1 } }), print), 'polyline').find((q) => q.closed)!.points.map((q) => rel(q, p(130, 170)));
    expect(Math.min(...tri.map((q) => q.y))).toBeCloseTo(0);
    expect(Math.max(...tri.map((q) => q.y))).toBeCloseTo(3.5);
    // the high end is on the left when the surface falls to the right
    const top = tri.find((q) => q.y > 1)!;
    expect(top.x).toBeCloseTo(Math.min(...tri.map((q) => q.x)));
  });

  it('slope: direction (1, −1) falls right, the mirrored direction (1, 1) falls left', () => {
    // the apex is the one base vertex that does not share its x with the high vertical side
    const apex = (direction: Vec2) => {
      const tri = of(plotAnnotation(doc, taper({ form: 'slope', direction }), print), 'polyline').find((q) => q.closed)!.points;
      const top = tri.reduce((a, b) => (b.y > a.y ? b : a));
      return tri.find((q) => Math.abs(q.y - top.y) > 1e-9 && Math.abs(q.x - top.x) > 1e-9)!;
    };
    const right = apex({ x: 1, y: -1 });
    const left = apex({ x: 1, y: 1 });
    expect(right.x).toBeGreaterThan(left.x);
  });

  it('runs the reference line to the left when the leader comes from the right, text still after the symbol', () => {
    const prims = plotAnnotation(doc, taper({ points: [p(0, 0), p(-10, 10)] }), print);
    const ref = of(prims, 'polyline')[1];
    expect(ref.points[1].x).toBeLessThan(ref.points[0].x);
    const tri = of(prims, 'polyline').find((q) => q.closed)!.points;
    expect(texts(prims)[0].pos.x).toBeGreaterThan(Math.max(...tri.map((q) => q.x)));
    expect(texts(prims)[0].pos.x).toBeLessThan(ref.points[0].x);
  });
});
