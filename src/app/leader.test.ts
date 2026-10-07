import { describe, expect, it } from 'vitest';
import { dimensionText, measure } from '../dim';
import type { Vec2 } from '../geom/types';
import { newSheet, toSheet } from '../model/doc';
import type { Leader, PartsListRow, SheetDoc } from '../model/types';
import { autoTerminator } from './commands/annotate';
import { CommandContext, defaultSettings } from './commands/types';
import { CommandRunner } from './runner';
import { pickEntity } from './selection';
import { findSnap, type SnapHit } from './snap';

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

const leaders = (doc: SheetDoc): Leader[] => doc.annotations.filter((a): a is Leader => a.kind === 'leader');
const row = (item: string, name = ''): PartsListRow => ({ item, quantity: '1', name, standard: '', material: '', stock: '', remark: '' });
const hit = (over: Partial<SnapHit>): SnapHit => ({ point: { x: 0, y: 0 }, kind: 'endpoint', entityId: 'e1', anchor: null, ...over });

describe('DIMANGULAR 3-point form', () => {
  const c30 = Math.cos(Math.PI / 6);
  const s30 = Math.sin(Math.PI / 6);

  it('asks vertex, two endpoints and the arc location, measuring the 30° sector', () => {
    const { doc, runner, type, click, log } = setup();
    type('DAN', '');
    expect(runner.prompt).toBe('Specify angle vertex:');
    click(0, 0);
    expect(runner.prompt).toBe('Specify first angle endpoint:');
    click(40, 0);
    expect(runner.prompt).toBe('Specify second angle endpoint:');
    click(40 * c30, 40 * s30);
    expect(runner.prompt).toMatch(/^Specify dimension arc line location/);
    click(30 * Math.cos(Math.PI / 12), 30 * Math.sin(Math.PI / 12));
    expect(runner.active).toBe(false);
    expect(log.some((l) => l === 'Lines are parallel.')).toBe(false);
    const d = doc.dimensions[0];
    expect(d.kind).toBe('angular');
    expect(measure(doc, d)).toBeCloseTo(30);
    expect(dimensionText(doc, d)).toBe('30°');
  });

  it('picks the obtuse 150° sector from the arc location', () => {
    const { doc, type, click } = setup();
    type('DAN', '');
    click(0, 0);
    click(40, 0);
    click(40 * c30, 40 * s30);
    // opposite side of the second ray → sense2 flips, the measured angle becomes 180° − 30°
    click(30, -10);
    expect(measure(doc, doc.dimensions[0])).toBeCloseTo(150);
    expect(dimensionText(doc, doc.dimensions[0])).toBe('150°');
  });

  it('logs when an angle endpoint coincides with the vertex', () => {
    const { runner, type, click, log } = setup();
    type('DAN', '');
    click(0, 0);
    click(0, 0); // the first endpoint sits on the vertex
    click(10, 0);
    expect(runner.active).toBe(false);
    expect(log.at(-1)).toBe('An angle endpoint coincides with the vertex.');
  });
});

describe('LEADER', () => {
  it('takes two points and no note text on Enter', () => {
    const { doc, runner, type } = setup();
    type('LE', '10,0', '30,10', '', '');
    expect(runner.active).toBe(false);
    const [l] = leaders(doc);
    expect(l.points).toEqual([{ x: 10, y: 0 }, { x: 30, y: 10 }]);
    expect(l).toMatchObject({ kind: 'leader', style: 'note', text: '', terminator: 'dot', height: 3.5, viewId: 'v-front', layer: '0' });
  });

  it('takes three points and a note with a %%c control code', () => {
    const { doc, type } = setup();
    type('LEADER', '0,0', '20,10', '30,0', '', 'Senkung %%c8');
    const [l] = leaders(doc);
    expect(l.points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 30, y: 0 }]);
    expect(l.text).toBe('Senkung ⌀8');
  });

  it('undoes the last point with U', () => {
    const { doc, type } = setup();
    type('LE', '0,0', '20,0', '30,0', 'U', '', 'note');
    const [l] = leaders(doc);
    expect(l.points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }]);
    expect(l.text).toBe('note');
  });

  it('forces the terminator with the T option', () => {
    const { doc, type } = setup();
    type('LEADER', 'T', 'N', '0,0', '20,10', '', '');
    type('LEADER', 'T', 'A', '0,0', '40,20', '', '');
    const ls = leaders(doc);
    expect(ls.map((l) => l.terminator)).toEqual(['none', 'arrow']);
  });

  it('autoTerminator picks an arrow on an entity and a dot elsewhere', () => {
    expect(autoTerminator(null)).toBe('dot');
    expect(autoTerminator(hit({ kind: 'endpoint' }))).toBe('arrow');
    expect(autoTerminator(hit({ kind: 'midpoint' }))).toBe('arrow');
    expect(autoTerminator(hit({ kind: 'center' }))).toBe('dot');
    expect(autoTerminator(hit({ kind: 'intersection', entityId: null }))).toBe('arrow');
  });

  it('uses an arrow when the tip snaps to the crossing of two outlines', () => {
    const { doc, runner, type } = setup();
    type('L', '0,0', '40,40', '');
    type('L', '0,40', '40,0', '');
    const view = doc.views[0];
    type('LE');
    const p = toSheet(view, { x: 20, y: 20 });
    runner.click(p, findSnap(doc, p, 1, runner.lastPoint));
    runner.click(toSheet(view, { x: 30, y: 30 }), null);
    type('', '');
    expect(leaders(doc).map((l) => l.terminator)).toEqual(['arrow']);
  });

  it('takes the terminator from the snap at the tip end to end', () => {
    const { doc, runner, type } = setup();
    type('L', '0,0', '40,0', '');
    const view = doc.views[0];
    const snap = (x: number, y: number) => {
      const p = toSheet(view, { x, y });
      runner.click(p, findSnap(doc, p, 1, runner.lastPoint));
    };
    type('LE');
    snap(0, 0); // on the line's endpoint
    runner.click(toSheet(view, { x: 20, y: 20 }), null);
    type('', '');
    type('LE');
    runner.click(toSheet(view, { x: 50, y: 50 }), null); // empty space
    runner.click(toSheet(view, { x: 60, y: 60 }), null);
    type('', '');
    expect(leaders(doc).map((l) => l.terminator)).toEqual(['arrow', 'dot']);
  });
});

describe('BALLOON', () => {
  it('numbers items 1, then 2 without a parts list', () => {
    const { doc, type } = setup();
    type('BAL', '0,0', '30,10', '');
    type('BAL', '0,0', '30,20', '');
    const ls = leaders(doc);
    expect(ls.map((l) => l.text)).toEqual(['1', '2']);
    expect(ls[0]).toMatchObject({ style: 'item', height: 7, terminator: 'dot' });
    expect(ls[0].points).toEqual([{ x: 0, y: 0 }, { x: 30, y: 10 }]);
  });

  it('uses the first unused parts-list item when a balloon already carries item 1', () => {
    const doc = newSheet();
    doc.partsList = [row('1', 'Welle'), row('2', 'Gabel')];
    doc.annotations.push({ kind: 'leader', id: 'a1', viewId: 'v-front', layer: '0', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], terminator: 'dot', style: 'item', text: '1', height: 7 });
    const { doc: d, type } = setup(doc);
    type('BAL', '0,0', '30,10', '');
    expect(leaders(d).map((l) => l.text)).toEqual(['1', '2']);
  });

  it('logs when the entered item is not in a non-empty parts list', () => {
    const doc = newSheet();
    doc.partsList = [row('1', 'Welle'), row('2', 'Gabel')];
    const { type, log } = setup(doc);
    type('BAL', '0,0', '30,10', '5');
    expect(log).toContain('Item 5 is not in the parts list yet (PARTSLIST Add).');
    // an empty parts list is not a mismatch
    const empty = setup();
    empty.type('BAL', '0,0', '30,10', '5');
    expect(empty.log.some((l) => /not in the parts list/.test(l))).toBe(false);
  });
});

describe('LEADER with MOVE, MIRROR and ERASE', () => {
  const points = (doc: SheetDoc): Vec2[] => leaders(doc)[0].points;

  it('moves by a typed displacement', () => {
    const { doc, runner, type } = setup();
    type('LE', '10,0', '30,10', '', '');
    runner.start('MOVE', [doc.annotations[0].id]);
    type('0,0', '5,5');
    expect(points(doc)).toEqual([{ x: 15, y: 5 }, { x: 35, y: 15 }]);
  });

  it('mirrors across an axis without erasing by default', () => {
    const { doc, runner, type } = setup();
    type('LE', '10,0', '30,10', '', '');
    runner.start('MIRROR', [doc.annotations[0].id]);
    type('0,0', '0,10', 'N');
    expect(doc.annotations).toHaveLength(2);
    expect(leaders(doc).map((l) => l.points[0])).toEqual([{ x: 10, y: 0 }, { x: -10, y: 0 }]);
  });

  it('erases the leader', () => {
    const { doc, runner, type } = setup();
    type('LE', '10,0', '30,10', '', '');
    runner.start('ERASE', [doc.annotations[0].id]);
    expect(doc.annotations).toHaveLength(0);
  });
});
