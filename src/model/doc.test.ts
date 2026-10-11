import { describe, expect, it } from 'vitest';
import { newSheet, parse, serialize } from './doc';
import { titleBlockTemplate } from './titleblock';

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

  it('loads files written before title block templates existed as ISO 7200 and keeps a chosen template', () => {
    const old = JSON.parse(serialize(newSheet()));
    delete old.titleBlockTemplate;
    expect(titleBlockTemplate(parse(JSON.stringify(old))).id).toBe('iso7200');
    const d = newSheet();
    d.titleBlockTemplate = 'bbrz-small';
    expect(titleBlockTemplate(parse(serialize(d))).id).toBe('bbrz-small');
  });
});
