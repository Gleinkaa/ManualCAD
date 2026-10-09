// Writes the ZA 38 training sheet as DXF for checks with other CAD software (ezdxf audit, ODA File Converter):
//   DXF_OUT=/path/za38.dxf npx vitest run scripts/export-dxf.test.ts
// Skipped in a normal `npm test`. Lives outside src/ because it needs Node's fs.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { drawZA38 } from '../src/app/testcases/za38';
import { exportDxf } from '../src/io';

const out = process.env.DXF_OUT;

it.skipIf(!out)('writes ZA 38 as DXF', () => {
  const { doc } = drawZA38();
  writeFileSync(out!, exportDxf(doc));
});
