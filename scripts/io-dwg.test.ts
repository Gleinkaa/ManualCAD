// DWG import through the LibreDWG WebAssembly reader, against the BBRZ templates in samples/bbrz.
// Lives outside src/ because it needs Node's fs; the wasm file is read from node_modules.
//   IO_REPORT=1 npx vitest run scripts/io-dwg.test.ts   prints each file's import report
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeDxf, importDwg, importDxf } from '../src/io';
import { dxfToRaw } from '../src/io/dxf/entities';

const SAMPLES = join(__dirname, '..', 'samples');
const WASM = join(__dirname, '..', 'node_modules', '@mlightcad', 'libredwg-web', 'wasm');
const show = (name: string, report: string[]): void => {
  if (process.env.IO_REPORT) console.log(`\n${name}\n  ${report.join('\n  ')}`);
};

/** Attribute definitions with a default text in a DXF file, counted through every block. */
function attdefDefaults(path: string): number {
  const raw = dxfToRaw(decodeDxf(new Uint8Array(readFileSync(path))));
  const count = (es: typeof raw.entities): number => es.filter((e) => e.kind === 'text' && e.tag !== null && e.text.trim() !== '').length;
  let n = count(raw.entities);
  for (const b of raw.blocks.values()) n += count(b.entities);
  return n;
}

describe('importDwg (BBRZ templates)', () => {
  const dir = join(SAMPLES, 'bbrz');
  for (const file of readdirSync(dir).filter((f: string) => /\.dw[gt]$/.test(f))) {
    it(`reads ${file} like the ODA-converted DXF`, async () => {
      const dwg = await importDwg(new Uint8Array(readFileSync(join(dir, file))), { wasmDir: WASM });
      show(file, dwg.report);
      const dxf = importDxf(new Uint8Array(readFileSync(join(SAMPLES, 'bbrz-dxf', file.replace(/\.dw[gt]$/, '.dxf')))));
      expect(dwg.doc.format).toBe(dxf.doc.format);
      expect(dwg.doc.orientation).toBe(dxf.doc.orientation);
      expect(dwg.doc.entities.length).toBe(dxf.doc.entities.length);
      // libredwg-web drops the default value of attribute definitions; the DXF path imports those as text
      const defaults = attdefDefaults(join(SAMPLES, 'bbrz-dxf', file.replace(/\.dw[gt]$/, '.dxf')));
      expect(dwg.doc.annotations.length).toBeLessThanOrEqual(dxf.doc.annotations.length);
      expect(dwg.doc.annotations.length).toBeGreaterThanOrEqual(dxf.doc.annotations.length - defaults);
      expect(dwg.doc.views.length).toBe(dxf.doc.views.length);
      expect(dwg.doc.titleBlock).toEqual(dxf.doc.titleBlock);
    }, 60000);
  }
});

describe('importDwg (synthetic part written by ezdxf, converted to DWG 2018)', () => {
  it('matches the DXF import', async () => {
    const dwg = await importDwg(new Uint8Array(readFileSync(join(SAMPLES, 'synthetic', 'part-r2018.dwg'))), { wasmDir: WASM });
    show('part-r2018.dwg', dwg.report);
    const dxf = importDxf(new Uint8Array(readFileSync(join(SAMPLES, 'synthetic', 'part-r2018.dxf'))));
    expect(dwg.doc.views[0].scale).toBe(2);
    expect(dwg.doc.entities.map((e) => e.lineType).sort()).toEqual(dxf.doc.entities.map((e) => e.lineType).sort());
    // the 2-line angular dimension cannot be read from DWG (see adapter.ts); everything else matches
    expect(dwg.doc.dimensions.map((d) => d.kind).sort()).toEqual(dxf.doc.dimensions.map((d) => d.kind).filter((k) => k !== 'angular').sort());
    expect(dwg.report).toContainEqual(expect.stringMatching(/angular dimension \(leg not readable from DWG\)/));
    expect(dwg.doc.annotations.map((a) => a.kind).sort()).toEqual(dxf.doc.annotations.map((a) => a.kind).sort());
  }, 60000);
});
