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
