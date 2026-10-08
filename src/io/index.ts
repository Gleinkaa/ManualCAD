// CONTRACT: drawing interchange. DXF in and out of a SheetDoc; DWG in through a lazily loaded reader.
import type { SheetDoc } from '../model/types';
import { dxfToRaw } from './dxf/entities';
import { writeDxf } from './dxf/write';
import { importDrawing, type ImportOptions, type ImportResult } from './import';

export type { ImportOptions, ImportResult } from './import';
export type { RawDrawing } from './raw';

/** Read an ASCII DXF document (R12 to R2018) into a new sheet. Bytes are decoded by the file's own code page. */
export function importDxf(source: string | Uint8Array, opts?: ImportOptions): ImportResult {
  return importDrawing(dxfToRaw(typeof source === 'string' ? source : decodeDxf(source)), opts);
}

/** DXF before R2007 (AC1021) is code-page text ($DWGCODEPAGE, Windows-1252 for Austria); from R2007 on it is UTF-8. */
export function decodeDxf(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const version = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(head)?.[1] ?? 'AC1009';
  if (version >= 'AC1021') return new TextDecoder('utf-8').decode(bytes);
  const page = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/i.exec(head)?.[1]?.toLowerCase() ?? 'ansi_1252';
  const m = /(\d{3,4})$/.exec(page);
  const label = page.startsWith('ansi') && m ? `windows-${m[1]}` : page.startsWith('dos') && m ? `cp${m[1]}` : page.includes('utf') ? 'utf-8' : 'windows-1252';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Write the sheet as DXF R2000: model space per view (paper = model × scale), a "Sheet" layout with frame and viewports. */
export function exportDxf(doc: SheetDoc): string {
  return writeDxf(doc);
}

/**
 * Read a DWG file (R13 to R2018). The reader is LibreDWG compiled to WebAssembly (GPL-3, ~2 MB compressed),
 * loaded on first use and kept out of the main bundle.
 */
export async function importDwg(bytes: Uint8Array, opts?: ImportOptions & { wasmDir?: string }): Promise<ImportResult> {
  const { dwgToRaw } = await import('./dwg/adapter');
  return importDrawing(await dwgToRaw(bytes, { wasmDir: opts?.wasmDir }), opts);
}
