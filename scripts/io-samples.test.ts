// Import tests against the sample drawings in samples/. Lives outside src/ because it needs Node's fs.
//   npm test                      runs them
//   IO_REPORT=1 npx vitest run scripts/io-samples.test.ts   also prints each file's import report
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importDxf } from '../src/io';

const SAMPLES = join(__dirname, '..', 'samples');
// bytes, not text: R2000 files carry umlauts in Windows-1252 and the importer decodes by code page
const read = (p: string): Uint8Array => new Uint8Array(readFileSync(join(SAMPLES, p)));
const show = (name: string, report: string[]): void => {
  if (process.env.IO_REPORT) console.log(`\n${name}\n  ${report.join('\n  ')}`);
};

describe('importDxf (synthetic part, ezdxf-written)', () => {
  for (const file of ['synthetic/part-r2000.dxf', 'synthetic/part-r2018.dxf']) {
    it(`reads ${file}`, () => {
      const { doc, report } = importDxf(read(file));
      show(file, report);
      // layout 420 x 297 with one 2:1 viewport → A3 landscape, one view at 2:1 plus the sheet view
      expect(doc.format).toBe('A3');
      expect(doc.orientation).toBe('landscape');
      expect(doc.views[0].scale).toBe(2);
      const kinds = new Map<string, number>();
      for (const e of doc.entities) kinds.set(e.lineType, (kinds.get(e.lineType) ?? 0) + 1);
      expect(kinds.get('visible')).toBeGreaterThanOrEqual(7); // outline 5 + circle + arc (+ block circle)
      expect(kinds.get('center')).toBe(2 + 1); // two axes + the block's axis
      expect(kinds.get('hidden')).toBe(1);
      expect(kinds.get('phantom')).toBe(1);
      expect(doc.entities.some((e) => e.geom.kind === 'arc' && Math.abs(e.geom.r - 5) < 1e-6)).toBe(true); // bulge arc of the 0.35 polyline
      const dims = doc.dimensions.map((d) => d.kind).sort();
      expect(dims).toEqual(['angular', 'diameter', 'linear', 'linear', 'linear', 'linear', 'radius']);
      const linear = doc.dimensions.filter((d) => d.kind === 'linear');
      // ezdxf writes its "aligned" dimension as a linear one rotated by 45°: the offset normal then points at 135°
      expect(linear.map((d) => d.orientation)).toEqual(expect.arrayContaining(['horizontal', 'vertical']));
      const rotated = linear.find((d) => typeof d.orientation === 'object')!;
      expect(rotated.orientation).toEqual({ angle: expect.closeTo((3 * Math.PI) / 4, 6) });
      const bottom = linear.find((d) => d.orientation === 'horizontal' && d.offset < 0)!;
      expect(bottom.offset).toBeCloseTo(-24, 6); // 12 mm below at 2:1
      expect(bottom.a.ref).not.toBeNull();
      expect(linear.find((d) => d.text.override === '80 h9')).toBeDefined();
      const hatch = doc.annotations.find((a) => a.kind === 'hatch');
      expect(hatch && hatch.kind === 'hatch' ? hatch.loops.length : 0).toBe(2);
      expect(hatch && hatch.kind === 'hatch' ? hatch.angle : 0).toBeCloseTo(45, 1);
      const texts = doc.annotations.filter((a) => a.kind === 'text').map((t) => (t.kind === 'text' ? t.text : ''));
      expect(texts).toEqual(expect.arrayContaining(['Platte 80x40', 'MITTE', 'Zeile 1', 'Zeile 2 ⌀20 H7', '1']));
      // the paper-space note at (300, 20) sits where ManualCAD draws its title block and is left out
      expect(texts).not.toContain('Sheet text');
      expect(report).toContainEqual(expect.stringMatching(/1 paper-space object.*title block/));
      expect(doc.annotations.find((a) => a.kind === 'leader')).toBeDefined();
      expect(doc.layers.map((l) => l.name)).toEqual(expect.arrayContaining(['0.50', 'Achsen', 'Bemaßung']));
      expect(report[0]).toMatch(/^Imported/);
    });
  }
});

describe('importDxf (BBRZ templates, DWG converted by the ODA File Converter)', () => {
  const dir = join(SAMPLES, 'bbrz-dxf');
  for (const file of readdirSync(dir).filter((f: string) => f.endsWith('.dxf'))) {
    it(`reads ${file}`, () => {
      const { doc, report } = importDxf(read(join('bbrz-dxf', file)));
      show(file, report);
      expect(doc.entities.length + doc.annotations.length).toBeGreaterThan(0);
      expect(report[0]).toMatch(/^Imported/);
    });
  }

  it('fills the title block from the master template attributes', () => {
    const { doc } = importDxf(read('bbrz-dxf/MASTER_MET_JET_23.dxf'));
    expect(doc.format).toBe('A4');
    expect(doc.orientation).toBe('portrait');
    expect(doc.titleBlock.owner).toBe('JET MZ');
    expect(doc.titleBlock.generalTolerance).toBe('ISO 2768-m');
    expect(doc.titleBlock.drawingNumber).toBe('ZA');
  });
});
