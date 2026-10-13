// Writes a WPC sheet as SVG (and optionally the document JSON) for a visual check:
//   WPC_SHEET=004 WPC_SVG=/tmp/wpc004.svg WPC_JSON=/tmp/wpc004.json npx vitest run scripts/render-wpc.test.ts
// Skipped in a normal `npm test`. Lives outside src/ because it needs Node's fs.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { serialize } from '../src/model/doc';
import { buildWpc, type WpcSheetId } from '../src/app/testcases/wpc';
import { plotSheet, sheetToSvg } from '../src/plot';

const sheet = process.env.WPC_SHEET;
const out = process.env.WPC_SVG;
const json = process.env.WPC_JSON;

it.skipIf(!sheet)('renders a WPC sheet', () => {
  const { doc } = buildWpc(sheet as WpcSheetId);
  if (out) writeFileSync(out, sheetToSvg(doc, plotSheet(doc, { includeConstruction: false, screenColors: false })));
  if (json) writeFileSync(json, serialize(doc));
});
