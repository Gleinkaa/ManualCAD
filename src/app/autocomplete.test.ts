import { describe, expect, it } from 'vitest';
import { MAX_SUGGESTIONS, moveHighlight, suggest, type CommandSources } from './autocomplete';

const inserts = (text: string, src?: CommandSources) => suggest(text, src).map((s) => s.insert);

describe('suggest', () => {
  it('returns nothing for empty or blank input', () => {
    expect(suggest('')).toEqual([]);
    expect(suggest('   ')).toEqual([]);
    expect(suggest('_')).toEqual([]);
  });

  it('puts an exact canonical match first and still shows the list', () => {
    const r = suggest('line');
    expect(r[0]).toEqual({ insert: 'LINE', label: 'LINE', kind: 'command' });
    expect(r.length).toBeGreaterThan(1);
  });

  it('puts an exact alias match first, above canonical prefix matches', () => {
    const r = suggest('l');
    expect(r[0]).toEqual({ insert: 'L', label: 'L → LINE', kind: 'alias' });
    expect(r.map((s) => s.insert)).toContain('LINE');
  });

  it('resolves DLI to DIMLINEAR in the label', () => {
    expect(suggest('dli')[0]).toEqual({ insert: 'DLI', label: 'DLI → DIMLINEAR', kind: 'alias' });
  });

  it('ranks prefix matches above substring matches', () => {
    const src: CommandSources = { commands: ['ABOX', 'BOX', 'BOXES'], aliases: {}, host: [] };
    expect(inserts('box', src)).toEqual(['BOX', 'BOXES', 'ABOX']);
    expect(inserts('bo', src)).toEqual(['BOX', 'BOXES', 'ABOX']);
  });

  it('ranks canonical names above aliases within a tier', () => {
    const src: CommandSources = { commands: ['DIMZ'], aliases: { DIMA: 'DIMZ' }, host: ['DIMB'] };
    expect(suggest('dim', src).map((s) => [s.insert, s.kind])).toEqual([
      ['DIMB', 'host'],
      ['DIMZ', 'command'],
      ['DIMA', 'alias'],
    ]);
  });

  it('prefers a prefix alias over a substring canonical name', () => {
    const src: CommandSources = { commands: ['XAB'], aliases: { AB: 'XAB' }, host: [] };
    expect(inserts('a', src)).toEqual(['AB', 'XAB']);
  });

  it('sorts alphabetically within a tier', () => {
    expect(inserts('dim')).toEqual(['DIMALIGNED', 'DIMANGULAR', 'DIMDIAMETER', 'DIMEDIT', 'DIMLINEAR', 'DIMRADIUS']);
  });

  it('is case-insensitive and tolerates a leading underscore', () => {
    expect(inserts('_Circle')[0]).toBe('CIRCLE');
    expect(inserts('_dli')[0]).toBe('DLI');
    expect(inserts('CiR')).toEqual(inserts('cir'));
  });

  it('tags host commands', () => {
    expect(suggest('undo')[0]).toEqual({ insert: 'UNDO', label: 'UNDO', kind: 'host' });
    expect(suggest('u')[0]).toEqual({ insert: 'U', label: 'U → UNDO', kind: 'alias' });
  });

  it('caps the list', () => {
    expect(MAX_SUGGESTIONS).toBe(8);
    const all = suggest('e', undefined, 1000);
    expect(all.length).toBeGreaterThan(MAX_SUGGESTIONS);
    expect(suggest('e')).toEqual(all.slice(0, MAX_SUGGESTIONS));
  });

  it('returns nothing for text that matches no command or contains spaces', () => {
    expect(suggest('qqq')).toEqual([]);
    expect(suggest('zoom e')).toEqual([]);
  });
});

describe('moveHighlight', () => {
  it('starts at the first or last entry and wraps', () => {
    expect(moveHighlight(-1, 3, 1)).toBe(0);
    expect(moveHighlight(-1, 3, -1)).toBe(2);
    expect(moveHighlight(2, 3, 1)).toBe(0);
    expect(moveHighlight(0, 3, -1)).toBe(2);
    expect(moveHighlight(0, 0, 1)).toBe(-1);
  });
});
