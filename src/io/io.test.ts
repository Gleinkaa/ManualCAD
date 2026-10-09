import { describe, expect, it } from 'vitest';
import { newSheet } from '../model/doc';
import { dxfToRaw } from './dxf/entities';
import { bulgeArc } from './import';
import { exportDxf, importDxf } from './index';
import { mtextToLines } from './mtext';

// Tests against the sample files (samples/) live in scripts/io-samples.test.ts: they need Node's fs.

describe('mtext', () => {
  it('strips formatting and splits paragraphs', () => {
    expect(mtextToLines('{\\fisocp|b0|i0;Zeile 1}\\PZeile 2 %%c20 H7')).toEqual(['Zeile 1', 'Zeile 2 ⌀20 H7']);
    expect(mtextToLines('\\A1;\\H2.5;Pos.\\~Nr.')).toEqual(['Pos. Nr.']);
    expect(mtextToLines('\\S1^2; mm')).toEqual(['1/2 mm']);
  });
});

describe('bulgeArc', () => {
  it('turns a bulge of 1 into a counter-clockwise half circle', () => {
    const a = bulgeArc({ x: 0, y: 0 }, { x: 10, y: 0 }, 1)!;
    expect(a.c.x).toBeCloseTo(5);
    expect(a.c.y).toBeCloseTo(0);
    expect(a.r).toBeCloseTo(5);
    expect(Math.cos(a.start)).toBeCloseTo(-1); // starts at the left end
    expect(Math.cos(a.end)).toBeCloseTo(1);
  });

  it('a negative bulge sweeps clockwise, stored start/end swapped', () => {
    const a = bulgeArc({ x: 0, y: 0 }, { x: 10, y: 0 }, -1)!;
    expect(a.c.x).toBeCloseTo(5);
    expect(a.c.y).toBeCloseTo(0);
    expect(a.start).toBeCloseTo(0);
    expect(a.end).toBeCloseTo(Math.PI);
  });
});

describe('importDxf (minimal R12 text)', () => {
  const dxf = [
    '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n1\n0\nENDSEC',
    '0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n2\n0\nLAYER\n2\nAchsen\n70\n0\n62\n4\n6\nCENTER\n0\nLAYER\n2\nKontur\n70\n0\n62\n1\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC',
    '0\nSECTION\n2\nENTITIES',
    '0\nLINE\n8\nKontur\n10\n0\n20\n0\n11\n2\n21\n0',
    '0\nLINE\n8\nAchsen\n10\n1\n20\n-1\n11\n1\n21\n1',
    '0\nCIRCLE\n8\nKontur\n10\n1\n20\n0\n40\n0.5',
    '0\nTEXT\n8\n0\n10\n0\n20\n2\n40\n0.125\n1\nHole %%c12\n72\n1\n11\n1\n21\n2',
    '0\nENDSEC\n0\nEOF',
  ].join('\n');

  it('converts inches to mm, maps layers to line types and places the view', () => {
    const { doc, report } = importDxf(dxf);
    expect(doc.entities).toHaveLength(3);
    const line = doc.entities.find((e) => e.geom.kind === 'line' && e.lineType === 'visible')!;
    expect(line.geom.kind === 'line' && line.geom.b.x).toBeCloseTo(50.8);
    expect(doc.entities.find((e) => e.layer === 'Achsen')!.lineType).toBe('center');
    expect(doc.lineGroup).toBe('0.7'); // colour 1 = red = wide 0.7/0.8 pen
    expect(doc.format).toBe('A4');
    expect(doc.views[0].scale).toBe(1);
    const t = doc.annotations.find((a) => a.kind === 'text');
    expect(t && t.kind === 'text' ? [t.text, t.align, t.height] : null).toEqual(['Hole ⌀12', 'center', 3.5]);
    expect(report[0]).toMatch(/Imported 3 entities/);
  });
});

describe('exportDxf', () => {
  it('round-trips geometry, text, hatch and dimensions through its own reader', () => {
    const doc = newSheet();
    const v = doc.views[0].id;
    doc.entities.push(
      { id: 'e1', viewId: v, layer: '0', lineType: 'visible', geom: { kind: 'line', a: { x: 0, y: 0 }, b: { x: 50, y: 0 } } },
      { id: 'e2', viewId: v, layer: '0', lineType: 'center', geom: { kind: 'circle', c: { x: 25, y: 20 }, r: 5 } },
      { id: 'e3', viewId: v, layer: 'Detail', lineType: 'hidden', geom: { kind: 'arc', c: { x: 0, y: 0 }, r: 10, start: 0, end: Math.PI / 2 } },
      { id: 'e4', viewId: v, layer: '0', lineType: 'construction', geom: { kind: 'line', a: { x: 0, y: 0 }, b: { x: 0, y: 99 } } },
    );
    doc.layers.push({ name: 'Detail', visible: true });
    doc.dimensions.push({ kind: 'linear', id: 'd1', viewId: v, layer: '0', a: { ref: null, fallback: { x: 0, y: 0 } }, b: { ref: null, fallback: { x: 50, y: 0 } }, orientation: 'horizontal', offset: -10, text: { override: null, prefix: '', suffix: '' } });
    doc.annotations.push(
      { kind: 'text', id: 't1', viewId: v, layer: '0', pos: { x: 0, y: 30 }, text: 'Welle ⌀20', height: 3.5, angle: 0, align: 'left' },
      { kind: 'hatch', id: 'h1', viewId: v, layer: '0', loops: [[{ kind: 'line', a: { x: 60, y: 0 }, b: { x: 80, y: 0 } }, { kind: 'line', a: { x: 80, y: 0 }, b: { x: 80, y: 10 } }, { kind: 'line', a: { x: 80, y: 10 }, b: { x: 60, y: 10 } }, { kind: 'line', a: { x: 60, y: 10 }, b: { x: 60, y: 0 } }]], angle: 45, spacing: 2 },
    );
    const text = exportDxf(doc);
    expect(text.startsWith('  0\nSECTION\n  2\nHEADER\n')).toBe(true);
    expect(text.trimEnd().endsWith('EOF')).toBe(true);
    const raw = dxfToRaw(text);
    const kinds = raw.entities.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'line').length).toBeGreaterThanOrEqual(1 + 3); // entity line + dimension lines
    expect(kinds).toContain('circle');
    expect(kinds).toContain('arc');
    expect(kinds).toContain('hatch');
    expect(kinds).toContain('viewport');
    expect(kinds.filter((k) => k === 'text').length).toBeGreaterThanOrEqual(2);
    expect(raw.entities.some((e) => e.kind === 'text' && e.text === 'Welle %%c20')).toBe(true);
    expect(raw.layers.get('Achsen')?.linetype).toBe('CENTER');
    expect(raw.layers.has('Detail')).toBe(true);
    expect(raw.layouts.map((l) => l.name)).toEqual(['Model', 'Sheet']);
    expect(raw.layouts[1].paperWidth).toBe(420);
    // the construction line is not exported
    expect(raw.entities.some((e) => e.kind === 'line' && Math.abs(e.b.y - e.a.y - 99) < 1e-9)).toBe(false);

    // and the export can be imported again
    const back = importDxf(text);
    expect(back.doc.format).toBe('A3');
    expect(back.doc.entities.some((e) => e.lineType === 'center' && e.geom.kind === 'circle')).toBe(true);
    expect(back.doc.entities.some((e) => e.lineType === 'hidden' && e.geom.kind === 'arc')).toBe(true);
  });
});
