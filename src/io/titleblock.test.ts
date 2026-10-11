import { describe, expect, it } from 'vitest';
import type { RawDrawing, RawEntity } from './raw';
import { readSheetBlocks } from './titleblock';

/** A drawing with one title block insert whose attributes carry the given tags. */
function drawing(attribs: { tag: string; text: string }[]): RawDrawing {
  const style = { layer: '0', color: 256, linetype: 'BYLAYER', lineweight: -1, paperSpace: false, handle: '1' };
  const insert: RawEntity = {
    ...style,
    handle: '2',
    kind: 'insert',
    name: 'A4 bis A0_PLR_m_SK_BBRZ',
    pos: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    attribs: attribs.map((a): RawEntity => ({ ...style, kind: 'text', pos: { x: 0, y: 0 }, text: a.text, height: 2.5, angle: 0, halign: 'left', valign: 'baseline', tag: a.tag })),
  };
  return { version: 'AC1032', unitFactor: 1, layers: new Map(), linetypes: new Map(), blocks: new Map(), layouts: [], entities: [insert] };
}

describe('readSheetBlocks', () => {
  it('selects the BBRZ template from an insert whose attribute tags are transliterated (ß → SS)', () => {
    const { template, fields } = readSheetBlocks(drawing([
      { tag: 'MASSSTAB', text: '1:1' },
      { tag: 'NEBENMASSSTAB', text: '2:1' },
      { tag: 'TOLERANZ', text: 'm' },
      { tag: 'KLASSE', text: 'JET MZ' },
    ]));
    expect(template).toBe('bbrz');
    expect(fields.get('scale')).toBe('1:1');
    expect(fields.get('secondaryScale')).toBe('2:1');
    expect(fields.get('generalTolerance')).toBe('ISO 2768-m');
    expect(fields.get('client')).toBe('JET MZ');
  });
});
