import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../geom/types';
import { newSheet } from '../model/doc';
import type { Dimension, DimText, LinearDimension, RadialDimension, SheetDoc } from '../model/types';
import type { Primitive } from '../plot/types';
import { dimensionText, formatValue, measure, plotDimension, readableAngle } from './index';

const noText = (): DimText => ({ override: null, prefix: '', suffix: '' });

function sheet(scale = 2): SheetDoc {
  const doc = newSheet();
  doc.views[0] = { id: 'v', name: 'Front view', scale, origin: { x: 100, y: 100 }, link: null };
  doc.entities.push(
    { id: 'c', viewId: 'v', layer: '0', lineType: 'visible', geom: { kind: 'circle', c: { x: 0, y: 0 }, r: 10 } },
    { id: 'small', viewId: 'v', layer: '0', lineType: 'visible', geom: { kind: 'circle', c: { x: 50, y: 0 }, r: 1 } },
    { id: 'l', viewId: 'v', layer: '0', lineType: 'visible', geom: { kind: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } } },
  );
  return doc;
}

function linear(a: Vec2, b: Vec2, orientation: LinearDimension['orientation'], offset: number): LinearDimension {
  return {
    kind: 'linear', id: 'd1', viewId: 'v', layer: '0',
    a: { ref: null, fallback: a }, b: { ref: null, fallback: b },
    orientation, offset, text: noText(),
  };
}

function radial(kind: 'radius' | 'diameter', entityId: string, angle: number, leader = 0): RadialDimension {
  return { kind, id: 'r1', viewId: 'v', layer: '0', entityId, angle, leader, text: noText() };
}

const of = <K extends Primitive['kind']>(prims: Primitive[], kind: K) =>
  prims.filter((p): p is Extract<Primitive, { kind: K }> => p.kind === kind);

const close = (p: Vec2, q: Vec2) => {
  expect(p.x).toBeCloseTo(q.x, 6);
  expect(p.y).toBeCloseTo(q.y, 6);
};

describe('formatValue', () => {
  it('uses a decimal comma and trims trailing zeros', () => {
    expect(formatValue(12.5)).toBe('12,5');
    expect(formatValue(40)).toBe('40');
    expect(formatValue(100)).toBe('100');
    expect(formatValue(0.25)).toBe('0,25');
  });
  it('rounds to at most 3 decimals', () => {
    expect(formatValue(1 / 3)).toBe('0,333');
    expect(formatValue(2.9999)).toBe('3');
    expect(formatValue(-0.0001)).toBe('0');
  });
});

describe('dimensionText', () => {
  it('prefixes R and ⌀ automatically unless the prefix has one', () => {
    const doc = sheet();
    expect(dimensionText(doc, radial('radius', 'c', 0))).toBe('R10');
    expect(dimensionText(doc, radial('diameter', 'c', 0))).toBe('⌀20');
    const sr = radial('radius', 'c', 0);
    sr.text.prefix = 'SR';
    expect(dimensionText(doc, sr)).toBe('SR10');
    const dia = radial('diameter', 'c', 0);
    dia.text = { override: null, prefix: '2x ⌀', suffix: ' H7' };
    expect(dimensionText(doc, dia)).toBe('2x ⌀20 H7');
  });
  it('override replaces everything', () => {
    const d: Dimension = linear({ x: 0, y: 0 }, { x: 40, y: 0 }, 'horizontal', 10);
    d.text.override = 'M10';
    expect(dimensionText(sheet(), d)).toBe('M10');
  });
});

describe('linear', () => {
  it('horizontal at 2:1 measures real mm and places the line at the offset', () => {
    const doc = sheet(2);
    const d = linear({ x: 0, y: 0 }, { x: 40, y: 5 }, 'horizontal', 10);
    expect(measure(doc, d)).toBe(40);
    expect(dimensionText(doc, d)).toBe('40');
    const prims = plotDimension(doc, d);
    expect(prims.every((p) => p.tag === 'd1')).toBe(true);
    // sheet points (100,100) and (180,110); midpoint y 105 → dimension line at y 115
    const lines = of(prims, 'polyline');
    expect(lines).toHaveLength(3);
    close(lines[0].points[0], { x: 100, y: 100 });
    close(lines[0].points[1], { x: 100, y: 117 }); // + 2 mm overshoot
    close(lines[1].points[1], { x: 180, y: 117 });
    close(lines[2].points[0], { x: 100, y: 115 });
    close(lines[2].points[1], { x: 180, y: 115 });
    expect(lines[0].style.width).toBe(0.25);
    const arrows = of(prims, 'fill');
    expect(arrows).toHaveLength(2);
    close(arrows[0].points[0], { x: 100, y: 115 });
    expect(arrows[0].points[1].x).toBeCloseTo(102.5); // 2.5 mm arrow pointing outward
    const [t] = of(prims, 'text');
    expect(t.angle).toBe(0);
    expect(t.height).toBe(3.5);
    expect(t.pos.x).toBeCloseTo(140);
    expect(t.pos.y).toBeGreaterThan(115);
  });

  it('vertical text is readable from the right and stands left of the line', () => {
    const doc = sheet(2);
    const d = linear({ x: 0, y: 30 }, { x: 0, y: 0 }, 'vertical', 12);
    expect(measure(doc, d)).toBe(30);
    const prims = plotDimension(doc, d);
    const dl = of(prims, 'polyline')[2];
    close(dl.points[0], { x: 112, y: 100 });
    close(dl.points[1], { x: 112, y: 160 });
    const [t] = of(prims, 'text');
    expect(t.angle).toBeCloseTo(Math.PI / 2);
    expect(t.pos.x).toBeLessThan(112);
    expect(t.pos.y).toBeCloseTo(130);
  });

  it('aligned measures the true distance, offset to the left of a→b', () => {
    const doc = sheet(2);
    const d = linear({ x: 0, y: 0 }, { x: 30, y: 40 }, 'aligned', 5);
    expect(measure(doc, d)).toBe(50);
    const dl = of(plotDimension(doc, d), 'polyline')[2];
    // u = (0.6, 0.8), left normal (-0.8, 0.6)
    close(dl.points[0], { x: 96, y: 103 });
    close(dl.points[1], { x: 156, y: 183 });
    expect(readableAngle({ x: -0.6, y: -0.8 })).toBeCloseTo(Math.atan2(0.8, 0.6));
  });

  it('puts arrows outside when the space is too small, text outside when it does not fit either', () => {
    const doc = sheet(1);
    // 8 mm: text "8" (~2.45) fits, but not with two 2.5 mm arrows
    let prims = plotDimension(doc, linear({ x: 0, y: 0 }, { x: 8, y: 0 }, 'horizontal', 10));
    let [a1, a2] = of(prims, 'fill');
    expect(a1.points[1].x).toBeLessThan(100); // arrow at P1 comes from the left
    expect(a2.points[1].x).toBeGreaterThan(108);
    let [t] = of(prims, 'text');
    expect(t.pos.x).toBeCloseTo(104);

    // 3,5 mm: text (~7.4 mm) does not fit: text beside the right arrow
    prims = plotDimension(doc, linear({ x: 0, y: 0 }, { x: 3.5, y: 0 }, 'horizontal', 10));
    [a1, a2] = of(prims, 'fill');
    expect(a1.points[1].x).toBeLessThan(100);
    [t] = of(prims, 'text');
    expect(t.text).toBe('3,5');
    expect(t.pos.x).toBeGreaterThan(103.5 + 2.5);
    const dl = of(prims, 'polyline')[2];
    expect(dl.points[1].x).toBeGreaterThan(t.pos.x);
  });
});

describe('radial', () => {
  it('radius: line from the centre, one arrow touching the arc from inside', () => {
    const doc = sheet(2);
    const d = radial('radius', 'c', Math.PI / 4);
    expect(measure(doc, d)).toBe(10);
    const prims = plotDimension(doc, d);
    expect(prims.every((p) => p.tag === 'r1')).toBe(true);
    const [l] = of(prims, 'polyline');
    const P = { x: 100 + 20 * Math.SQRT1_2, y: 100 + 20 * Math.SQRT1_2 };
    close(l.points[0], { x: 100, y: 100 });
    close(l.points[1], P);
    const [a] = of(prims, 'fill');
    close(a.points[0], P);
    expect(a.points[1].x).toBeLessThan(P.x);
    const [t] = of(prims, 'text');
    expect(t.text).toBe('R10');
    expect(t.angle).toBeCloseTo(Math.PI / 4);
  });

  it('radius with leader: text outside along the extension', () => {
    const prims = plotDimension(sheet(2), radial('radius', 'c', 0, 5));
    const [t] = of(prims, 'text');
    expect(t.pos.x).toBeGreaterThan(125);
  });

  it('small radius: arrow outside pointing to the centre', () => {
    const prims = plotDimension(sheet(1), radial('radius', 'small', 0));
    const [a] = of(prims, 'fill');
    close(a.points[0], { x: 151, y: 100 });
    expect(a.points[1].x).toBeGreaterThan(151);
  });

  it('diameter: line through the centre with arrows on the circle', () => {
    const doc = sheet(2);
    const d = radial('diameter', 'c', 0);
    expect(measure(doc, d)).toBe(20);
    const prims = plotDimension(doc, d);
    const [l] = of(prims, 'polyline');
    close(l.points[0], { x: 80, y: 100 });
    close(l.points[1], { x: 120, y: 100 });
    const [a1, a2] = of(prims, 'fill');
    close(a1.points[0], { x: 80, y: 100 });
    close(a2.points[0], { x: 120, y: 100 });
    expect(of(prims, 'text')[0].text).toBe('⌀20');
  });

  it('diameter with leader: arrows outside, text outside', () => {
    const prims = plotDimension(sheet(2), radial('diameter', 'c', 0, 6));
    const [a1, a2] = of(prims, 'fill');
    expect(a1.points[1].x).toBeLessThan(80);
    expect(a2.points[1].x).toBeGreaterThan(120);
    expect(of(prims, 'text')[0].pos.x).toBeGreaterThan(126);
  });

  it('non-circular entity: no primitives, measure throws', () => {
    const d = radial('radius', 'l', 0);
    expect(plotDimension(sheet(), d)).toEqual([]);
    expect(() => measure(sheet(), d)).toThrow();
  });
});
