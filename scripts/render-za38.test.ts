// Writes the plotted ZA 38 sheet as SVG for a visual check:
//   ZA38_SVG=/path/za38.svg npx vitest run scripts/render-za38.test.ts
// Skipped in a normal `npm test`. Lives outside src/ because it needs Node's fs.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { drawZA38 } from '../src/app/testcases/za38';
import { plotSheet, sheetToSvg } from '../src/plot';

const out = process.env.ZA38_SVG;

it.skipIf(!out)('renders ZA 38 to SVG', () => {
  const { doc } = drawZA38();
  writeFileSync(out!, sheetToSvg(doc, plotSheet(doc, { includeConstruction: false, screenColors: false })));
});
