// The WPC drawing set (water pump case) as ManualCAD sheets, one builder per sheet.
import type { SheetDoc } from '../../../model/types';
import { buildWpc001 } from './wpc001';
import { buildWpc002 } from './wpc002';
import { buildWpc003 } from './wpc003';
import { buildWpc004 } from './wpc004';

export type WpcSheetId = '001' | '002' | '003' | '004';

export function buildWpc(sheet: WpcSheetId): { doc: SheetDoc } {
  switch (sheet) {
    case '001':
      return buildWpc001();
    case '002':
      return buildWpc002();
    case '003':
      return buildWpc003();
    case '004':
      return buildWpc004();
    default:
      throw new Error(`WPC sheet ${sheet} is not built yet`);
  }
}
