// Grip editing and the HATCH gap tolerance.
import { describe, expect, it } from 'vitest';
import { newSheet, resolveAnchor, toSheet } from '../model/doc';
import type { Hatch, SheetDoc } from '../model/types';
import { bridgeGaps, diagnoseHatch } from './commands/hatch';
import { CommandContext, defaultSettings } from './commands/types';
import { applyGrip, nearestGrip, objectGrips, stretchCurve, stretchDimension } from './grips';
import { CommandRunner } from './runner';
import { pickEntity } from './selection';

function setup(doc: SheetDoc = newSheet()) {
  const log: string[] = [];
  const ctx = new CommandContext(() => doc, defaultSettings(doc), (m) => log.push(m));
  const runner = new CommandRunner(ctx, {
    pick: (p, filter) => pickEntity(doc, p, 1, filter ? (id) => filter(doc.entities.find((e) => e.id === id)!) : undefined),
    hostCommand: () => {},
    takeSelection: () => [],
    onStart: () => {},
    onEnd: () => {},
  });
  const type = (...lines: string[]) => lines.forEach((l) => runner.text(l));
  const view = doc.views[0];
  const click = (x: number, y: number) => runner.click(toSheet(view, { x, y }), null);
  return { doc, ctx, runner, type, click, log, view };
}

describe('grips', () => {
  it('a line has two ends and a midpoint, a circle a centre and four quadrants, an arc ends, midpoint and centre', () => {
    const { doc, type, view } = setup();
    doc.views[0].scale = 2;
    type('L', '0,0', '10,0', '', 'C', '20,0', '5', 'A', 'C', '40,0', '45,0', '40,5');
    const [l, c, a] = doc.entities.map((e) => e.id);
    expect(objectGrips(doc, l).map((g) => [g.kind, g.p])).toEqual([
      ['end', toSheet(view, { x: 0, y: 0 })],
      ['end', toSheet(view, { x: 10, y: 0 })],
      ['mid', toSheet(view, { x: 5, y: 0 })],
    ]);
    expect(objectGrips(doc, c).map((g) => g.kind)).toEqual(['center', 'quad', 'quad', 'quad', 'quad']);
    expect(objectGrips(doc, a).map((g) => g.kind)).toEqual(['end', 'end', 'mid', 'center']);
    expect(objectGrips(doc, 'nope')).toEqual([]);
  });

  it('stretches: an endpoint alone, a midpoint moves the line, a quadrant resizes, an arc end changes its angle', () => {
    const line = { kind: 'line' as const, a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
    expect(stretchCurve(line, { kind: 'end', index: 1 }, { x: 10, y: 5 })).toEqual({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 5 } });
    expect(stretchCurve(line, { kind: 'mid', index: 0 }, { x: 15, y: 10 })).toEqual({ kind: 'line', a: { x: 10, y: 10 }, b: { x: 20, y: 10 } });
    const circle = { kind: 'circle' as const, c: { x: 0, y: 0 }, r: 5 };
    expect(stretchCurve(circle, { kind: 'quad', index: 0 }, { x: 8, y: 0 })).toEqual({ kind: 'circle', c: { x: 0, y: 0 }, r: 8 });
    expect(stretchCurve(circle, { kind: 'center', index: 0 }, { x: 3, y: 3 })).toEqual({ kind: 'circle', c: { x: 3, y: 3 }, r: 5 });
    const arc = { kind: 'arc' as const, c: { x: 0, y: 0 }, r: 5, start: 0, end: Math.PI / 2 };
    const stretched = stretchCurve(arc, { kind: 'end', index: 1 }, { x: -5, y: 0 });
    expect(stretched.kind === 'arc' && stretched.end).toBeCloseTo(Math.PI);
    expect(stretched.kind === 'arc' && stretched.r).toBe(5);
    expect(stretchCurve(arc, { kind: 'mid', index: 0 }, { x: 0, y: 7 })).toMatchObject({ r: 7, start: 0 });
  });

  it('GRIPSTRETCH moves coincident grips together, keeps the hatch and the dimension on the stretched corner', () => {
    const { doc, ctx, runner, type, click, view } = setup();
    type('REC', '0,0', '40,20', 'H');
    click(20, 10);
    type('');
    const corner = toSheet(view, { x: 40, y: 0 });
    const bottom = doc.entities[0];
    type('DLI', '0,0');
    runner.click(corner, { point: corner, kind: 'endpoint', entityId: bottom.id, anchor: 'end' });
    type('20,-10');
    const grips = doc.entities.flatMap((e) => objectGrips(doc, e.id));
    const hot = grips.filter((g) => Math.hypot(g.p.x - corner.x, g.p.y - corner.y) < 1e-9);
    expect(hot).toHaveLength(2);
    expect(nearestGrip(grips, { x: corner.x + 0.3, y: corner.y }, 0.5)?.p).toEqual(corner);
    ctx.grip = { grips: hot, base: corner };
    runner.start('GRIPSTRETCH', []);
    expect(runner.prompt).toBe('Specify stretch point:');
    type('50,0');
    expect(runner.active).toBe(false);
    const ends = doc.entities.flatMap((e) => (e.geom.kind === 'line' ? [e.geom.a, e.geom.b] : []));
    expect(ends.filter((p) => p.x === 50 && p.y === 0)).toHaveLength(2);
    expect(ends.some((p) => p.x === 40 && p.y === 0)).toBe(false);
    const h = doc.annotations.find((a): a is Hatch => a.kind === 'hatch')!;
    expect(h.assoc).toBeDefined();
    expect(h.loops[0].some((c) => c.kind === 'line' && (c.a.x === 50 || c.b.x === 50))).toBe(true);
    const dim = doc.dimensions[0];
    expect(dim.kind === 'linear' && resolveAnchor(doc, dim.b)).toEqual({ x: 50, y: 0 });
    expect(runner.lastCommand).toBe('DIMLINEAR');
  });

  it('GRIPSTRETCH without a grip just explains itself, and a text grip moves the note', () => {
    const { doc, ctx, runner, type, log } = setup();
    runner.start('GRIPSTRETCH', []);
    expect(runner.active).toBe(false);
    expect(log.at(-1)).toMatch(/Click a grip/);
    type('DT', '10,10', '', '', 'A', '');
    const id = doc.annotations[0].id;
    const g = objectGrips(doc, id);
    expect(g).toHaveLength(1);
    expect(applyGrip(doc, g[0], { x: 3, y: 4 })).toBe(true);
    expect(doc.annotations[0]).toMatchObject({ pos: { x: 3, y: 4 } });
    expect(applyGrip(doc, { ...g[0], id: 'gone' }, { x: 0, y: 0 })).toBe(false);
    void ctx;
  });
});

describe('HATCH gap tolerance', () => {
  it('bridges open ends within the tolerance, nearest pairs first', () => {
    const ends = [{ x: 0, y: 0 }, { x: 0, y: 0.4 }, { x: 10, y: 0 }, { x: 10, y: 3 }];
    expect(bridgeGaps(ends, 0.5)).toEqual([{ kind: 'line', a: { x: 0, y: 0 }, b: { x: 0, y: 0.4 } }]);
    expect(bridgeGaps(ends, 5)).toHaveLength(2);
    expect(bridgeGaps(ends, 0)).toEqual([]);
  });

  it('with Gap set, a nearly closed outline hatches and the hatch stays associative with that tolerance', () => {
    const { doc, ctx, runner, type, click, log } = setup();
    type('L', '0,0', '40,0', '40,20', '0,20', '0,0.3', '');
    type('H');
    click(20, 10);
    expect(doc.annotations).toHaveLength(0);
    expect(log.at(-1)).toMatch(/smallest 0\.30 mm.*Gap tolerance/);
    type('G', '0.5');
    click(20, 10);
    type('');
    const h = doc.annotations[0] as Hatch;
    expect(h.kind).toBe('hatch');
    expect(h.assoc?.gap).toBe(0.5);
    expect(log).toContain('1 gap bridged (tolerance 0.50 mm); the outline itself is still open.');
    expect(ctx.settings.hatchGap).toBe(0.5);
    // the diagnosis still reports the open ends when the tolerance is too small
    const d = diagnoseHatch(doc, doc.views[0].id, { x: 20, y: 10 });
    expect(d.reason).toBe('open');
    // stretching the corner (40,20) keeps the association: the region is found again with the same gap
    const corner = toSheet(doc.views[0], { x: 40, y: 20 });
    const hot = doc.entities.flatMap((e) => objectGrips(doc, e.id)).filter((g) => Math.hypot(g.p.x - corner.x, g.p.y - corner.y) < 1e-9);
    expect(hot).toHaveLength(2);
    ctx.grip = { grips: hot, base: corner };
    runner.start('GRIPSTRETCH', []);
    type('45,25');
    expect(h.assoc?.gap).toBe(0.5);
    expect(h.loops[0].some((c) => c.kind === 'line' && (c.a.x === 45 || c.b.x === 45))).toBe(true);
  });
});

describe('dimension grips', () => {
  it('a linear dimension: two measured points and the dimension line; dragging the line changes the offset, an anchor detaches', () => {
    const { doc, type, view } = setup();
    type('REC', '0,0', '40,20');
    const bottom = doc.entities[0];
    type('DLI', '0,0');
    const corner = toSheet(view, { x: 40, y: 0 });
    doc.dimensions.length;
    const runner2 = setup(doc);
    void runner2;
    // snapped second point so the anchor is associative
    const ctx = new CommandContext(() => doc, defaultSettings(doc), () => {});
    void ctx;
    const r = new CommandRunner(new CommandContext(() => doc, defaultSettings(doc), () => {}), { pick: () => null, hostCommand: () => {}, takeSelection: () => [], onStart: () => {}, onEnd: () => {} });
    r.start('DIMLINEAR');
    r.text('0,0');
    r.click(corner, { point: corner, kind: 'endpoint', entityId: bottom.id, anchor: 'end' });
    r.text('20,-10');
    const dim = doc.dimensions[0];
    const g = objectGrips(doc, dim.id);
    expect(g.map((x) => x.kind)).toEqual(['anchor', 'anchor', 'dimline']);
    expect(g[2].p).toEqual(toSheet(view, { x: 20, y: -10 }));
    const moved = stretchDimension(doc, dim, g[2], toSheet(view, { x: 5, y: -15 }));
    expect(moved.kind === 'linear' && moved.offset).toBeCloseTo(-15);
    expect(dim.kind === 'linear' && dim.offset).toBeCloseTo(-10);
    expect(applyGrip(doc, g[1], { x: 45, y: 0 })).toBe(true);
    const after = doc.dimensions[0];
    expect(after.kind === 'linear' && after.b.ref).toBeNull();
    expect(after.kind === 'linear' && after.b.fallback).toEqual({ x: 45, y: 0 });
  });

  it('radius and angular dimensions: one grip on the dimension line that sets angle/leader or the arc radius', () => {
    const { doc, type, view } = setup();
    type('C', '0,0', '10');
    const r = setup(doc).runner;
    r.start('DIMRADIUS');
    r.click(toSheet(view, { x: 10, y: 0 }), null);
    r.text('20,0');
    const rad = doc.dimensions[0];
    const g = objectGrips(doc, rad.id);
    expect(g).toHaveLength(1);
    expect(g[0].p).toEqual(toSheet(view, { x: 20, y: 0 }));
    const moved = stretchDimension(doc, rad, g[0], toSheet(view, { x: 0, y: 25 }));
    expect(moved.kind === 'radius' && moved.angle).toBeCloseTo(Math.PI / 2);
    expect(moved.kind === 'radius' && moved.leader).toBeCloseTo(15);
    type('L', '0,0', '30,0', '', 'L', '0,0', '0,30', '');
    const [l1, l2] = doc.entities.slice(-2);
    const r2 = setup(doc).runner;
    r2.start('DIMANGULAR');
    r2.click(toSheet(view, { x: 15, y: 0 }), null);
    r2.click(toSheet(view, { x: 0, y: 15 }), null);
    r2.text('12,12');
    void l1;
    void l2;
    const ang = doc.dimensions[1];
    const ga = objectGrips(doc, ang.id);
    expect(ga).toHaveLength(1);
    expect(ga[0].p.x).toBeCloseTo(toSheet(view, { x: 12, y: 12 }).x, 0);
    const bigger = stretchDimension(doc, ang, ga[0], toSheet(view, { x: 20, y: 20 }));
    expect(bigger.kind === 'angular' && bigger.radius).toBeCloseTo(Math.hypot(20, 20));
  });
});

describe('collected grips', () => {
  it('grips collected with Shift move by the displacement, keeping their spacing', () => {
    const { doc, ctx, runner, type, view } = setup();
    type('L', '0,0', '0,30', '');
    const [g0, g1] = objectGrips(doc, doc.entities[0].id);
    ctx.grip = { grips: [g0, g1], base: g1.p };
    runner.start('GRIPSTRETCH', []);
    type('10,30');
    expect(doc.entities[0].geom).toEqual({ kind: 'line', a: { x: 10, y: 0 }, b: { x: 10, y: 30 } });
    void view;
  });
});

describe('STRETCH', () => {
  it('moves the ends inside the crossing window, whole objects when fully inside, and reports the count', () => {
    const { doc, type, log } = setup();
    type('REC', '0,0', '40,20', 'C', '50,10', '3', 'DT', '45,25', '', '', 'N', '');
    type('S', '30,-5', '60,30', '0,0', '10,0');
    expect(log).toContain('6 points to stretch.');
    const lines = doc.entities.filter((e) => e.geom.kind === 'line').map((e) => e.geom);
    const xs = lines.flatMap((l) => (l.kind === 'line' ? [l.a.x, l.b.x] : []));
    expect(xs.filter((x) => x === 50)).toHaveLength(4);
    expect(xs.filter((x) => x === 0)).toHaveLength(4);
    const circle = doc.entities.find((e) => e.geom.kind === 'circle')!.geom;
    expect(circle.kind === 'circle' && circle.c).toEqual({ x: 60, y: 10 });
    expect(doc.annotations[0]).toMatchObject({ pos: { x: 55, y: 25 } });
    type('S', '100,100', '110,110');
    expect(log.at(-1)).toBe('Nothing to stretch inside the window.');
  });
});
