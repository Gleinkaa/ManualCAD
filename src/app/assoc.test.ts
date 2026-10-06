import { describe, expect, it, vi } from 'vitest';
import type { Curve, Vec2 } from '../geom/types';
import { newSheet, toSheet } from '../model/doc';
import type { Hatch, SheetDoc } from '../model/types';
import { resolveCommand } from './commands';
import { CommandContext, defaultSettings, type HostActions } from './commands/types';
import { CommandRunner } from './runner';
import { pickEntity } from './selection';

function setup(doc: SheetDoc = newSheet(), host: HostActions = {}) {
  const log: string[] = [];
  const ctx = new CommandContext(() => doc, defaultSettings(doc), (m) => log.push(m), host);
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

const hatch = (doc: SheetDoc): Hatch => {
  const h = doc.annotations.find((a): a is Hatch => a.kind === 'hatch');
  if (!h) throw new Error('no hatch');
  return h;
};

/** Bounding box of the outer loop (view-local mm). */
function bbox(loops: Curve[][]): { minX: number; maxX: number; minY: number; maxY: number } {
  const pts: Vec2[] = [];
  for (const c of loops[0]) {
    if (c.kind === 'line') pts.push(c.a, c.b);
    else if (c.kind === 'circle') pts.push({ x: c.c.x - c.r, y: c.c.y - c.r }, { x: c.c.x + c.r, y: c.c.y + c.r });
    else pts.push({ x: c.c.x - c.r, y: c.c.y - c.r }, { x: c.c.x + c.r, y: c.c.y + c.r });
  }
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

const LOST = '1 hatch(es) lost their boundary and no longer follow edits.';

describe('associative HATCH',
  () => {
    it('records the seed and the four boundary edges of a 40×20 rectangle', () => {
      const { doc, type } = setup();
      type('REC', '0,0', '40,20');
      type('H', '5,5', '');
      const h = hatch(doc);
      expect(h.loops).toHaveLength(1);
      expect(h.loops[0]).toHaveLength(4);
      expect(h.assoc).toBeDefined();
      expect(h.assoc!.seed).toEqual({ x: 5, y: 5 });
      expect(h.assoc!.boundary).toHaveLength(4);
      expect(new Set(h.assoc!.boundary).size).toBe(4);
      expect(h.assoc!.boundary).toEqual(doc.entities.map((e) => e.id));
    });

    it('follows a FILLET: the outer loop gains the arc and the association key changes', () => {
      const { doc, type, click } = setup();
      type('REC', '0,0', '40,20');
      type('H', '5,5', '');
      const h = hatch(doc);
      const key0 = h.assoc!.key;

      // fillet the bottom-left corner (bottom edge and left edge), radius 5
      type('F', 'R', '5');
      click(10, 0);
      click(0, 10);

      expect(h.loops[0].some((c) => c.kind === 'arc')).toBe(true);
      expect(h.assoc).toBeDefined();
      expect(h.assoc!.key).not.toBe(key0);
      expect(h.assoc!.boundary).toHaveLength(5); // the new arc joins the boundary
      expect(h.assoc!.seed).toEqual({ x: 5, y: 5 });
    });

    it('follows a rectangle MOVE that keeps the seed enclosed (loops shifted by 5)', () => {
      const { doc, runner, type } = setup();
      type('REC', '0,0', '40,20');
      type('H', '10,10', '');
      const h = hatch(doc);
      const ids = doc.entities.map((e) => e.id);

      runner.start('MOVE', ids);
      type('0,0', '5,0');

      expect(h.assoc).toBeDefined();
      expect(h.assoc!.seed).toEqual({ x: 10, y: 10 });
      expect(bbox(h.loops)).toEqual({ minX: 5, maxX: 45, minY: 0, maxY: 20 });
      expect(h.loops[0]).toHaveLength(4);
    });

    it('loses the association when the seed is no longer enclosed (MOVE 100)', () => {
      const { doc, runner, type, log } = setup();
      type('REC', '0,0', '40,20');
      type('H', '10,10', '');
      const h = hatch(doc);
      const loops0 = h.loops;
      const ids = doc.entities.map((e) => e.id);

      runner.start('MOVE', ids);
      type('0,0', '100,0');

      expect(h.assoc).toBeUndefined();
      expect(h.loops).toBe(loops0); // keeps its last loops
      expect(bbox(h.loops)).toEqual({ minX: 0, maxX: 40, minY: 0, maxY: 20 });
      expect(log).toContain(LOST);
    });

    it('moves with the rectangle when both are selected: loops and seed follow, association kept', () => {
      const { doc, runner, type } = setup();
      type('REC', '0,0', '40,20');
      type('H', '10,10', '');
      const h = hatch(doc);
      const ids = [...doc.entities.map((e) => e.id), h.id];

      runner.start('MOVE', ids);
      type('0,0', '5,0');

      expect(h.assoc).toBeDefined();
      expect(h.assoc!.seed).toEqual({ x: 15, y: 10 });
      expect(bbox(h.loops)).toEqual({ minX: 5, maxX: 45, minY: 0, maxY: 20 });
    });

    it('loses the association when one edge is ERASE-d, but keeps the hatch with its old loops', () => {
      const { doc, runner, type, log } = setup();
      type('REC', '0,0', '40,20');
      type('H', '10,10', '');
      const h = hatch(doc);
      const loops0 = h.loops;

      runner.start('ERASE', [doc.entities[0].id]);

      expect(doc.annotations).toContain(h);
      expect(h.assoc).toBeUndefined();
      expect(h.loops).toBe(loops0);
      expect(h.loops[0]).toHaveLength(4);
      expect(log).toContain(LOST);
    });

    it('re-finds the region when an island circle is erased: the island leaves the loops, key changes', () => {
      const { doc, runner, type } = setup();
      type('REC', '0,0', '40,20');
      type('C', '20,10', '5');
      type('H', '10,10', '');
      const h = hatch(doc);
      const circleId = doc.entities[4].id;
      const key0 = h.assoc!.key;

      expect(h.loops).toHaveLength(2); // outer rectangle + island
      expect(h.assoc!.boundary).toHaveLength(5);
      expect(h.assoc!.boundary).toContain(circleId);

      runner.start('ERASE', [circleId]);

      expect(h.assoc).toBeDefined(); // the seed is still enclosed → association kept
      expect(h.assoc!.key).not.toBe(key0);
      expect(h.assoc!.boundary).toHaveLength(4);
      expect(h.assoc!.boundary).not.toContain(circleId);
      expect(h.loops).toHaveLength(1); // island gone
      expect(h.loops[0]).toHaveLength(4);
    });

    it('mirrors the seed together with the geometry on an in-place MIRROR', () => {
      const { doc, runner, type } = setup();
      type('REC', '0,0', '40,20');
      type('H', '10,10', '');
      const h = hatch(doc);
      const ids = [...doc.entities.map((e) => e.id), h.id];

      runner.start('MIRROR', ids);
      type('0,-10', '0,30', 'Y'); // mirror across the local y axis, erasing the source

      expect(runner.active).toBe(false);
      expect(h.assoc).toBeDefined();
      expect(h.assoc!.seed).toEqual({ x: -10, y: 10 });
      expect(bbox(h.loops)).toEqual({ minX: -40, maxX: 0, minY: 0, maxY: 20 });
    });

    it('loses the association when a boundary edge is retyped to a non-boundary line type', () => {
      const { doc, runner, type, log } = setup();
      type('REC', '0,0', '40,20');
      type('H', '10,10', '');
      const h = hatch(doc);

      runner.start('LTYPE', [doc.entities[0].id]);
      type('C'); // centre line: not a hatching boundary

      expect(doc.entities[0].lineType).toBe('center');
      expect(h.assoc).toBeUndefined();
      expect(log).toContain(LOST);
    });

    it('ignores an unrelated line drawn elsewhere (key and loops unchanged)', () => {
      const { doc, type } = setup();
      type('REC', '0,0', '40,20');
      type('H', '10,10', '');
      const h = hatch(doc);
      const key0 = h.assoc!.key;
      const loops0 = h.loops;

      type('L', '100,100', '120,100', '');

      expect(h.assoc!.key).toBe(key0);
      expect(h.loops).toBe(loops0);
    });

    it('COPY re-associates the copy with its copied boundary, not the source', () => {
      const { doc, runner, type } = setup();
      type('REC', '0,0', '40,20');
      type('H', '10,10', '');
      const src = hatch(doc);
      const srcEnts = doc.entities.map((e) => e.id);

      runner.start('COPY', [...srcEnts, src.id]);
      type('0,0', '100,0', '');

      const cp = doc.annotations.find((a): a is Hatch => a.kind === 'hatch' && a.id !== src.id)!;
      const copiedEnts = doc.entities.filter((e) => !srcEnts.includes(e.id)).map((e) => e.id);
      expect(copiedEnts).toHaveLength(4);
      expect(cp.assoc).toBeDefined();
      expect(cp.assoc!.boundary.every((id) => copiedEnts.includes(id))).toBe(true);

      runner.start('MOVE', copiedEnts);
      type('0,0', '5,0');
      expect(bbox(cp.loops)).toEqual({ minX: 105, maxX: 145, minY: 0, maxY: 20 });
      expect(bbox(src.loops)).toEqual({ minX: 0, maxX: 40, minY: 0, maxY: 20 });
    });

    it('MIRROR without erasing re-associates the image with its mirrored boundary', () => {
      const { doc, runner, type } = setup();
      type('REC', '0,0', '40,20');
      type('H', '10,10', '');
      const src = hatch(doc);
      const srcEnts = doc.entities.map((e) => e.id);

      runner.start('MIRROR', [...srcEnts, src.id]);
      type('-10,-10', '-10,30', 'N');

      const cp = doc.annotations.find((a): a is Hatch => a.kind === 'hatch' && a.id !== src.id)!;
      const copiedEnts = doc.entities.filter((e) => !srcEnts.includes(e.id)).map((e) => e.id);
      expect(copiedEnts).toHaveLength(4);
      expect(cp.assoc).toBeDefined();
      expect(cp.assoc!.boundary.every((id) => copiedEnts.includes(id))).toBe(true);
      expect(bbox(cp.loops)).toEqual({ minX: -60, maxX: -20, minY: 0, maxY: 20 });
    });

    it('hiding the boundary layer keeps the association, and later edits still follow', () => {
      const { doc, runner, type, log } = setup();
      type('REC', '0,0', '40,20');
      type('H', '10,10', '');
      const h = hatch(doc);
      const key0 = h.assoc!.key;
      const rectEnts = doc.entities.map((e) => e.id);
      const layer = doc.layers.find((l) => l.name === '0')!;

      layer.visible = false;
      type('L', '100,100', '120,100', '');
      expect(h.assoc).toBeDefined();
      expect(h.assoc!.key).toBe(key0);
      expect(log).not.toContain(LOST);

      layer.visible = true;
      type('L', '200,200', '220,200', '');
      expect(h.assoc).toBeDefined();

      runner.start('MOVE', rectEnts);
      type('0,0', '5,0');
      expect(bbox(h.loops)).toEqual({ minX: 5, maxX: 45, minY: 0, maxY: 20 });
    });
  });

describe('PARTSLIST host vs command line', () => {
  it('PARTSLIST calls the host dialog once and never starts the runner', () => {
    const spy = vi.fn();
    const { doc, runner, type } = setup(newSheet(), { partsList: spy });
    type('PARTSLIST');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(runner.active).toBe(false);
    expect(doc.partsList).toEqual([]);
  });

  it("'-PARTSLIST' runs the command line flow even when a host dialog exists", () => {
    const spy = vi.fn();
    const { doc, runner, type } = setup(newSheet(), { partsList: spy });
    type('-PARTSLIST', 'A', '', '', 'Welle', '', '', '', '');
    expect(spy).not.toHaveBeenCalled();
    expect(doc.partsList).toHaveLength(1);
    expect(doc.partsList[0]).toMatchObject({ item: '1', quantity: '1', name: 'Welle' });
    type('');
    expect(runner.active).toBe(false);
  });

  it("resolveCommand('-parts') resolves to '-PARTSLIST'", () => {
    expect(resolveCommand('-parts')).toBe('-PARTSLIST');
    expect(resolveCommand('-PARTS')).toBe('-PARTSLIST');
  });
});
