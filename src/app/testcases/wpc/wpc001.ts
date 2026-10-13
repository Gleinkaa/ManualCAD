// WPC-001 Wasserpumpengehäuse, A3 landscape - assembly drawing: front and top view 1:1,
// isometric 1:2, balloons (ISO 6433), BBRZ parts list (ISO 7573) and notes.
import type { SheetDoc } from '../../../model/types';
import { WPC } from './geometry.gen';
import { WpcDoc } from './lib';

export function buildWpc001(): { doc: SheetDoc } {
  const b = new WpcDoc('A3', 'landscape');

  // ---- front view, 1:1 ----
  const front = b.addView('Vorderansicht', { origin: { x: 40, y: 205 } });
  b.addGView(front, 'asm.front');
  b.dimV(front, { x: 154, y: -6.25 }, { x: 154, y: 36 }, 216);
  b.dimV(front, { x: 154, y: 0 }, { x: 154, y: 36 }, 206);
  b.balloon(front, { x: 8, y: 14 }, { x: -12, y: 22 }, 1);
  b.balloon(front, { x: 20, y: 35 }, { x: -12, y: 50 }, 2);
  b.balloon(front, { x: 30, y: -4 }, { x: 10, y: -16 }, 3);

  // ---- top view (first angle, below), 1:1 ----
  const top = b.addView('Draufsicht', { origin: { x: 40, y: 30 }, link: { parent: front, freeAxis: 'x' } });
  b.addGView(top, 'asm.top');
  b.dimH(top, { x: 0, y: 144 }, { x: 154, y: 144 }, 182);
  b.dimV(top, { x: 154, y: 0 }, { x: 154, y: 144 }, 204);
  b.balloon(top, { x: 146.5, y: 136.5 }, { x: 130, y: 120 }, 4);

  // ---- isometric 1:2 (pictorial view, placed aside) ----
  const bb = WPC['asm.iso'].bbox;
  const s = 0.5;
  const origin = { x: 320 - s * ((bb[0] + bb[2]) / 2), y: 185 - s * ((bb[1] + bb[3]) / 2) };
  const iso = b.addView('Isometrie', { origin, scale: s, label: false });
  b.addGView(iso, 'asm.iso', 'thin');
  b.textNote(iso, (320 - origin.x) / s, (135 - origin.y) / s, 'Isometrie (1:2)', 3.5, 'center');

  // ---- parts list (ISO 7573, BBRZ columns) ----
  b.doc.partsList = [
    { item: '1', quantity: '1 Stk', name: 'Gehäuseunterteil', standard: 'WPC-002', material: 'EN AW-6082 T651', stock: '', remark: '' },
    { item: '2', quantity: '1 Stk', name: 'Deckel', standard: 'WPC-003', material: 'EN AW-6082 T651', stock: '', remark: '' },
    { item: '3', quantity: '4 Stk', name: 'Snap-Einsatz', standard: 'WPC-004', material: 'POM-C', stock: '', remark: '' },
    { item: '4', quantity: '4 Stk', name: 'Senkschraube M3×10', standard: 'ISO 10642', material: 'A2-70', stock: '', remark: '' },
    { item: '5', quantity: '19 Stk', name: 'Linsenschraube M3×6', standard: 'ISO 7045', material: 'A2-70', stock: '', remark: '' },
  ];

  // ---- notes ----
  b.notes(top, 230, 125, [
    '1. Pos. 3 in Achtkant-Taschen von Pos. 1 einkleben (POM: Loctite 406 + Primer 770)',
    '2. Pos. 4 mit mittelfester Schraubensicherung montieren',
    '3. Pos. 5: Leiterplatten auf Dome Typ A, B, D von Pos. 1 (19×)',
  ]);

  b.title({
    title: 'Wasserpumpengehäuse',
    drawingNumber: 'WPC-001',
    scale: '1:1',
    secondaryScale: '1:2',
    material: 'siehe Stückliste',
    documentType: 'Zusammenbauzeichnung',
    sheet: '1/4',
    revision: 'A',
    createdBy: 'Gleinkaa',
    date: '2026-10-02',
  });
  return { doc: b.doc };
}
