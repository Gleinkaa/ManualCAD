import { describe, expect, it } from 'vitest';
import { newSheet } from './doc';
import { TITLE_BLOCK_TEMPLATES, templateFitsSheet, titleBlockTemplate } from './titleblock';

describe('title block templates', () => {
  it('new sheets start with ISO 7200', () => {
    expect(titleBlockTemplate(newSheet()).id).toBe('iso7200');
  });

  for (const t of Object.values(TITLE_BLOCK_TEMPLATES)) {
    describe(t.name, () => {
      it('fits A4 portrait: 180 mm wide, every field and ruling inside the block', () => {
        expect(t.width).toBe(180);
        for (const f of t.fields) {
          expect(f.box.x).toBeGreaterThanOrEqual(0);
          expect(f.box.y).toBeGreaterThanOrEqual(0);
          expect(f.box.x + f.box.w).toBeLessThanOrEqual(t.width);
          expect(f.box.y + f.box.h).toBeLessThanOrEqual(t.height);
        }
        for (const [x0, y0, x1, y1] of t.rules) for (const [x, y] of [[x0, y0], [x1, y1]]) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(t.width);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(t.height);
        }
      });

      it('prints each field once, with ISO 3098 lettering heights', () => {
        const fields = t.fields.map((f) => f.field);
        expect(new Set(fields).size).toBe(fields.length);
        for (const f of t.fields) expect([1.8, 2.5, 3.5, 5, 7, 10]).toContain(f.valueH);
        expect([2.5, 3.5]).toContain(t.partsList.valueH);
      });

      it('parts list columns span the block width', () => {
        expect(t.partsList.columns.reduce((s, c) => s + c.w, 0)).toBe(t.width);
      });
    });
  }

  it('BBRZ fields are keyed by the BBRZ attribute tags', () => {
    const tags = (id: keyof typeof TITLE_BLOCK_TEMPLATES) => Object.fromEntries(TITLE_BLOCK_TEMPLATES[id].fields.filter((f) => f.tag).map((f) => [f.tag, f.field]));
    expect(tags('bbrz')).toEqual({
      'ZEICHNUNGNR.': 'drawingNumber',
      TITEL_BENENNUNG: 'title',
      MAßSTAB: 'scale',
      NEBENMAßSTAB: 'secondaryScale',
      KLASSE: 'client',
      TOLERANZ: 'generalTolerance',
      'GEZ-NAME': 'createdBy',
      'GEPR-TAG': 'approvedDate',
      'GEPR-NAME': 'approvedBy',
      'PLOT-TAG': 'date',
      DOKU_ART: 'documentType',
    });
    expect(tags('bbrz-small')).toEqual({ NAME: 'createdBy', 'BLATT-NR': 'sheet', DATUM: 'date', BENENNUNG: 'title', KLASSE: 'client' });
    expect(TITLE_BLOCK_TEMPLATES.bbrz.partsList.columns.map((c) => c.tag)).toEqual(['TEIL', 'ZEICHNUNGSNUMMER', 'TEIL-STÜCK', 'TEIL-BENENNUNG', 'TEIL-WERKSTOFF/NORMKBZ']);
  });

  it('BBRZ small is made for A4 portrait only; the others for every sheet', () => {
    expect(templateFitsSheet(TITLE_BLOCK_TEMPLATES['bbrz-small'], 'A4', 'portrait')).toBe(true);
    expect(templateFitsSheet(TITLE_BLOCK_TEMPLATES['bbrz-small'], 'A3', 'landscape')).toBe(false);
    expect(templateFitsSheet(TITLE_BLOCK_TEMPLATES.bbrz, 'A0', 'landscape')).toBe(true);
    expect(templateFitsSheet(TITLE_BLOCK_TEMPLATES.iso7200, 'A3', 'portrait')).toBe(true);
  });
});
