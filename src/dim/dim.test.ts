import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../geom/types';
import { newSheet } from '../model/doc';
import type { AngularDimension, Dimension, DimText, LinearDimension, RadialDimension, SheetDoc } from '../model/types';
import type { Primitive } from './types';
import { angularGeometry, clampToArc, dimensionText, formatValue, measure, plotDimension, readableAngle } from './index';

const noText = (): DimText => ({ override: null, prefix: '', suffix: '' });

function sheet(scale = 2): SheetDoc {
  const doc = newSheet();
  doc.views[0] = { id: 'v', name: 'Front view', scale, origin: { x: 100, y: 100 }, link: null };
  doc.entities.push(
    { id: 'c', viewId: 'v', layer: '0', lineType: 'visible', geom: { kind: 'circle', c: { x: 0, y: 0 }, r: 10 } },
    { id: 'small', viewId: 'v', layer: '0', lineType: 'visible', geom: { kind: 'circle', c: { x: 50, y: 0 }, r: 1 } },
    { id: 'arc', viewId: 'v', layer: '0', lineType: 'visible', geom: { kind: 'arc', c: { x: 0, y: 0 }, r: 10, start: 0, end: Math.PI / 2 } },
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

describe('associativity', () => {
  it('follows the endpoints of a line entity and refreshes the fallbacks', () => {
    const doc = sheet(2);
    doc.entities.push({ id: 'edge', viewId: 'v', layer: '0', lineType: 'visible', geom: { kind: 'line', a: { x: 0, y: 0 }, b: { x: 25, y: 0 } } });
    const d = linear({ x: 0, y: 0 }, { x: 0, y: 0 }, 'horizontal', 10);
    d.a.ref = { entityId: 'edge', point: 'start' };
    d.b.ref = { entityId: 'edge', point: 'end' };
    expect(measure(doc, d)).toBe(25);
    expect(dimensionText(doc, d)).toBe('25');

    const edge = doc.entities.find((e) => e.id === 'edge')!;
    edge.geom = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 32.5, y: 0 } };
    expect(measure(doc, d)).toBe(32.5);
    const dl = of(plotDimension(doc, d), 'polyline')[2];
    close(dl.points[1], { x: 165, y: 110 });
    expect(d.b.fallback).toEqual({ x: 32.5, y: 0 });

    doc.entities = doc.entities.filter((e) => e.id !== 'edge');
    expect(measure(doc, d)).toBe(32.5); // falls back to the last resolved points
    expect(d.b.ref).toBeNull();
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
    const [t] = of(prims, 'text');
    expect(t.text).toBe('⌀20');
    // off the centre cross: centred between centre (100) and the right arrow base (117.5)
    expect(t.pos.x).toBeCloseTo(108.75);
  });

  it('radius on an arc: angle outside the arc snaps to the nearer end', () => {
    const arc = { kind: 'arc' as const, c: { x: 0, y: 0 }, r: 1, start: 0, end: Math.PI / 2 };
    expect(clampToArc(Math.PI / 4, arc)).toBeCloseTo(Math.PI / 4);
    expect(clampToArc(Math.PI, arc)).toBeCloseTo(Math.PI / 2);
    expect(clampToArc(-0.1, arc)).toBeCloseTo(0);
    const wrap = { ...arc, start: 1.5 * Math.PI, end: 0.5 * Math.PI };
    expect(clampToArc(0.2, wrap)).toBeCloseTo(0.2);

    const prims = plotDimension(sheet(2), radial('radius', 'arc', Math.PI));
    const [a] = of(prims, 'fill');
    close(a.points[0], { x: 100, y: 120 }); // arc end at 90°, radius 20 on the sheet
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

describe('angular', () => {
  // Two lines meeting at the view origin: along +x and at 30°. Scale 1, origin (100,100).
  function angularSheet(): SheetDoc {
    const doc = sheet(1);
    const c = Math.cos(Math.PI / 6);
    const sn = Math.sin(Math.PI / 6);
    doc.entities.push(
      { id: 'h', viewId: 'v', layer: '0', lineType: 'visible', geom: { kind: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } } },
      { id: 's', viewId: 'v', layer: '0', lineType: 'visible', geom: { kind: 'line', a: { x: 0, y: 0 }, b: { x: 40 * c, y: 40 * sn } } },
    );
    return doc;
  }
  function angular(radius: number, sense1: 1 | -1 = 1, sense2: 1 | -1 = 1): AngularDimension {
    const leg = (id: string, e: Vec2) => ({ a: { ref: { entityId: id, point: 'start' as const }, fallback: { x: 0, y: 0 } }, b: { ref: { entityId: id, point: 'end' as const }, fallback: e } });
    return { kind: 'angular', id: 'a1', viewId: 'v', layer: '0', leg1: leg('h', { x: 40, y: 0 }), leg2: leg('s', { x: 1, y: 1 }), sense1, sense2, radius, text: noText() };
  }

  it('measures the sector chosen by the senses, text with degree sign', () => {
    const doc = angularSheet();
    expect(measure(doc, angular(30))).toBeCloseTo(30);
    expect(dimensionText(doc, angular(30))).toBe('30°');
    expect(measure(doc, angular(30, -1, 1))).toBeCloseTo(150);
    expect(measure(doc, angular(30, -1, -1))).toBeCloseTo(30);
    const d = angular(30);
    d.text = { override: null, prefix: '', suffix: '° ±1' };
    expect(dimensionText(doc, d)).toBe('30° ±1');
  });

  it('formats fractional degrees with a decimal comma', () => {
    const doc = angularSheet();
    const s = doc.entities.find((e) => e.id === 's')!;
    s.geom = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 10 * Math.cos((7.5 * Math.PI) / 180), y: 10 * Math.sin((7.5 * Math.PI) / 180) } };
    expect(dimensionText(doc, angular(30))).toBe('7,5°');
  });

  it('plots an arc around the vertex with two arrows and the text inside', () => {
    const doc = angularSheet();
    const prims = plotDimension(doc, angular(30));
    const arcs = of(prims, 'arc');
    expect(arcs).toHaveLength(1);
    close(arcs[0].c, { x: 100, y: 100 });
    expect(arcs[0].r).toBeCloseTo(30);
    expect(arcs[0].start).toBeCloseTo(0);
    expect(arcs[0].end).toBeCloseTo(Math.PI / 6);
    const arrows = of(prims, 'fill');
    expect(arrows).toHaveLength(2);
    close(arrows[0].points[0], { x: 130, y: 100 });
    close(arrows[1].points[0], { x: 100 + 30 * Math.cos(Math.PI / 6), y: 100 + 30 * Math.sin(Math.PI / 6) });
    const text = of(prims, 'text')[0];
    expect(text.text).toBe('30°');
    expect(text.angle).toBeCloseTo(Math.PI / 12 + Math.PI / 2 - Math.PI); // tangent at 15°, turned readable
    // the legs reach 40 mm, beyond the arc: no extension lines
    expect(of(prims, 'polyline')).toHaveLength(0);
  });

  it('draws extension lines when the arc lies beyond the legs, arrows outside when the arc is short', () => {
    const doc = angularSheet();
    const far = plotDimension(doc, angular(60));
    const ext = of(far, 'polyline');
    expect(ext).toHaveLength(2);
    close(ext[0].points[0], { x: 140, y: 100 });
    expect(ext[0].points[1].x).toBeGreaterThan(160);
    const short = plotDimension(doc, angular(8));
    const arc = of(short, 'arc')[0];
    expect(arc.start).toBeLessThan(0); // tail beyond the first arrow
    expect(of(short, 'fill')).toHaveLength(2);
  });

  it('bounds the arc and text for a small radius', () => {
    const doc = angularSheet();
    const sector = Math.PI / 6; // the 30° sector of angularSheet
    const bound = sector + 2 * Math.min(sector, Math.PI / 2) + 1e-9;
    for (const r of [8, 5, 1e-6]) {
      const prims = plotDimension(doc, angular(r));
      const arc = of(prims, 'arc')[0];
      expect(Number.isFinite(arc.start) && Number.isFinite(arc.end)).toBe(true);
      expect(arc.end - arc.start).toBeLessThanOrEqual(bound);
      const text = of(prims, 'text')[0];
      expect(Number.isFinite(text.pos.x) && Number.isFinite(text.pos.y)).toBe(true);
    }
  });

  it('vertex is the intersection of the infinite legs; parallel legs plot nothing', () => {
    const doc = angularSheet();
    const h = doc.entities.find((e) => e.id === 'h')!;
    h.geom = { kind: 'line', a: { x: 10, y: -5 }, b: { x: 40, y: -5 } };
    const g = angularGeometry(doc, angular(30))!;
    expect(g.vertex.y).toBeCloseTo(-5);
    expect(g.vertex.x).toBeCloseTo(-5 / Math.tan(Math.PI / 6));
    const s = doc.entities.find((e) => e.id === 's')!;
    s.geom = { kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
    expect(angularGeometry(doc, angular(30))).toBeNull();
    expect(plotDimension(doc, angular(30))).toEqual([]);
  });
});
