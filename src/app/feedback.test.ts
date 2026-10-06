import { describe, expect, it } from 'vitest';
import { newSheet, toSheet } from '../model/doc';
import { CommandContext, defaultSettings } from './commands/types';
import { CommandRunner } from './runner';
import { pick, pickEntity } from './selection';

function setup() {
  const doc = newSheet();
  const log: string[] = [];
  const ctx = new CommandContext(() => doc, defaultSettings(doc), (m) => log.push(m));
  const runner = new CommandRunner(ctx, {
    pick: (p, filter) => (filter ? pickEntity(doc, p, 1, (id) => filter(doc.entities.find((e) => e.id === id)!)) : pick(doc, p, 1)),
    hostCommand: () => {},
    takeSelection: () => [],
    onStart: () => {},
    onEnd: () => {},
  });
  const click = (x: number, y: number) => runner.click(toSheet(doc.views[0], { x, y }), null);
  return { doc, runner, log, click };
}

describe('command line feedback', () => {
  it('reports rejected text so the UI can keep it for correction', () => {
    const { runner } = setup();
    expect(runner.text('L')).toBe(true);
    expect(runner.text('0,0')).toBe(true);
    expect(runner.text('10,')).toBe(false);
    expect(runner.active).toBe(true);
    expect(runner.text('10,5')).toBe(true);
  });

  it('asks for a point or a distance where a distance is accepted', () => {
    const { runner, log } = setup();
    runner.text('C');
    runner.text('50,50');
    runner.text('abc');
    expect(log.at(-1)).toBe('Requires a point or a distance, or an option keyword.');
    runner.text('10');
    expect(runner.active).toBe(false);
  });

  it('tells a wrong object type apart from a miss', () => {
    const { runner, log, click } = setup();
    runner.text('C');
    runner.text('30,30');
    runner.text('10');
    runner.text('DLI');
    runner.text('');
    expect(runner.prompt).toBe('Select line to dimension:');
    click(40, 30);
    expect(log.at(-1)).toBe('Object is not valid for this command.');
    click(200, 200);
    expect(log.at(-1)).toBe('No object found.');
  });
});
