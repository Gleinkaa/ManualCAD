// WPC-004 Snap-Einsatz, A4 portrait, 5:1 - remade in ManualCAD from the delivered sheet
// (cad_drawings/WaterPumpCase_Zeichnung). View from below (main, first angle) above section A-A;
// hatched section, ISO 129-1 dimensions, BBRZ title block.
import type { SheetDoc } from '../../../model/types';
import { WpcDoc, loc } from './lib';

export function buildWpc004(): { doc: SheetDoc } {
  const b = new WpcDoc('A4', 'portrait');

  // ---- view from below (first angle: placed above the section), 5:1 ----
  const main = b.addView('Ansicht von unten', { origin: { x: 240, y: -5 }, scale: 5 });
  b.addGView(main, 'ins.bottom');
  b.centerCross(main, 105, 230, 60);
  b.cutline(main, 43, 230, 167, 230, 'A', { x: 0, y: 1 });

  // ---- section A-A, 5:1 ----
  const sec = b.addView('A-A', { origin: { x: -30, y: 128.25 }, scale: 5 });
  const g = b.addGView(sec, 'ins.secA');
  b.hatchGView(sec, g, 45, 3);
  // part axis
  b.line(sec, loc(sec, 105, 94).x, loc(sec, 105, 94).y, loc(sec, 105, 141.25).x, loc(sec, 105, 141.25).y, 'center');

  // dimensions (SC = sheet position of a section-local point)
  const SC = (x: number, z: number): { x: number; y: number } => loc(sec, -30 + 5 * x, 128.25 + 5 * z);
  b.dimH(sec, SC(16.3, 2), SC(37.7, 2), 145.25, { prefix: 'SW ', suffix: ' 0/−0,1' });
  b.dimV(sec, SC(37.7, -6.25), SC(37.7, 2), 180.5);
  // heights 4,25 and 6,25 from the underside, drawn from the common datum (stacked as further baselines)
  b.dimV(sec, SC(23.5, -6.25), SC(23.5, -2), 41.5);
  b.dimV(sec, SC(25.5, -6.25), SC(25.5, 0), 34.5);
  b.dimH(sec, SC(23.5, -6.25), SC(30.5, -6.25), 89, { prefix: '⌀', suffix: ' +0,1/0' });
  b.leader(sec, SC(28.5, 0), loc(sec, 162.5, 130.25), 'Ø3');
  b.leader(sec, SC(29.5, -1), loc(sec, 162.5, 115.25), '90°');

  // ---- notes and collective surface indication ----
  b.notes(main, 25, 80, [
    '1. Kanten ISO 13715: −0,3 (entgratet)',
    '2. SW 21,4 passend zu Tasche SW 21,8 in Pos. 1 (WPC-002)',
  ]);
  const surfAt = loc(main, 146, 272);
  b.surface(main, surfAt.x, surfAt.y, { roughness: 'Ra 3,2' });
  const surfCol = loc(main, 180, 274);
  b.surface(main, surfCol.x, surfCol.y, { collective: true });

  b.title({
    title: 'Snap-Einsatz',
    drawingNumber: 'WPC-004',
    scale: '5:1',
    material: 'POM-C (Polyoxymethylen)',
    sheet: '4/4',
    revision: 'A',
    createdBy: 'Gleinkaa',
    date: '2026-10-02',
  });
  return { doc: b.doc };
}
