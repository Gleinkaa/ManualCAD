// WPC-002 Gehäuseunterteil, A2 landscape, 1:1 - the manufacturing drawing: front, top, left (first
// angle) and rear view D, sections A-A and C-C with hatching, detail Y 5:1 and the coordinate table
// of the 36 boss positions (positions measured from the 0/0 corner, as in the delivered sheet).
import type { SheetDoc } from '../../../model/types';
import { WpcDoc, loc } from './lib';

type Pos = ['A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G', number, number];
const f1 = (v: number): string => v.toFixed(1).replace('.', ',');

export function buildWpc002(): { doc: SheetDoc } {
  const b = new WpcDoc('A2', 'landscape');

  // ---- front view, 1:1 (main) ----
  const front = b.addView('Vorderansicht', { origin: { x: 60, y: 318 } });
  b.addGView(front, 'tray.front');
  b.chainH(front, [0, 14, 47, 62, 92, 107, 140, 154].map((x) => ({ x, y: 32 })), 362);
  // heights from the underside, stacked as further baselines
  b.dimV(front, { x: 14, y: 0 }, { x: 14, y: 9 }, 46);
  b.dimV(front, { x: 14, y: 0 }, { x: 14, y: 21 }, 39);
  b.dimV(front, { x: 0, y: 0 }, { x: 0, y: 32 }, 32);
  b.dimV(front, { x: 92, y: 0 }, { x: 92, y: 7 }, 161);
  b.dimV(front, { x: 92, y: 0 }, { x: 92, y: 15 }, 168);
  b.dimV(front, { x: 140, y: 0 }, { x: 140, y: 9 }, 226);
  b.dimV(front, { x: 140, y: 0 }, { x: 140, y: 21 }, 233);

  // ---- view from the left, 1:1 (u = -y), first angle right of the front view ----
  const left = b.addView('Ansicht von links', { origin: { x: 399, y: 318 }, link: { parent: front, freeAxis: 'y' } });
  b.addGView(left, 'tray.left');
  b.chainH(left, [0, -68, -84, -102, -118, -144].map((y) => ({ x: y, y: 32 })), 362);
  b.dimV(left, { x: -118, y: 0 }, { x: -118, y: 7 }, 245);
  b.dimV(left, { x: -118, y: 0 }, { x: -118, y: 18 }, 238);

  // ---- rear view D, 1:1 (u = -x), moved aside and marked with the view arrow ----
  const rear = b.addView('D', { origin: { x: 574, y: 318 } });
  b.addGView(rear, 'tray.back');
  b.dimH(rear, { x: 0, y: 32 }, { x: -58.4, y: 32 }, 362);
  b.dimH(rear, { x: 0, y: 32 }, { x: -82, y: 32 }, 369);
  b.dimH(rear, { x: 0, y: 32 }, { x: -97, y: 32 }, 376);
  b.dimV(rear, { x: -97, y: 0 }, { x: -97, y: 8 }, 412);
  b.dimV(rear, { x: -97, y: 0 }, { x: -97, y: 17 }, 419);
  b.centerMark(rear, -58.4, 16.1, 9);
  b.dimDia(rear, b.circleAt(rear, -58.4, 16.1), (5 * Math.PI) / 4, 8);
  b.dimV(rear, { x: -58.4, y: 0 }, { x: -58.4, y: 16.1 }, 527.6);

  // ---- top view, 1:1 (first angle below the front view) ----
  const top = b.addView('Draufsicht', { origin: { x: 60, y: 110 }, link: { parent: front, freeAxis: 'x' } });
  b.addGView(top, 'tray.top');
  b.dimH(top, { x: 0, y: 0 }, { x: 154, y: 0 }, 96);
  b.dimV(top, { x: 0, y: 0 }, { x: 0, y: 144 }, 46);
  b.originMark(top, 60, 110);

  // the 36 boss positions of the coordinate table, in the sheet's order
  const POS: Pos[] = [
    ['A', 14.88, 8.98], ['A', 46.01, 8.98], ['A', 107.98, 8.98], ['A', 139.11, 8.98],
    ['A', 14.88, 53.6], ['A', 46.01, 53.6], ['A', 107.98, 53.6], ['A', 139.11, 53.6],
    ['B', 30.07, 66.2], ['B', 30.07, 86.07], ['B', 30.07, 100.2], ['B', 30.07, 120.07],
    ['B', 123.95, 65.95], ['B', 123.95, 85.83], ['B', 123.95, 99.95], ['B', 123.95, 119.83],
    ['C', 9.95, 65.95], ['C', 9.95, 86.05], ['C', 9.95, 99.95], ['C', 9.95, 120.05],
    ['C', 144.05, 65.95], ['C', 144.05, 86.05], ['C', 144.05, 99.95], ['C', 144.05, 120.05],
    ['D', 58.18, 65.16], ['D', 85.05, 65.16], ['D', 99.05, 124.53],
    ['E', 53.05, 125.66],
    ['F', 6, 6], ['F', 148, 6], ['F', 6, 138], ['F', 148, 138],
    ['G', 27, 47], ['G', 127, 47], ['G', 27, 97], ['G', 127, 97],
  ];
  POS.forEach(([t, x, y], i) => {
    if (t !== 'G') b.centerMark(top, x, y, 5.5);
    if (t === 'G') b.textNote(top, x + (x < 77 ? -9 : 9), y - 1.5, String(i + 1), 2.5, 'center', 0, 'bottom');
    else if (t === 'F') {
      const below = y < 72;
      b.textNote(top, x, y + (below ? -y - 2.5 : 146.5 - y), String(i + 1), 2.5, 'center', 0, below ? 'top' : 'bottom');
    } else b.textNote(top, x + 4, y + 2.6, String(i + 1), 2.5, 'left', 0, 'bottom');
  });
  b.cutline(top, 50, 157, 224, 157, 'A', { x: 0, y: 1 });
  b.cutline(top, 50, 118.98, 224, 118.98, 'C', { x: 0, y: 1 });
  b.viewArrow(top, 180, 256, { x: 0, y: -1 }, 'D');

  // ---- section A-A, 1:1 ----
  const secA = b.addView('A-A', { origin: { x: 255, y: 240 } });
  const gA = b.addGView(secA, 'tray.secA');
  b.hatchGView(secA, gA, 45, 2);
  b.dimV(secA, { x: 0, y: 0 }, { x: 0, y: 32 }, 247);
  b.circle(secA, 27, 2, 17, 'thin');
  b.textNote(secA, 13, -14, 'Y', 5, 'center', 0, 'top');
  b.dimH(secA, { x: 152, y: 32 }, { x: 154, y: 32 }, 278);

  // ---- section C-C, 1:1 ----
  const secC = b.addView('C-C', { origin: { x: 255, y: 170 } });
  const gC = b.addGView(secC, 'tray.secC');
  b.hatchGView(secC, gC, 45, 2);
  b.leader(secC, { x: 48.71, y: 9.5 }, { x: 62, y: 22 }, 'Typ A');
  b.leader(secC, { x: 5, y: 26 }, { x: -6, y: 38 }, 'Typ F');

  // ---- detail Y, 5:1 ----
  const det = b.addView('Y', { origin: { x: 198, y: 100 }, scale: 5 });
  const gY = b.addGView(det, 'detail.Y');
  b.hatchGView(det, gY, 45, 3);
  b.dimH(det, { x: 16.1, y: 0 }, { x: 37.9, y: 0 }, 90, { prefix: 'SW ', suffix: ' +0,1/0' });
  b.dimH(det, { x: 14, y: 4 }, { x: 40, y: 4 }, 132, { prefix: 'SW ' });
  b.dimV(det, { x: 16.1, y: 0 }, { x: 16.1, y: 2 }, 245);
  b.dimV(det, { x: 14, y: 0 }, { x: 14, y: 4 }, 238);
  b.leader(det, { x: 13.5, y: 2.5 }, { x: 12.7, y: 5.2 }, 'R1');

  // ---- coordinate table (two columns of 19 rows) ----
  const tableTitle = 'Koordinaten ab 0/0 (Draufsicht), H = Höhe über Unterseite';
  const rows: string[][] = [['Pos', 'Typ', 'X', 'Y'], ...POS.map(([t, x, y], i) => [String(i + 1), t, f1(x), f1(y)])];
  const t1 = loc(top, 420, 302);
  b.textNote(top, t1.x, t1.y, tableTitle, 2.5);
  b.table(top, 420, 300, [12, 12, 22, 22], rows.slice(0, 19), 4.5);
  b.table(top, 500, 300, [12, 12, 22, 22], [rows[0], ...rows.slice(19)], 4.5);

  // ---- boss type list and notes ----
  const TYPES = [
    'A  Dom Ø7 bis H8,2, darauf Ø5,4 bis H10; Gewinde M3×6 tief (Kernloch Ø2,5×7)',
    'B  Dom Ø8 bis H10; Gewinde M3×6 tief (Kernloch Ø2,5×7)',
    'C  Bolzen Ø7 bis H10 (ohne Bohrung)',
    'D  Dom Ø8 bis H7,8, darauf Ø4 bis H10; Gewinde M3×6 tief (Kernloch Ø2,5×7)',
    'E  Dom Ø8 bis H7,8, darauf Zapfen Ø3,6 bis H10',
    'F  Eckpfeiler 10×10 (außen), R2; Gewinde M3×7 tief von oben (Kernloch Ø2,5×8,5)',
    'G  Achtkant-Sockel SW26 bis H4; unten Achtkant-Tasche SW21,8 +0,1 × 2 tief',
  ];
  TYPES.forEach((t, i) => {
    const p = loc(top, 420, 207 - i * 5.2);
    b.textNote(top, p.x, p.y, t, 2.5);
  });
  b.notes(top, 420, 160, [
    '1. Lage Pos. 1–36: Koordinatentabelle; nicht bemaßte Geometrie nach 3D-Modell (STEP)',
    '2. Alle Wanddurchbrüche: Oberkante innen Fase 2×45°',
    '3. Rechte Seitenwand: Durchbrüche wie linke Seite (Ansicht von links)',
    '4. Außenkanten senkrecht R2, Bodenkante außen R1',
    '5. Übergänge Boden/Wand und Boden/Dom innen R1',
    '6. Innenecken Eckpfeiler/Wand senkrecht R3',
    '7. Werkstückkanten ISO 13715: −0,3 (entgratet)',
    '8. Oberfläche eloxiert E6/EV1 (DIN 17611), Schichtdicke 10 µm',
    '9. Wandstärke 2, Bodenstärke 2',
    '10. Gewinde M3 beim Eloxieren abdecken (Stopfen), Gewinde lehrenhaltig 6H',
    '11. Lage = Leiterplatten-Bohrbilder; Tabelle auf 0,1 gerundet, STEP exakt',
  ]);
  const surfAt = loc(top, 500, 82);
  b.surface(top, surfAt.x, surfAt.y, { roughness: 'Ra 3,2' });
  const surfCol = loc(top, 534, 84);
  b.surface(top, surfCol.x, surfCol.y, { collective: true });

  b.title({
    title: 'Gehäuseunterteil',
    drawingNumber: 'WPC-002',
    scale: '1:1',
    secondaryScale: '5:1',
    material: 'EN AW-6082 T651 (AlSi1MgMn)',
    sheet: '2/4',
    revision: 'A',
    createdBy: 'Gleinkaa',
    date: '2026-10-02',
  });
  return { doc: b.doc };
}
