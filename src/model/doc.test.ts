import { describe, expect, it } from 'vitest';
import { newSheet, parse, serialize } from './doc';

describe('parse', () => {
  it('fills in annotations and parts list for files written before they existed', () => {
    const old = JSON.parse(serialize(newSheet()));
    delete old.annotations;
    delete old.partsList;
    const doc = parse(JSON.stringify(old));
    expect(doc.annotations).toEqual([]);
    expect(doc.partsList).toEqual([]);
  });

  it('keeps an existing parts list', () => {
    const d = newSheet();
    d.partsList.push({ item: '1', quantity: '1', name: 'Welle', standard: '', material: '', stock: '', remark: '' });
    expect(parse(serialize(d)).partsList[0].name).toBe('Welle');
  });
});
