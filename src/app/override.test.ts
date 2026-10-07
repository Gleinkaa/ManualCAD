import { describe, expect, it } from 'vitest';
import type { Curve, Vec2 } from '../geom/types';
import { newSheet, toSheet } from '../model/doc';
import type { Hatch, SheetDoc } from '../model/types';
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
  const at = (x: number, y: number) => toSheet(view, { x, y });
  /** Click at a view-local point (no snap). */
  const click = (x: number, y: number) => runner.click(at(x, y), null);
  return { doc, ctx, runner, type, click, at, log };
}

const hatches = (doc: SheetDoc): Hatch[] => doc.annotations.filter((a): a is Hatch => a.kind === 'hatch');

/** Bounding box of the outer loop (view-local mm). */
function bbox(loops: Curve[][]): { minX: number; maxX: number; minY: number; maxY: number } {
  const pts: Vec2[] = [];
  for (const c of loops[0]) {
    if (c.kind === 'line') pts.push(c.a, c.b);
    else pts.push({ x: c.c.x - c.r, y: c.c.y - c.r }, { x: c.c.x + c.r, y: c.c.y + c.r });
  }
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

/** A 40x20 rectangle drawn as four LINE segments (0,0)-(40,0)-(40,20)-(0,20) with a HATCH inside. */
function rectWithHatch(seed = '10,10') {
  const env = setup();
  env.type('L', '0,0', '40,0', '40,20', '0,20', 'C');
  env.type('H', seed, '');
  return env;
}

describe('typed snap overrides', () => {
  it('sets a one-shot midpoint override at a point prompt and logs it', () => {
    const { runner, type, log } = setup();
    type('L', '0,0');
    expect(runner.prompt).toBe('Specify next point [Undo]:');
    expect(runner.text('MID')).toBe(true);
    expect(runner.snapOverride).toBe('midpoint');
    expect(log.at(-1)).toBe('Midpoint snap for the next point.');
  });

  it('accepts the override keyword in lower case', () => {
    const { runner, type } = setup();
    type('L', '0,0');
    runner.text('mid');
    expect(runner.snapOverride).toBe('midpoint');
  });

  it('rejects a click that does not yield the overridden snap, without advancing', () => {
    const { runner, type, click, log } = setup();
    type('L', '0,0');
    type('MID');
    const prompt = runner.prompt;
    click(10, 10);
    expect(log.at(-1)).toBe('No midpoint found at that point.');
    expect(runner.prompt).toBe(prompt);
    expect(runner.snapOverride).toBe('midpoint');
  });

  it('accepts a real matching snap, advances and clears the override', () => {
    const doc = newSheet();
    doc.entities.push({
      id: 'edge',
      viewId: 'v-front',
      layer: '0',
      lineType: 'visible',
      geom: { kind: 'line', a: { x: 30, y: 30 }, b: { x: 50, y: 30 } },
    });
    const { runner, type, at } = setup(doc);
    type('L', '0,0');
    type('MID');
    const cursor = at(40, 30); // midpoint of `edge`
    const hit = findSnap(doc, cursor, 1, runner.lastPoint, runner.snapOverride ?? undefined);
    expect(hit?.kind).toBe('midpoint');
    expect(hit?.anchor).toBe('mid');
    runner.click(hit!.point, hit);
    expect(runner.snapOverride).toBeNull();
    expect(runner.prompt).toBe('Specify next point [Undo]:');
    expect(doc.entities.at(-1)?.geom).toEqual({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 30 } });
  });

  it('rejects PER at a first point (no base) but accepts it at the second point', () => {
    const { runner, type, log } = setup();
    type('L');
    expect(runner.prompt).toBe('Specify first point:');
    expect(runner.text('PER')).toBe(false);
    expect(log.at(-1)).toBe('Perpendicular needs a base point; pick the first point another way.');
    expect(runner.snapOverride).toBeNull();

    type('0,0');
    expect(runner.prompt).toBe('Specify next point [Undo]:');
    expect(runner.text('PER')).toBe(true);
    expect(runner.snapOverride).toBe('perpendicular');
    expect(log.at(-1)).toBe('Perpendicular snap for the next point.');
  });

  it('clears the override when the command is cancelled', () => {
    const { runner, type } = setup();
    type('L', '0,0', 'MID');
    expect(runner.snapOverride).toBe('midpoint');
    runner.cancel();
    expect(runner.snapOverride).toBeNull();
    expect(runner.active).toBe(false);
  });

  it('clears the override when a coordinate is typed instead', () => {
    const { runner, type } = setup();
    type('L', '0,0', 'MID');
    expect(runner.snapOverride).toBe('midpoint');
    type('10,10');
    expect(runner.snapOverride).toBeNull();
  });

  it("does not shadow ARC's Center option (C)", () => {
    const { doc, runner, type, log } = setup();
    type('ARC');
    expect(runner.prompt).toBe('Specify start point of arc [Center]:');

    // CEN is a snap override, not the Center option keyword
    type('CEN');
    expect(runner.snapOverride).toBe('center');
    expect(log.at(-1)).toBe('Center snap for the next point.');

    // the option keyword is matched before the override table, so it still wins
    type('C');
    expect(runner.prompt).toBe('Specify center point of arc:');

    // a coordinate places the centre and clears the pending override
    type('50,50');
    expect(runner.snapOverride).toBeNull();
    expect(runner.prompt).toBe('Specify start point of arc:');
    type('60,50');
    type('50,60');
    expect(runner.active).toBe(false);
    expect(doc.entities).toHaveLength(1);
    expect(doc.entities[0].geom.kind).toBe('arc');
  });
});

describe('hatch association after transforms', () => {
  it('MOVE of the hatch alone drops the association, and a later FILLET leaves its loops alone', () => {
    const { doc, runner, type, click } = rectWithHatch();
    const h = hatches(doc)[0];
    expect(h.assoc).toBeDefined();
    expect(bbox(h.loops)).toEqual({ minX: 0, maxX: 40, minY: 0, maxY: 20 });

    runner.start('MOVE', [h.id]);
    type('0,0', '5,0');

    expect(h.assoc).toBeUndefined();
    expect(bbox(h.loops)).toEqual({ minX: 5, maxX: 45, minY: 0, maxY: 20 });
    const loops0 = h.loops;

    // fillet the rectangle's bottom-left corner: the orphaned hatch must not re-find a region
    type('F', 'R', '5');
    click(10, 0);
    click(0, 10);

    expect(h.loops).toBe(loops0);
  });

  it('MOVE of the hatch together with all four edges keeps the association and the boundary ids', () => {
    const { doc, runner, type } = rectWithHatch();
    const h = hatches(doc)[0];
    const ids = doc.entities.map((e) => e.id);
    expect(h.assoc!.boundary).toEqual(ids);

    runner.start('MOVE', [...ids, h.id]);
    type('0,0', '5,0');

    expect(h.assoc).toBeDefined();
    expect(h.assoc!.boundary).toEqual(ids);
    expect(bbox(h.loops)).toEqual({ minX: 5, maxX: 45, minY: 0, maxY: 20 });
  });

  it('COPY of the hatch alone: the copy has no association, the original keeps it', () => {
    const { doc, runner, type } = rectWithHatch();
    const src = hatches(doc)[0];

    runner.start('COPY', [src.id]);
    type('0,0', '100,0', '');

    const copies = hatches(doc).filter((x) => x.id !== src.id);
    expect(copies).toHaveLength(1);
    expect(copies[0].assoc).toBeUndefined();
    expect(src.assoc).toBeDefined();
  });

  it('COPY of the hatch with its four edges re-associates the copy with the new ids, and FILLET follows each side', () => {
    const { doc, runner, type, click } = rectWithHatch();
    const src = hatches(doc)[0];
    const origIds = doc.entities.map((e) => e.id);

    runner.start('COPY', [...origIds, src.id]);
    type('0,0', '100,0', '');

    const copy = hatches(doc).find((x) => x.id !== src.id)!;
    const copyIds = doc.entities.filter((e) => !origIds.includes(e.id)).map((e) => e.id);
    expect(copyIds).toHaveLength(4);
    expect(copy.assoc).toBeDefined();
    expect(copy.assoc!.boundary).toHaveLength(4);
    expect(new Set(copy.assoc!.boundary)).toEqual(new Set(copyIds));
    expect(copy.assoc!.boundary.some((id) => origIds.includes(id))).toBe(false);

    // fillet the original's corner: only the original hatch gains the arc
    const copyLoops = copy.loops;
    type('F', 'R', '5');
    click(10, 0);
    click(0, 10);
    expect(src.loops[0].some((c) => c.kind === 'arc')).toBe(true);
    expect(copy.loops).toBe(copyLoops);

    // fillet the copy's corner: the copy hatch gains the arc too
    type('F', 'R', '5');
    click(110, 0);
    click(100, 10);
    expect(copy.loops[0].some((c) => c.kind === 'arc')).toBe(true);
  });

  it('MIRROR keeping the source gives an image without an association', () => {
    const { doc, runner, type } = rectWithHatch();
    const src = hatches(doc)[0];

    runner.start('MIRROR', [src.id]);
    type('-10,-10', '-10,30', 'N');

    expect(src.assoc).toBeDefined();
    const image = hatches(doc).find((x) => x.id !== src.id)!;
    expect(image.assoc).toBeUndefined();
  });

  it('MIRROR erasing the source drops the hatch association', () => {
    const { doc, runner, type } = rectWithHatch();
    const h = hatches(doc)[0];
    expect(h.assoc).toBeDefined();

    runner.start('MIRROR', [h.id]);
    type('-10,-10', '-10,30', 'Y');

    expect(hatches(doc)).toHaveLength(1);
    expect(h.assoc).toBeUndefined();
  });
});
