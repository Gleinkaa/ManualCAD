// Imports every DWG/DWT in samples/bbrz and writes the result as .mcad plus an SVG render for a visual check:
//   MCAD_OUT=samples/bbrz-mcad SVG_OUT=/tmp/bbrz-svg npx vitest run scripts/import-samples.test.ts
// Skipped in a normal `npm test`. Lives outside src/ because it needs Node's fs.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { importDwg } from '../src/io';
import { serialize } from '../src/model/doc';
import { plotSheet, sheetToSvg } from '../src/plot';

const SAMPLES = join(__dirname, '..', 'samples');
const WASM = join(__dirname, '..', 'node_modules', '@mlightcad', 'libredwg-web', 'wasm');
const mcadOut = process.env.MCAD_OUT;
const svgOut = process.env.SVG_OUT;

it.skipIf(!mcadOut)('imports the BBRZ DWG files to .mcad and SVG', async () => {
  mkdirSync(mcadOut!, { recursive: true });
  if (svgOut) mkdirSync(svgOut, { recursive: true });
  const dir = join(SAMPLES, 'bbrz');
  for (const file of readdirSync(dir).filter((f: string) => /\.dw[gt]$/.test(f))) {
    const { doc, report } = await importDwg(new Uint8Array(readFileSync(join(dir, file))), { wasmDir: WASM });
    const base = file.replace(/\.dw[gt]$/, '');
    writeFileSync(join(mcadOut!, `${base}.mcad`), serialize(doc));
    if (svgOut) writeFileSync(join(svgOut, `${base}.svg`), sheetToSvg(doc, plotSheet(doc, { includeConstruction: true, screenColors: true })));
    console.log(`${file}\n  ${report.join('\n  ')}`);
  }
}, 120000);
