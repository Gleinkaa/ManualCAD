import { describe, expect, it } from 'vitest';
import { measure } from '../dim';
import { rotateAnnotation, scaleAnnotation } from '../model/annot';
import { newSheet, resolveAnchor, toSheet } from '../model/doc';
import type { Hatch, LinearDimension, SheetDoc } from '../model/types';
import { COMMANDS } from './commands';
import { rotate, scaleCmd } from './commands/modify';
import { CommandContext, defaultSettings } from './commands/types';
import { CommandRunner } from './runner';
import { pickEntity } from './selection';

// The registry entries belong to commands/index.ts; register here so the tests run whether or not it lists them yet.
COMMANDS.ROTATE ??= rotate;
COMMANDS.SCALE ??= scaleCmd;

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
  return { doc, ctx, runner, type, click, log };
}

const lin = (id: string, entityId: string, offset: number): LinearDimension => ({
  kind: 'linear', id, viewId: 'v-front', layer: '0',
  a: { ref: { entityId, point: 'start' }, fallback: { x: 0, y: 0 } },
  b: { ref: { entityId, point: 'end' }, fallback: { x: 0, y: 0 } },
  orientation: 'horizontal', offset, text: { override: null, prefix: '', suffix: '' },
});

const hatchOf = (doc: SheetDoc): Hatch => {
  const h = doc.annotations.find((a): a is Hatch => a.kind === 'hatch');
  if (!h) throw new Error('no hatch');
  return h;
};

function bbox(h: Hatch) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of h.loops.flat()) {
    if (c.kind !== 'line') throw new Error('line loops expected');
    xs.push(c.a.x, c.b.x);
    ys.push(c.a.y, c.b.y);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('ROTATE', () => {
  it('rotates a line 90° about a typed base point', () => {
    const { doc, runner, type } = setup();
    type('L', '10,0', '20,0', '');
    runner.start('ROTATE', [doc.entities[0].id]);
    expect(runner.prompt).toBe('Specify base point:');
    type('10,0');
    expect(runner.prompt).toBe('Specify rotation angle or [Copy/Reference]:');
    type('90');
    expect(runner.active).toBe(false);
    const g = doc.entities[0].geom;
    if (g.kind !== 'line') throw new Error('line');
    expect(g.a.x).toBeCloseTo(10);
    expect(g.a.y).toBeCloseTo(0);
    expect(g.b.x).toBeCloseTo(10);
    expect(g.b.y).toBeCloseTo(10);
    expect(doc.entities).toHaveLength(1);
  });

  it('takes the angle from a picked point and re-prompts on the base point itself', () => {
    const { doc, runner, type, click, log } = setup();
    type('L', '0,0', '10,0', '');
    runner.start('ROTATE', [doc.entities[0].id]);
    type('0,0');
    click(0, 0);
    expect(runner.active).toBe(true);
    expect(log.at(-1)).toMatch(/other than the base point/);
    click(0, 5);
    expect(runner.active).toBe(false);
    const g = doc.entities[0].geom;
    expect(g.kind === 'line' && g.b.x).toBeCloseTo(0);
    expect(g.kind === 'line' && g.b.y).toBeCloseTo(10);
  });

  it('Copy keeps the source and remaps a copied dimension onto the copy', () => {
    const { doc, runner, type } = setup();
    type('L', '0,0', '40,0', '');
    const src = doc.entities[0];
    doc.dimensions.push(lin('d1', src.id, -10));
    runner.start('ROTATE', [src.id, 'd1']);
    type('0,0', 'C', '90');
    expect(runner.active).toBe(false);
    expect(doc.entities).toHaveLength(2);
    expect(doc.dimensions).toHaveLength(2);
    expect(doc.entities[0].geom).toEqual({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } });
    const cp = doc.dimensions[1];
    if (cp.kind !== 'linear') throw new Error('linear');
    expect(cp.a.ref?.entityId).toBe(doc.entities[1].id);
    expect(cp.orientation).toBe('horizontal');
    expect(resolveAnchor(doc, cp.b).y).toBeCloseTo(40);
    expect(doc.dimensions[0]).toMatchObject({ a: { ref: { entityId: src.id } } });
  });

  it('Reference mode rotates by new − reference', () => {
    const { doc, runner, type } = setup();
    type('L', '0,0', '10,0', '');
    runner.start('ROTATE', [doc.entities[0].id]);
    type('0,0', 'R');
    expect(runner.prompt).toBe('Specify the reference angle <0.0000>:');
    type('30');
    expect(runner.prompt).toBe('Specify the new angle:');
    type('90');
    expect(runner.active).toBe(false);
    const g = doc.entities[0].geom;
    expect(g.kind === 'line' && g.b.x).toBeCloseTo(5);
    expect(g.kind === 'line' && g.b.y).toBeCloseTo(10 * Math.sin(Math.PI / 3));
  });

  it('keeps an arc counter-clockwise', () => {
    const { doc, runner, type, ctx } = setup();
    const arc = ctx.addEntity({ kind: 'arc', c: { x: 0, y: 0 }, r: 10, start: 0, end: Math.PI / 2 });
    runner.start('ROTATE', [arc.id]);
    type('0,0', '90');
    const g = doc.entities[0].geom;
    if (g.kind !== 'arc') throw new Error('arc');
    expect(g.start).toBeCloseTo(Math.PI / 2);
    expect(g.end).toBeCloseTo(Math.PI);
    expect(((g.end - g.start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)).toBeCloseTo(Math.PI / 2);
  });

  it('turns a text note with its insertion point', () => {
    const { doc, runner, type } = setup();
    type('DT', '10,0', '3.5', '0', 'X', '');
    runner.start('ROTATE', [doc.annotations[0].id]);
    type('0,0', '90');
    const t = doc.annotations[0];
    if (t.kind !== 'text') throw new Error('text');
    expect(t.pos.x).toBeCloseTo(0);
    expect(t.pos.y).toBeCloseTo(10);
    expect(t.angle).toBeCloseTo(Math.PI / 2);
    expect(t.height).toBe(3.5);
  });

  it('rotates hatch loops and the seed while the hatch angle stays at 45°', () => {
    const square: Hatch = {
      kind: 'hatch', id: 'h', viewId: 'v-front', layer: '0', angle: 45, spacing: 2.5,
      loops: [[
        { kind: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } },
        { kind: 'line', a: { x: 40, y: 0 }, b: { x: 40, y: 20 } },
        { kind: 'line', a: { x: 40, y: 20 }, b: { x: 0, y: 20 } },
        { kind: 'line', a: { x: 0, y: 20 }, b: { x: 0, y: 0 } },
      ]],
      assoc: { seed: { x: 5, y: 5 }, boundary: [], key: '' },
    };
    const r = rotateAnnotation(square, { x: 0, y: 0 }, Math.PI / 2);
    if (r.kind !== 'hatch') throw new Error('hatch');
    expect(r.angle).toBe(45);
    expect(r.spacing).toBe(2.5);
    const b = bbox(r);
    expect(b.minX).toBeCloseTo(-20);
    expect(b.maxX).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(40);
    expect(r.assoc?.seed.x).toBeCloseTo(-5);
    expect(r.assoc?.seed.y).toBeCloseTo(5);
    expect(square.loops[0][0]).toEqual({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } });

    // through the command, with its boundary: the hatch stays associative and is found again in the rotated rectangle
    const { doc, runner, type, log } = setup();
    type('REC', '0,0', '40,20');
    type('H', '5,5', '');
    runner.start('ROTATE', [...doc.entities.map((e) => e.id), hatchOf(doc).id]);
    type('0,0', '90');
    expect(runner.active).toBe(false);
    const h = hatchOf(doc);
    expect(h.angle).toBe(45);
    expect(h.assoc).toBeDefined();
    expect(bbox(h)).toEqual({ minX: expect.closeTo(-20), maxX: expect.closeTo(0), minY: expect.closeTo(0), maxY: expect.closeTo(40) });
    expect(log.some((l) => /lost their boundary/.test(l))).toBe(false);
  });

  it('turns a selected radius dimension with its circle and freezes anchors on unselected objects', () => {
    const { doc, runner, type } = setup();
    type('C', '20,0', '5');
    type('L', '0,0', '40,0', '');
    const circle = doc.entities[0];
    const line = doc.entities[1];
    doc.dimensions.push({ kind: 'radius', id: 'r1', viewId: 'v-front', layer: '0', entityId: circle.id, angle: 0, leader: 0, text: { override: null, prefix: '', suffix: '' } });
    doc.dimensions.push(lin('d1', line.id, -10));
    runner.start('ROTATE', [circle.id, 'r1', 'd1']);     // the line stays put
    type('0,0', '90');
    const r1 = doc.dimensions[0];
    const d1 = doc.dimensions[1];
    if (r1.kind !== 'radius' || d1.kind !== 'linear') throw new Error('kinds');
    expect(r1.angle).toBeCloseTo(Math.PI / 2);
    expect(circle.geom).toMatchObject({ c: { x: expect.closeTo(0), y: expect.closeTo(20) } });
    expect(d1.a.ref).toBeNull();
    expect(d1.b.ref).toBeNull();
    expect(d1.b.fallback.x).toBeCloseTo(0);
    expect(d1.b.fallback.y).toBeCloseTo(40);
    expect(d1.orientation).toBe('horizontal');
    expect(d1.offset).toBe(-10);
  });
});

describe('SCALE', () => {
  it('doubles a circle about a base point from a typed factor', () => {
    const { doc, runner, type } = setup();
    type('C', '10,10', '5');
    runner.start('SCALE', [doc.entities[0].id]);
    type('0,0');
    expect(runner.prompt).toBe('Specify scale factor or [Copy/Reference]:');
    type('2');
    expect(runner.active).toBe(false);
    expect(doc.entities[0].geom).toEqual({ kind: 'circle', c: { x: 20, y: 20 }, r: 10 });
  });

  it('takes the factor as the distance from the base point to a picked point, rejects 0 and negatives', () => {
    const { doc, runner, type, click, log } = setup();
    type('C', '10,10', '5');
    runner.start('SCALE', [doc.entities[0].id]);
    type('0,0', '-1');
    expect(runner.active).toBe(true);
    expect(log.at(-1)).toMatch(/positive/);
    click(0, 0);
    expect(runner.active).toBe(true);
    click(0, 3);
    expect(runner.active).toBe(false);
    expect(doc.entities[0].geom).toEqual({ kind: 'circle', c: { x: 30, y: 30 }, r: 15 });
  });

  it('Reference mode: factor = new length / reference length, new length also from a point', () => {
    const { doc, runner, type, click } = setup();
    type('L', '0,0', '40,0', '');
    runner.start('SCALE', [doc.entities[0].id]);
    type('0,0', 'R');
    expect(runner.prompt).toBe('Specify reference length <1.0000>:');
    type('40');
    expect(runner.prompt).toBe('Specify new length:');
    type('10');
    expect(doc.entities[0].geom).toEqual({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
    runner.start('SCALE', [doc.entities[0].id]);
    type('0,0', 'R', '10');
    click(0, 25);
    expect(doc.entities[0].geom).toEqual({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 25, y: 0 } });
  });

  it('leaves text height and hatch spacing alone (paper mm)', () => {
    const { doc, runner, type } = setup();
    type('REC', '0,0', '40,20');
    type('H', '5,5', '');
    type('DT', '10,10', '5', '0', 'X', '');
    const h0 = hatchOf(doc);
    const s = scaleAnnotation(h0, { x: 0, y: 0 }, 2);
    if (s.kind !== 'hatch') throw new Error('hatch');
    expect(s.spacing).toBe(h0.spacing);
    expect(bbox(s).maxX).toBeCloseTo(80);
    expect(s.assoc?.seed).toEqual({ x: 10, y: 10 });

    runner.start('SCALE', [...doc.entities.map((e) => e.id), ...doc.annotations.map((a) => a.id)]);
    type('0,0', '2');
    expect(runner.active).toBe(false);
    const h = hatchOf(doc);
    expect(h.spacing).toBe(h0.spacing);
    expect(h.assoc).toBeDefined();
    expect(bbox(h)).toEqual({ minX: expect.closeTo(0), maxX: expect.closeTo(80), minY: expect.closeTo(0), maxY: expect.closeTo(40) });
    const t = doc.annotations.find((a) => a.kind === 'text');
    expect(t).toMatchObject({ pos: { x: 20, y: 20 }, height: 5 });
  });

  it('a dimension anchored on a scaled line follows it; sheet-mm offset stays', () => {
    const { doc, runner, type } = setup();
    type('L', '0,0', '40,0', '');
    const line = doc.entities[0];
    doc.dimensions.push(lin('d1', line.id, -15));
    runner.start('SCALE', [line.id]);        // the dimension is not selected, it follows the line
    type('0,0', '2');
    const d1 = doc.dimensions[0];
    if (d1.kind !== 'linear') throw new Error('linear');
    expect(d1.a.ref?.entityId).toBe(line.id);
    expect(resolveAnchor(doc, d1.b)).toEqual({ x: 80, y: 0 });
    expect(measure(doc, d1)).toBeCloseTo(80);
    // selected together: the anchors stay associated and the fallbacks already sit on the new endpoints
    runner.start('SCALE', [line.id, 'd1']);
    type('0,0', '0.5');
    expect(d1.b.ref?.entityId).toBe(line.id);
    expect(d1.b.fallback).toEqual({ x: 40, y: 0 });
    expect(measure(doc, d1)).toBeCloseTo(40);
    expect(d1.offset).toBe(-15);
  });

  it('Copy keeps the source and copies the dimension with it', () => {
    const { doc, runner, type } = setup();
    type('L', '0,0', '40,0', '');
    doc.dimensions.push(lin('d1', doc.entities[0].id, -15));
    runner.start('SCALE', [doc.entities[0].id, 'd1']);
    type('0,0', 'C', '2');
    expect(runner.active).toBe(false);
    expect(doc.entities).toHaveLength(2);
    expect(doc.dimensions).toHaveLength(2);
    expect(doc.entities[0].geom).toEqual({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } });
    expect(doc.entities[1].geom).toEqual({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 80, y: 0 } });
    expect(measure(doc, doc.dimensions[1])).toBeCloseTo(80);
    expect(doc.dimensions[1].kind === 'linear' && doc.dimensions[1].a.ref?.entityId).toBe(doc.entities[1].id);
  });
});
