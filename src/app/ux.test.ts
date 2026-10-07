// UX pass: hatch diagnosis and preview, HATCHEDIT, TEXTEDIT, ZOOM Window, autocomplete, acceptNumber.
import { describe, expect, it } from 'vitest';
import { openEnds } from '../geom';
import type { Curve } from '../geom/types';
import { newSheet, toSheet } from '../model/doc';
import type { Hatch, SheetDoc, TextNote } from '../model/types';
import { resolveCommand, suggestCommands } from './commands';
import { diagnoseHatch, diagnosisMessage, flipAngle } from './commands/hatch';
import { CommandContext, defaultSettings, type Request } from './commands/types';
import { CommandRunner } from './runner';
import { pickEntity } from './selection';

function setup(doc: SheetDoc = newSheet()) {
  const log: string[] = [];
  const zoomed: [number, number][] = [];
  const ctx = new CommandContext(() => doc, defaultSettings(doc), (m) => log.push(m), { zoomWindow: (a, b) => zoomed.push([a.x, b.x]) });
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
  const hatches = () => doc.annotations.filter((a): a is Hatch => a.kind === 'hatch');
  return { doc, ctx, runner, type, click, log, zoomed, hatches };
}

const line = (ax: number, ay: number, bx: number, by: number): Curve => ({ kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } });

describe('openEnds', () => {
  it('finds the free endpoints of an almost closed outline and none on a closed one', () => {
    const closed = [line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0, 0)];
    expect(openEnds(closed)).toEqual([]);
    const gapped = [line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0, 1)];
    expect(openEnds(gapped)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 1 }]);
  });

  it('a line crossing the outline leaves two ends outside, a T-junction one', () => {
    const rect = [line(0, 0, 10, 0), line(10, 0, 10, 10), line(10, 10, 0, 10), line(0, 10, 0, 0)];
    expect(openEnds([...rect, line(5, -2, 5, 12)])).toEqual([{ x: 5, y: -2 }, { x: 5, y: 12 }]);
    expect(openEnds([...rect, line(5, 0, 5, 12)])).toEqual([{ x: 5, y: 12 }]);
  });
});

describe('HATCH diagnosis', () => {
  it('names the gap and marks its open ends, nearest first', () => {
    const { doc, type, click, log, hatches } = setup();
    type('L', '0,0', '40,0', '40,20', '0,20', '0,1', '');
    type('H');
    click(20, 10);
    expect(hatches()).toHaveLength(0);
    expect(log.at(-1)).toMatch(/not closed: 2 open ends marked in red/);
    const d = diagnoseHatch(doc, doc.views[0].id, { x: 20, y: 3 });
    expect(d.reason).toBe('open');
    if (d.reason === 'open') expect(d.ends[0]).toEqual({ x: 0, y: 1 });
  });

  it('explains an outline of hidden lines instead of saying "no boundary"', () => {
    const { doc, ctx, type, click, log } = setup();
    ctx.settings.lineType = 'hidden';
    type('REC', '0,0', '40,20');
    type('H');
    click(20, 10);
    expect(log.at(-1)).toMatch(/closed only by hidden edge lines/);
    const d = diagnoseHatch(doc, doc.views[0].id, { x: 20, y: 10 });
    expect(d).toEqual({ reason: 'linetype', types: ['hidden'] });
    expect(diagnosisMessage(d)).toMatch(/visible edges \(01\.2\)/);
  });

  it('says so when there is nothing around the point', () => {
    const { doc } = setup();
    expect(diagnoseHatch(doc, doc.views[0].id, { x: 5, y: 5 })).toEqual({ reason: 'none' });
  });
});

describe('HATCH preview, Flip and Undo', () => {
  it('previews the region under the cursor and nothing outside', () => {
    const { runner, type, doc } = setup();
    type('REC', '0,0', '40,20', 'H');
    const req = runner.request as Extract<Request, { kind: 'point' }>;
    expect(req.kind).toBe('point');
    const view = doc.views[0];
    const inside = req.preview!(toSheet(view, { x: 10, y: 10 }), null);
    expect(inside.annotations).toHaveLength(1);
    expect(inside.annotations![0].kind).toBe('hatch');
    const outside = req.preview!(toSheet(view, { x: 100, y: 100 }), null);
    expect(outside.annotations).toEqual([]);
  });

  it('Flip toggles 45° and 135°, Undo removes the last hatch of the command', () => {
    expect(flipAngle(45)).toBe(135);
    expect(flipAngle(135)).toBe(45);
    expect(flipAngle(30)).toBe(150);
    const { type, click, hatches, ctx } = setup();
    type('REC', '0,0', '40,20', 'REC', '50,0', '90,20');
    type('H', 'F');
    click(20, 10);
    click(70, 10);
    expect(hatches()).toHaveLength(2);
    expect(hatches().every((h) => h.angle === 135)).toBe(true);
    type('U', '');
    expect(hatches()).toHaveLength(1);
    expect(ctx.settings.hatchAngle).toBe(135);
  });
});

describe('HATCHEDIT', () => {
  it('changes angle and spacing of the selected hatches and keeps the settings', () => {
    const { type, click, hatches, runner, ctx, log } = setup();
    type('REC', '0,0', '40,20', 'H');
    click(20, 10);
    type('');
    runner.start('HATCHEDIT', [hatches()[0].id]);
    type('A', '135', 'S', '4', '');
    expect(hatches()[0].angle).toBe(135);
    expect(hatches()[0].spacing).toBe(4);
    expect(ctx.settings.hatchAngle).toBe(135);
    expect(ctx.settings.hatchSpacing).toBe(4);
    runner.start('HATCHEDIT', []);
    expect(runner.prompt).toBe('Select hatches:');
    type('');
    expect(log.at(-1)).toBe('Nothing selected.');
  });
});

describe('TEXTEDIT', () => {
  it('replaces the text of a note, Enter keeps it', () => {
    const { doc, type, runner } = setup();
    type('DT', '10,10', '', '', 'Bohrung', '');
    const note = doc.annotations[0] as TextNote;
    expect(note.text).toBe('Bohrung');
    runner.start('TEXTEDIT', [note.id]);
    expect(runner.prompt).toBe('Enter text <Bohrung>:');
    type('%%c12 H7');
    expect(note.text).toBe('⌀12 H7');
    runner.start('TEXTEDIT', [note.id]);
    type('');
    expect(note.text).toBe('⌀12 H7');
  });
});

describe('ZOOM Window and acceptNumber', () => {
  it('ZOOM W hands two corners to the host and refuses an empty window', () => {
    const { type, zoomed, log } = setup();
    type('Z', 'W', '0,0', '50,30');
    expect(zoomed).toHaveLength(1);
    type('Z', 'W', '0,0', '0,30');
    expect(zoomed).toHaveLength(1);
    expect(log.at(-1)).toBe('The window has no size.');
  });

  it('a bare number at a point prompt with acceptNumber is an angle, not a distance', () => {
    const { type, doc } = setup();
    type('L', '0,0', '10,0', '');
    const id = doc.entities[0].id;
    const { runner } = setup(doc);
    runner.start('ROTATE', [id]);
    runner.text('0,0');
    runner.text('90');
    const g = doc.entities[0].geom;
    expect(g.kind === 'line' && g.b.x).toBeCloseTo(0);
    expect(g.kind === 'line' && g.b.y).toBeCloseTo(10);
  });
});

describe('command line autocomplete', () => {
  it('ranks exact aliases first, then prefixes, and resolves the new commands', () => {
    expect(suggestCommands('h')[0]).toMatchObject({ name: 'HATCH', alias: 'H' });
    expect(suggestCommands('dim').map((s) => s.name)).toEqual(['DIMALIGNED', 'DIMANGULAR', 'DIMDIAMETER', 'DIMEDIT', 'DIMLINEAR', 'DIMRADIUS']);
    expect(suggestCommands('')).toEqual([]);
    expect(suggestCommands('zzz')).toEqual([]);
    expect(suggestCommands('di').map((s) => s.name).every((n) => n.startsWith('DI'))).toBe(true);
    expect(suggestCommands('ro')[0].name).toBe('ROTATE');
    for (const [alias, name] of [['HE', 'HATCHEDIT'], ['ED', 'TEXTEDIT'], ['RO', 'ROTATE'], ['SC', 'SCALE'], ['P', 'PAN'], ['?', 'HELP']]) {
      expect(resolveCommand(alias)).toBe(name);
    }
  });
});
