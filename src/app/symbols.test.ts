import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../geom/types';
import { newSheet, toSheet } from '../model/doc';
import { SURFACE_PROCESS_WORDS } from '../model/standards';
import type { SheetDoc, SurfaceSymbol, TaperSymbol } from '../model/types';
import { COMMAND_INFO, resolveCommand, suggestCommands } from './commands';
import { CommandContext, defaultSettings } from './commands/types';
import { applyGrip, objectGrips } from './grips';
import { ICONS } from './icons';
import { CommandRunner } from './runner';
import { pick, pickEntity } from './selection';

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

const surfaces = (doc: SheetDoc) => doc.annotations.filter((a): a is SurfaceSymbol => a.kind === 'surface');
const tapers = (doc: SheetDoc) => doc.annotations.filter((a): a is TaperSymbol => a.kind === 'taper');
const close = (a: Vec2, b: Vec2) => {
  expect(a.x).toBeCloseTo(b.x);
  expect(a.y).toBeCloseTo(b.y);
};

describe('SURFACE', () => {
  it('places a removal-required symbol at the picked vertex and asks the texts a–e', () => {
    const { doc, runner, type, click } = setup();
    type('SURFACE');
    expect(runner.prompt).toMatch(/^Specify point on the surface \(material removal required\)/);
    click(20, 10);
    type('');                                    // rotation 0
    expect(runner.prompt).toMatch(/\(a\)/);
    type('Ra 3,2', '', '1', '=', '0,3');
    expect(runner.active).toBe(false);
    const [s] = surfaces(doc);
    expect(s).toMatchObject({ pos: { x: 20, y: 10 }, angle: 0, removal: 'required', collective: false });
    expect(s.fields).toEqual({ roughness: 'Ra 3,2', second: '', process: SURFACE_PROCESS_WORDS[0], lay: '=', allowance: '0,3' });
  });

  it('switches the process requirement with options and takes a typed process word or angle', () => {
    const { doc, type, click } = setup();
    type('SURF', 'P');
    click(0, 0);
    type('90', 'Rz 25', '', 'gedreht', 'T', '');
    const [s] = surfaces(doc);
    expect(s.removal).toBe('prohibited');
    expect(s.angle).toBeCloseTo(Math.PI / 2);
    expect(s.fields.process).toBe('gedreht');
    expect(s.fields.lay).toBe('⊥');
  });

  it('takes the rotation from a picked direction: towards −x stands the symbol on a left-hand surface', () => {
    const { doc, type, click } = setup();
    type('SURF', 'A');
    click(0, 0);
    click(-10, 0);
    type('', '', '', '', '');
    expect(surfaces(doc)[0].angle).toBeCloseTo(Math.PI / 2);
    expect(surfaces(doc)[0].removal).toBe('any');
  });

  it('warns when the symbol would not be readable from the bottom or right', () => {
    const { type, click, log } = setup();
    type('SURF');
    click(0, 0);
    type('180', '', '', '', '', '');
    expect(log.some((l) => /readable/.test(l))).toBe(true);
  });

  it('places a collective indication without asking for texts and remembers the roughness', () => {
    const { doc, runner, type, click } = setup();
    type('SURF');
    click(0, 0);
    type('', 'Ra 6,3', '', '', '', '');
    type('SURF', 'C');
    click(50, 0);
    type('');
    expect(runner.active).toBe(false);
    const [, c] = surfaces(doc);
    expect(c.collective).toBe(true);
    expect(c.fields.roughness).toBe('');
    type('SURF');
    click(80, 0);
    type('');
    expect(runner.prompt).toContain('<Ra 6,3>');
  });

  it('TEXTEDIT (and double-click) changes the texts, Enter keeps each one', () => {
    const { doc, runner, type, click } = setup();
    type('SURF');
    click(0, 0);
    type('', 'Ra 3,2', '', '', '', '');
    const s = surfaces(doc)[0];
    runner.start('TEXTEDIT', [s.id]);
    type('Ra 1,6', '', '5', '', '');
    expect(runner.active).toBe(false);
    expect(s.fields).toMatchObject({ roughness: 'Ra 1,6', process: SURFACE_PROCESS_WORDS[4] });
  });

  it('TEXTEDIT on a collective indication asks nothing and leaves it without texts', () => {
    const { doc, runner, type, click } = setup();
    type('SURF', 'C');
    click(0, 0);
    type('');
    const c = surfaces(doc)[0];
    expect(c.collective).toBe(true);
    runner.start('TEXTEDIT', [c.id]);
    expect(runner.active).toBe(false);
    expect(c.fields).toEqual({ roughness: '', second: '', process: '', lay: '', allowance: '' });
  });
});

describe('TAPER', () => {
  it('draws a leader and a taper symbol with its ratio and direction', () => {
    const { doc, runner, type, click } = setup();
    type('TAPER');
    click(0, 0);
    click(10, 10);
    type('');
    expect(runner.prompt).toMatch(/rate of taper/);
    type('1:5', 'L');
    expect(runner.active).toBe(false);
    const [t] = tapers(doc);
    expect(t).toMatchObject({ form: 'taper', ratio: '1:5', direction: { x: -1, y: 0 } });
    expect(t.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  });

  it('Form switches to a slope; the ratio is remembered', () => {
    const { doc, runner, type, click } = setup();
    type('TAPER', 'F', 'S');
    click(0, 0);
    click(10, 5);
    type('', '1:10', '');
    expect(tapers(doc)[0]).toMatchObject({ form: 'slope', ratio: '1:10', direction: { x: 1, y: -1 } });
    type('TAPER');
    click(30, 0);
    click(40, 5);
    type('');
    expect(runner.prompt).toContain('<1:10>');
  });

  it('insists on a ratio', () => {
    const { runner, type, click, log } = setup();
    type('TAPER');
    click(0, 0);
    click(10, 10);
    type('', '');
    expect(runner.active).toBe(true);
    expect(log).toContain('The symbol needs its ratio.');
  });
});

describe('symbols under MOVE, MIRROR, ROTATE and grips', () => {
  const withSymbols = () => {
    const env = setup();
    env.type('SURF');
    env.click(10, 0);
    env.type('', 'Ra 3,2', '', '', '', '');
    env.type('TAPER');
    env.click(0, 0);
    env.click(10, 10);
    env.type('', '1:5', 'R');
    return env;
  };

  it('MOVE moves both', () => {
    const { doc, runner, type } = withSymbols();
    runner.start('MOVE', doc.annotations.map((a) => a.id));
    type('0,0', '5,7');
    close(surfaces(doc)[0].pos, { x: 15, y: 7 });
    close(tapers(doc)[0].points[1], { x: 15, y: 17 });
  });

  it('MIRROR across a vertical line: the taper points the other way, the surface symbol stays upright', () => {
    const { doc, runner, type } = withSymbols();
    runner.start('MIRROR', doc.annotations.map((a) => a.id));
    type('-20,-10', '-20,10', 'Y');
    const s = surfaces(doc)[0];
    close(s.pos, { x: -50, y: 0 });
    expect(s.angle).toBeCloseTo(0);
    const t = tapers(doc)[0];
    close(t.direction, { x: -1, y: 0 });
    close(t.points[0], { x: -40, y: 0 });
  });

  it('MIRROR across a horizontal line hangs the surface symbol under the mirrored surface', () => {
    const { doc, runner, type } = withSymbols();
    runner.start('MIRROR', [surfaces(doc)[0].id]);
    type('-20,-5', '20,-5', 'Y');
    const s = surfaces(doc)[0];
    close(s.pos, { x: 10, y: -10 });
    expect(Math.abs(s.angle)).toBeCloseTo(Math.PI);
  });

  it('ROTATE turns the surface symbol with its vertex; a half turn flips the taper direction', () => {
    const { doc, runner, type } = withSymbols();
    runner.start('ROTATE', doc.annotations.map((a) => a.id));
    type('0,0', '180');
    const s = surfaces(doc)[0];
    close(s.pos, { x: -10, y: 0 });
    expect(Math.abs(s.angle)).toBeCloseTo(Math.PI);
    close(tapers(doc)[0].direction, { x: -1, y: 0 });
  });

  it('MIRROR across a horizontal line turns a slope the other way', () => {
    const env = setup();
    env.type('TAPER', 'F', 'S');
    env.click(0, 0);
    env.click(10, 10);
    env.type('', '1:10', 'R');
    const t = tapers(env.doc)[0];
    expect(t.direction).toEqual({ x: 1, y: -1 });
    env.runner.start('MIRROR', [t.id]);
    env.type('-20,-5', '20,-5', 'Y');
    close(tapers(env.doc)[0].direction, { x: 1, y: 1 });
  });

  it('two ROTATE 90° leave a taper in the same direction as one ROTATE 180°', () => {
    const twice = withSymbols();
    const id = tapers(twice.doc)[0].id;
    twice.runner.start('ROTATE', [id]);
    twice.type('0,0', '90');
    twice.runner.start('ROTATE', [id]);
    twice.type('0,0', '90');
    const once = withSymbols();
    once.runner.start('ROTATE', [tapers(once.doc)[0].id]);
    once.type('0,0', '180');
    close(tapers(twice.doc)[0].direction, tapers(once.doc)[0].direction);
    close(tapers(once.doc)[0].direction, { x: -1, y: 0 });
  });

  it('grips: the surface vertex and the taper leader points can be dragged', () => {
    const { doc } = withSymbols();
    const s = surfaces(doc)[0];
    const t = tapers(doc)[0];
    expect(objectGrips(doc, s.id)).toHaveLength(1);
    const tg = objectGrips(doc, t.id);
    expect(tg).toHaveLength(2);
    applyGrip(doc, objectGrips(doc, s.id)[0], { x: 3, y: 4 });
    applyGrip(doc, tg[1], { x: 20, y: 20 });
    expect(surfaces(doc)[0].pos).toEqual({ x: 3, y: 4 });
    expect(tapers(doc)[0].points[1]).toEqual({ x: 20, y: 20 });
  });

  it('a click on the symbol picks it', () => {
    const { doc } = withSymbols();
    const s = surfaces(doc)[0];
    expect(pick(doc, toSheet(doc.views[0], s.pos), 0.5)).toBe(s.id);
  });
});

describe('symbol commands in the catalogue', () => {
  it('SURFACE and TAPER resolve by name and alias, have HELP entries, autocomplete and toolbar icons', () => {
    expect(resolveCommand('surf')).toBe('SURFACE');
    expect(resolveCommand('AMSURFSYM')).toBe('SURFACE');
    expect(resolveCommand('amtapersym')).toBe('TAPER');
    for (const name of ['SURFACE', 'TAPER']) {
      expect(COMMAND_INFO.find((c) => c.name === name)?.group).toBe('Annotate');
      expect(ICONS[name]).toBeTruthy();
    }
    expect(suggestCommands('TAP')[0].name).toBe('TAPER');
  });
});
