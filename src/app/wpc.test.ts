// End-to-end checks of the WPC sheet builders: geometry, dimensions (values from the delivered
// drawing set), hatching, title block fields, and that every sheet plots and serialises cleanly.
import { describe, expect, it } from 'vitest';
import { measure, dimensionText } from '../dim';
import { parse, resolveAnchor, serialize } from '../model/doc';
import { plotSheet } from '../plot';
import { titleBlockTemplate } from '../model/titleblock';
import { buildWpc } from './testcases/wpc';

const PLOT = { includeConstruction: false, screenColors: false };

describe('WPC sheets', () => {
  it('WPC-004 Snap-Einsatz: A4 portrait, 5:1, section hatched, toleranced dimensions', () => {
    const { doc } = buildWpc('004');
    expect(doc.format).toBe('A4');
    expect(doc.orientation).toBe('portrait');
    expect(doc.titleBlockTemplate).toBe('bbrz');
    expect(doc.titleBlock.title).toBe('Snap-Einsatz');
    expect(doc.titleBlock.drawingNumber).toBe('WPC-004');
    expect(doc.views.map((v) => v.scale)).toEqual([5, 5]);
    expect(doc.views[1].name).toBe('A-A'); // the section is designated
    const hatches = doc.annotations.filter((a) => a.kind === 'hatch');
    expect(hatches).toHaveLength(1);
    const linear = doc.dimensions.filter((d) => d.kind === 'linear');
    const sw = linear.find((d) => d.kind === 'linear' && d.text.prefix === 'SW ')!;
    expect(measure(doc, sw)).toBeCloseTo(21.4, 6);
    const bore = linear.find((d) => d.kind === 'linear' && d.text.prefix === '⌀')!;
    expect(measure(doc, bore)).toBeCloseTo(7, 6);
    expect(linear.filter((d) => d.kind === 'linear' && d.orientation === 'vertical').map((d) => measure(doc, d)).sort((a, b) => a - b)).toEqual([4.25, 6.25, 8.25]);
    expect(doc.annotations.some((a) => a.kind === 'surface' && a.collective)).toBe(true);
    expect(doc.annotations.some((a) => a.kind === 'text' && a.text.includes('ISO 13715'))).toBe(true);
    expect(plotSheet(doc, PLOT).length).toBeGreaterThan(150);
    expect(parse(serialize(doc)).entities.length).toBe(doc.entities.length);
  });

  it('WPC-003 Deckel: chains sum to the outline, detail Z 5:1 hatched', () => {
    const { doc } = buildWpc('003');
    expect(doc.format).toBe('A3');
    expect(doc.titleBlock.title).toBe('Deckel');
    const main = doc.views[0];
    const sum = (orientation: 'horizontal' | 'vertical'): number =>
      doc.dimensions.filter((d) => d.kind === 'linear' && d.viewId === main.id && d.orientation === orientation)
        .reduce((a, d) => a + measure(doc, d), 0);
    expect(sum('horizontal')).toBeCloseTo(154, 3);
    expect(sum('vertical')).toBeCloseTo(144, 3);
    const detail = doc.views.find((v) => v.name === 'Z')!;
    expect(detail.scale).toBe(5);
    const dz = doc.dimensions.filter((d) => d.viewId === detail.id).map((d) => measure(doc, d)).sort((a, b) => a - b);
    expect(dz).toEqual([2, 2.2, 3.7, 6]);
    expect(doc.annotations.filter((a) => a.kind === 'hatch')).toHaveLength(2);
    expect(plotSheet(doc, PLOT).length).toBeGreaterThan(400);
  });

  it('WPC-002 Gehäuseunterteil: 36 positions, coordinate table, both sections hatched', () => {
    const { doc } = buildWpc('002');
    expect(doc.format).toBe('A2');
    expect(doc.titleBlock.title).toBe('Gehäuseunterteil');
    expect(doc.views.map((v) => v.name)).toEqual(['Vorderansicht', 'Ansicht von links', 'D', 'Draufsicht', 'A-A', 'C-C', 'Y']);
    const dia = doc.dimensions.find((d) => d.kind === 'diameter')!;
    expect(measure(doc, dia)).toBeCloseTo(12, 6);
    expect(dimensionText(doc, dia)).toBe('⌀12');
    const height = doc.dimensions.filter((d) => d.kind === 'linear' && d.orientation === 'vertical')
      .some((d) => d.kind === 'linear' && Math.abs(measure(doc, d) - 16.1) < 1e-9);
    expect(height).toBe(true);
    const sw = doc.dimensions.filter((d) => d.kind === 'linear')
      .filter((d) => d.kind === 'linear' && d.text.prefix === 'SW ');
    expect(sw.map((d) => measure(doc, d)).map((v) => Math.round(v * 1e6) / 1e6).sort((a, b) => a - b)).toEqual([21.8, 26]);
    const texts = doc.annotations.filter((a) => a.kind === 'text').map((a) => (a.kind === 'text' ? a.text : ''));
    expect(texts.filter((t) => t === '36')).toHaveLength(2); // the label in the top view and the table row
    expect(texts).toEqual(expect.arrayContaining(['Koordinaten ab 0/0 (Draufsicht), H = Höhe über Unterseite', '108,0', '124,5']));
    expect(texts.some((t) => t.startsWith('G  Achtkant-Sockel'))).toBe(true);
    expect(doc.annotations.filter((a) => a.kind === 'hatch')).toHaveLength(3); // A-A, C-C, detail Y
    // the hole-height dimension is tied to the circle centre of the rear view
    const hole = doc.dimensions.filter((d) => d.kind === 'linear' && d.orientation === 'vertical')
      .find((d) => d.kind === 'linear' && Math.abs(measure(doc, d) - 16.1) < 1e-9)!;
    expect(hole.kind === 'linear' && hole.b.ref).toEqual({ entityId: expect.any(String), point: 'center' });
    // every anchor of every dimension resolves (falls back where no entity point matches)
    for (const d of doc.dimensions) for (const a of 'a' in d ? [d.a, d.b] : []) resolveAnchor(doc, a);
    expect(plotSheet(doc, PLOT).length).toBeGreaterThan(1500);
  });

  it('WPC-001 assembly: parts list, balloons, isometric 1:2', () => {
    const { doc } = buildWpc('001');
    expect(doc.format).toBe('A3');
    expect(doc.titleBlock.documentType).toBe('Zusammenbauzeichnung');
    expect(doc.partsList.map((r) => r.item)).toEqual(['1', '2', '3', '4', '5']);
    expect(doc.partsList[0].name).toBe('Gehäuseunterteil');
    const balloons = doc.annotations.filter((a) => a.kind === 'leader' && a.style === 'item');
    expect(balloons.map((a) => (a.kind === 'leader' ? a.text : '')).sort()).toEqual(['1', '2', '3', '4']);
    const iso = doc.views.find((v) => v.name === 'Isometrie')!;
    expect(iso.scale).toBe(0.5);
    expect(doc.annotations.some((a) => a.kind === 'text' && a.text === 'Isometrie (1:2)')).toBe(true);
    expect(plotSheet(doc, PLOT).length).toBeGreaterThan(600);
  });

  it('sheets use the BBRZ title block template', () => {
    for (const id of ['001', '002', '003', '004'] as const) {
      const { doc } = buildWpc(id);
      expect(titleBlockTemplate(doc).id, id).toBe('bbrz');
    }
  });
});
