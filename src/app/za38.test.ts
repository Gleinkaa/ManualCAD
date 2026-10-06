// End-to-end: the ZA 38 exercise drawn through the command line (src/app/testcases/za38.ts), then checked.
import { describe, expect, it } from 'vitest';
import { dimensionText, measure } from '../dim';
import type { Hatch } from '../model/types';
import { frameGeometry, hatchSheetSegments, plotSheet, sheetToSvg } from '../plot';
import { drawZA38 } from './testcases/za38';

describe('ZA 38 end to end', () => {
  const { doc, log } = drawZA38();

  it('runs every command without errors', () => {
    expect(log.filter((l) => /error|unknown|invalid|no closed boundary|requires/i.test(l))).toEqual([]);
  });

  it('dimensions read as in the book', () => {
    const texts = doc.dimensions.map((d) => dimensionText(doc, d));
    for (const t of ['40', '52', '136', '28', '60', '66', '⌀28', '⌀35', '⌀50', '⌀30', '⌀24', '⌀15', '35', '62', '115', '15', '25', '30°', '17', '30', '14', '22', '⌀14']) {
      expect(texts).toContain(t);
    }
    const angular = doc.dimensions.find((d) => d.kind === 'angular')!;
    expect(measure(doc, angular)).toBeCloseTo(30, 6);
  });

  it('hatches the five cut regions at 45°, inside the sheet frame, with the bores left free', () => {
    const hatches = doc.annotations.filter((a): a is Hatch => a.kind === 'hatch');
    expect(hatches).toHaveLength(5);
    expect(hatches.every((h) => h.angle === 45)).toBe(true);
    const { frame } = frameGeometry(doc);
    for (const h of hatches) {
      const segs = hatchSheetSegments(doc, h);
      expect(segs.length).toBeGreaterThan(2);
      for (const [a, b] of segs) {
        for (const p of [a, b]) {
          expect(p.x).toBeGreaterThan(frame.x0);
          expect(p.x).toBeLessThan(frame.x1);
          expect(p.y).toBeGreaterThan(frame.y0);
          expect(p.y).toBeLessThan(frame.y1);
        }
      }
    }
    // no hatch line crosses the blind bore of part 1 (|y| < 6.5 for 0 < x < 28, view-local)
    const v1 = doc.views[0];
    const bore = (p: { x: number; y: number }) => {
      const l = { x: (p.x - v1.origin.x) / v1.scale, y: (p.y - v1.origin.y) / v1.scale };
      return l.x > 0.5 && l.x < 27.5 && Math.abs(l.y) < 6;
    };
    for (const h of hatches.filter((x) => x.viewId === v1.id)) {
      for (const [a, b] of hatchSheetSegments(doc, h)) {
        expect(bore({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })).toBe(false);
      }
    }
  });

  it('plots the full sheet: frame, title block, parts list, views, annotations', () => {
    const prims = plotSheet(doc, { includeConstruction: false, screenColors: false });
    const texts = prims.filter((p) => p.kind === 'text').map((p) => (p.kind === 'text' ? p.text : ''));
    expect(texts).toEqual(expect.arrayContaining(['Welle', 'Gabelhebel', 'ZA 38', '1', '2']));
    expect(doc.entities.some((e) => e.lineType === 'freehand')).toBe(true);
    const { sheet } = frameGeometry(doc);
    for (const p of prims) {
      if (p.kind === 'polyline') for (const q of p.points) expect(q.x >= -1e-6 && q.x <= sheet.w + 1e-6 && q.y >= -1e-6 && q.y <= sheet.h + 1e-6).toBe(true);
    }
    const svg = sheetToSvg(doc, prims);
    expect(svg).toMatch(/^<svg [^>]*width="210mm" height="297mm"/);
    expect(svg).toContain('>Gabelhebel</text>');
  });
});
