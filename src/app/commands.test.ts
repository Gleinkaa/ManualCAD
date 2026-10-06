import { describe, expect, it } from 'vitest';
import { measure } from '../dim';
import { newSheet, toSheet } from '../model/doc';
import type { SheetDoc } from '../model/types';
import { CommandContext, defaultSettings } from './commands/types';
import { CommandRunner } from './runner';
import { pickEntity } from './selection';
import { findSnap } from './snap';

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
  /** Click at a view-local point. */
  const click = (x: number, y: number) => runner.click(toSheet(view, { x, y }), null);
  return { doc, ctx, runner, type, click, log };
}

describe('LINE', () => {
  it('draws segments from typed absolute, relative and polar coordinates', () => {
    const { doc, runner, type } = setup();
    type('L', '0,0', '@40,0', '@20<90', '');
    expect(runner.active).toBe(false);
    expect(doc.entities.map((e) => e.geom)).toEqual([
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } },
      { kind: 'line', a: { x: 40, y: 0 }, b: { x: 40, y: expect.closeTo(20) } },
    ]);
    expect(doc.entities.every((e) => e.lineType === 'visible' && e.viewId === 'v-front')).toBe(true);
  });

  it('closes, undoes a segment and uses view-local mm at other scales', () => {
    const doc = newSheet();
    doc.views[0].scale = 2;
    const { runner, type } = setup(doc);
    type('LINE', '0,0', '10,0', '10,5', 'U', '10,10', 'C');
    expect(runner.active).toBe(false);
    expect(doc.entities).toHaveLength(3);
    expect(doc.entities[2].geom).toEqual({ kind: 'line', a: { x: 10, y: 10 }, b: { x: 0, y: 0 } });
  });

  it('direct distance follows the cursor direction', () => {
    const { doc, runner, type } = setup();
    type('L', '0,0');
    runner.cursor = toSheet(doc.views[0], { x: 0, y: 50 });
    type('25', '');
    const g = doc.entities[0].geom;
    expect(g.kind === 'line' && g.b.y).toBeCloseTo(25);
  });

  it('Enter on an empty command line repeats the last command', () => {
    const { runner, type } = setup();
    type('L', '0,0', '1,1', '');
    type('');
    expect(runner.name).toBe('LINE');
  });

  it('rejects invalid input without leaving the prompt', () => {
    const { runner, type, log } = setup();
    type('L', 'foo');
    expect(runner.prompt).toBe('Specify first point:');
    expect(log.at(-1)).toMatch(/Invalid point/);
  });
});

describe('CIRCLE', () => {
  it('center-radius, Diameter option and 2P', () => {
    const { doc, type } = setup();
    type('C', '10,10', '5');
    type('CIRCLE', '0,0', 'D', '30');
    type('C', '2P', '0,0', '20,0');
    expect(doc.entities.map((e) => e.geom)).toEqual([
      { kind: 'circle', c: { x: 10, y: 10 }, r: 5 },
      { kind: 'circle', c: { x: 0, y: 0 }, r: 15 },
      { kind: 'circle', c: { x: 10, y: 0 }, r: 10 },
    ]);
  });
});

describe('TRIM', () => {
  it('cuts a line between two cutting edges (Enter = all edges)', () => {
    const { doc, type, click, runner } = setup();
    type('L', '0,0', '100,0', '');
    type('L', '30,-10', '30,10', '');
    type('L', '60,-10', '60,10', '');
    type('TR', '');
    click(45, 0);
    type('');
    expect(runner.active).toBe(false);
    const horizontal = doc.entities.filter((e) => e.geom.kind === 'line' && e.geom.a.y === e.geom.b.y);
    expect(horizontal.map((e) => e.geom).sort((p, q) => (p.kind === 'line' && q.kind === 'line' ? p.a.x - q.a.x : 0))).toEqual([
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 30, y: 0 } },
      { kind: 'line', a: { x: 60, y: 0 }, b: { x: 100, y: 0 } },
    ]);
  });
});

describe('FILLET', () => {
  it('fillets two lines with a radius and adds the arc', () => {
    const { doc, type, click } = setup();
    type('L', '0,0', '50,0', '');
    type('L', '50,0', '50,50', '');
    type('F', 'R', '10');
    click(20, 0);
    click(50, 30);
    expect(doc.entities).toHaveLength(3);
    const arc = doc.entities[2].geom;
    expect(arc.kind).toBe('arc');
    if (arc.kind === 'arc') {
      expect(arc.r).toBeCloseTo(10);
      expect(arc.c.x).toBeCloseTo(40);
      expect(arc.c.y).toBeCloseTo(10);
    }
  });
});

describe('DIMLINEAR', () => {
  it('associates anchors to snapped endpoints and follows edits', () => {
    const { doc, type, runner, ctx } = setup();
    type('L', '0,0', '40,0', '');
    const view = doc.views[0];
    const at = (x: number, y: number) => {
      const p = toSheet(view, { x, y });
      runner.click(p, findSnap(doc, p, 1, runner.lastPoint));
    };
    type('DLI');
    at(0, 0);
    at(40, 0);
    at(20, -15);
    expect(doc.dimensions).toHaveLength(1);
    const dim = doc.dimensions[0];
    expect(dim.kind === 'linear' && dim.orientation).toBe('horizontal');
    expect(dim.kind === 'linear' && dim.offset).toBeCloseTo(-15);
    expect(dim.kind === 'linear' && dim.a.ref?.point).toBe('start');
    expect(measure(doc, dim)).toBeCloseTo(40);
    const ln = ctx.doc.entities[0];
    if (ln.geom.kind === 'line') ln.geom.b = { x: 55, y: 0 };
    expect(measure(doc, dim)).toBeCloseTo(55);
  });
});

describe('MOVE with pre-selection', () => {
  it('moves selected entities by typed displacement', () => {
    const { doc, runner, type } = setup();
    type('L', '0,0', '10,0', '');
    runner.start('MOVE', [doc.entities[0].id]);
    type('0,0', '5,5');
    expect(doc.entities[0].geom).toEqual({ kind: 'line', a: { x: 5, y: 5 }, b: { x: 15, y: 5 } });
  });
});

describe('VIEW New', () => {
  it('creates a projection-linked view placed below the parent', () => {
    const { doc, ctx, type, runner } = setup();
    type('V', 'N', 'Top view', '1:2');
    runner.click({ x: 125, y: 60 }, null);
    const v = doc.views[1];
    expect(v).toMatchObject({ name: 'Top view', scale: 0.5, origin: { x: 120, y: 60 }, link: { parentId: 'v-front', freeAxis: 'y' } });
    expect(ctx.settings.currentViewId).toBe(v.id);
  });
});

describe('MIRROR with dimensions', () => {
  const lin = (id: string, entityId: string, offset: number) => ({
    kind: 'linear' as const, id, viewId: 'v-front', layer: '0',
    a: { ref: { entityId, point: 'start' as const }, fallback: { x: 0, y: 0 } },
    b: { ref: { entityId, point: 'end' as const }, fallback: { x: 0, y: 0 } },
    orientation: 'horizontal' as const, offset, text: { override: null, prefix: '', suffix: '' },
  });

  it('copies associated dimensions onto the mirrored geometry, on the mirrored side', () => {
    const doc = newSheet();
    doc.views[0].scale = 2;
    const { runner, type } = setup(doc);
    type('L', '0,0', '40,0', '');
    const src = doc.entities[0];
    doc.dimensions.push(lin('d1', src.id, -15));
    runner.start('MIRROR', [src.id]);          // only the line is selected, the dim follows it
    type('-10,10', '50,10', 'N');
    expect(runner.active).toBe(false);
    expect(doc.entities).toHaveLength(2);
    expect(doc.dimensions).toHaveLength(2);
    const copy = doc.dimensions[1];
    if (copy.kind !== 'linear') throw new Error('linear expected');
    expect(copy.a.ref?.entityId).toBe(doc.entities[1].id);
    expect(copy.offset).toBeCloseTo(15);
    expect(measure(doc, copy)).toBeCloseTo(40);
  });

  it('mirrors in place with Erase=Yes and swaps arc start/end anchors', () => {
    const { doc, runner, type, ctx } = setup();
    const arc = ctx.addEntity({ kind: 'arc', c: { x: 0, y: 0 }, r: 10, start: 0, end: Math.PI / 2 });
    doc.dimensions.push({ ...lin('d1', arc.id, -5), b: { ref: null, fallback: { x: 30, y: 0 } } });
    doc.dimensions.push({ kind: 'radius', id: 'd2', viewId: 'v-front', layer: '0', entityId: arc.id, angle: Math.PI / 4, leader: 0, text: { override: null, prefix: '', suffix: '' } });
    runner.start('MIRROR', [arc.id, 'd1']);
    type('0,0', '0,10', 'Y');
    expect(doc.entities).toHaveLength(1);
    const d1 = doc.dimensions[0];
    const d2 = doc.dimensions[1];
    if (d1.kind !== 'linear' || d2.kind === 'linear') throw new Error('kinds');
    expect(d1.a.ref).toEqual({ entityId: arc.id, point: 'end' });   // image of the old start
    expect(d1.b.ref).toBeNull();
    expect(d1.b.fallback.x).toBeCloseTo(-30);
    expect(measure(doc, d1)).toBeCloseTo(20);
    expect(d1.offset).toBeCloseTo(-5);
    expect(d2.angle).toBeCloseTo((3 * Math.PI) / 4);
  });

  it('mirrors selected dimensions alone', () => {
    const { doc, runner, type } = setup();
    type('L', '0,0', '40,0', '');
    doc.dimensions.push({ ...lin('d1', 'gone', -10), a: { ref: null, fallback: { x: 0, y: 0 } }, b: { ref: null, fallback: { x: 40, y: 0 } } });
    runner.start('MIRROR', ['d1']);
    type('0,5', '10,5', 'N');
    expect(doc.entities).toHaveLength(1);
    expect(doc.dimensions).toHaveLength(2);
    const m = doc.dimensions[1];
    expect(m.kind === 'linear' && m.a.fallback.y).toBeCloseTo(10);
    expect(m.kind === 'linear' && m.offset).toBeCloseTo(10);
  });
});

describe('TRIM / EXTEND Fence', () => {
  const lines = (doc: SheetDoc, y: number) =>
    doc.entities
      .filter((e) => e.geom.kind === 'line' && Math.abs(e.geom.a.y - y) < 1e-9 && Math.abs(e.geom.b.y - y) < 1e-9)
      .map((e) => (e.geom.kind === 'line' ? [Math.min(e.geom.a.x, e.geom.b.x), Math.max(e.geom.a.x, e.geom.b.x)].map((v) => Math.round(v * 1e6) / 1e6) : []))
      .sort((p, q) => p[0] - q[0]);

  it('trims every object the fence crosses', () => {
    const { doc, type, runner } = setup();
    for (const y of [0, 10, 20]) type('L', `0,${y}`, `100,${y}`, '');
    type('L', '30,-10', '30,30', '');
    type('L', '60,-10', '60,30', '');
    type('TR', '', 'F', '45,-5', '45,25', '', '');
    expect(runner.active).toBe(false);
    for (const y of [0, 10, 20]) expect(lines(doc, y)).toEqual([[0, 30], [60, 100]]);
  });

  it('trims several crossings of the same object, including split-off pieces, with Undo of a fence point', () => {
    const { doc, type } = setup();
    type('L', '0,0', '100,0', '');
    for (const x of [20, 40, 60, 80]) type('L', `${x},-3`, `${x},3`, '');
    type('TR', '', 'F', '10,5', '10,-5', '90,-90', 'U', '50,-5', '50,5', '', '');
    expect(lines(doc, 0)).toEqual([[20, 40], [60, 100]]);
  });

  it('extends every object the fence crosses, once each', () => {
    const { doc, type } = setup();
    type('L', '0,0', '20,0', '');
    type('L', '0,10', '20,10', '');
    type('L', '50,-10', '50,20', '');
    type('EX', '', 'F', '15,-5', '15,15', '', '');
    expect(lines(doc, 0)).toEqual([[0, 50]]);
    expect(lines(doc, 10)).toEqual([[0, 50]]);
  });
});

describe('HATCH', () => {
  it('hatches the region around a picked point, with a hole as an island', () => {
    const { doc, type, log } = setup();
    type('REC', '0,0', '40,20', 'C', '20,10', '5');
    type('H', '5,5', '');
    expect(doc.annotations).toHaveLength(1);
    const h = doc.annotations[0];
    if (h.kind !== 'hatch') throw new Error('expected hatch');
    expect(h.loops).toHaveLength(2);
    expect(h.angle).toBe(45);
    expect(h.viewId).toBe(doc.views[0].id);
    expect(log).toContain('1 hatch(es) created.');
  });

  it('takes angle and spacing options, several picks, and ignores centre lines as boundaries', () => {
    const { doc, ctx, type, log } = setup();
    type('REC', '0,0', '40,20');
    ctx.settings.lineType = 'center';
    type('L', '20,-5', '20,25', '');
    type('H', 'A', '135', 'S', '3', '5,5', '30,5', '');
    expect(doc.annotations).toHaveLength(2);
    for (const h of doc.annotations) {
      if (h.kind !== 'hatch') throw new Error('expected hatch');
      expect(h.loops).toHaveLength(1);
      expect(h.loops[0]).toHaveLength(4); // the centre line does not split the rectangle
      expect(h.angle).toBe(135);
      expect(h.spacing).toBe(3);
    }
    type('H', '100,100', '');
    expect(log).toContain('No closed boundary found around the point.');
    expect(doc.annotations).toHaveLength(2);
  });
});
