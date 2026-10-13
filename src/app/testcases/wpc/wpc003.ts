// WPC-003 Deckel, A3 landscape, 1:1 - plan view with the slots, section A-A and detail Z 5:1.
import type { SheetDoc } from '../../../model/types';
import { WpcDoc, loc } from './lib';

const P = (x: number, y: number): { x: number; y: number } => ({ x, y });

export function buildWpc003(): { doc: SheetDoc } {
  const b = new WpcDoc('A3', 'landscape');

  // ---- plan view (main), 1:1 ----
  const main = b.addView('Draufsicht', { origin: { x: 50, y: 60 } });
  b.addGView(main, 'lid.top');
  for (const [x, y] of [[6, 6], [148, 6], [6, 138], [148, 138]] as const) b.centerMark(main, x, y, 5);
  b.cutline(main, 40, 76.5, 214, 76.5, 'A', { x: 0, y: 1 });
  b.leader(main, P(150.2, 8.2), P(165, 30), '4× Ø3,4 durch, Senkung 90° Ø6,6');
  b.leader(main, P(47, 40.5), P(62, 52), 'je 4× Schlitz 33×3, Teilung 8');
  b.leader(main, P(94, 116.5), P(110, 128), '4× Schlitz 34×3, Teilung 10');
  // coordinate chains (the delivered sheet dimensioned from the corner 0/0)
  b.chainH(main, [[0, 0], [6, 0], [14, 0], [47, 0], [60, 0], [94, 0], [107, 0], [140, 0], [148, 0], [154, 0]].map(([x, y]) => P(x, y)), 46);
  b.chainV(main, [[0, 0], [0, 6], [0, 15], [0, 85], [0, 138], [0, 144]].map(([x, y]) => P(x, y)), 36);

  // ---- section A-A, 1:1 ----
  const sec = b.addView('A-A', { origin: { x: 50, y: 198 } });
  const g = b.addGView(sec, 'lid.secA');
  b.hatchGView(sec, g, 45, 2);
  // detail Z marker on the section
  b.circle(sec, 5, 33, 9, 'thin');
  b.textNote(sec, -7, 33, 'Z', 5, 'center', 0, 'middle');

  // ---- detail Z, 5:1 ----
  const det = b.addView('Z', { origin: { x: 255, y: 65 }, scale: 5 });
  const gz = b.addGView(det, 'detail.Z');
  b.hatchGView(det, gz, 45, 3);
  // lip step: heights 2 and 6 from the underside, positions 2,2 and 3,7 from the outer edge
  b.dimV(det, P(2.2, 30), P(0, 32), 235);
  b.dimV(det, P(2.2, 30), P(2, 36), 242);
  b.dimH(det, P(0, 32), P(2.2, 32), 202);
  b.dimH(det, P(0, 32), P(3.7, 32), 195);
  b.leader(det, P(0.6, 35.4), P(-1.2, 38.5), 'R2', { h: 3.5 });
  b.leader(det, P(2.35, 30.15), P(6.8, 27), 'R0,5');

  // ---- notes and collective surface indication ----
  b.notes(main, 230, 170, [
    '1. Schlitze durchgehend; Schlitzenden fertigungsbedingt R1,5 zulässig',
    '2. Schlitzkanten oben R1; Außenkanten oben R2; Ecken senkrecht R2',
    '3. Zentrierlippe 1,5×2 umlaufend, endet 12,5 vor den Außenkanten',
    '4. Lage zu Pos. 1: Lippe mit 0,2 Spiel zur Innenwand',
    '5. Werkstückkanten ISO 13715: −0,3 (entgratet)',
    '6. Oberfläche eloxiert E6/EV1 (DIN 17611), Schichtdicke 10 µm',
    '7. Nicht bemaßte Geometrie nach 3D-Modell (STEP)',
  ]);
  const surfAt = loc(main, 330, 80);
  b.surface(main, surfAt.x, surfAt.y, { roughness: 'Ra 3,2' });
  const surfCol = loc(main, 364, 82);
  b.surface(main, surfCol.x, surfCol.y, { collective: true });

  b.title({
    title: 'Deckel',
    drawingNumber: 'WPC-003',
    scale: '1:1',
    secondaryScale: '5:1',
    material: 'EN AW-6082 T651 (AlSi1MgMn)',
    sheet: '3/4',
    revision: 'A',
    createdBy: 'Gleinkaa',
    date: '2026-10-02',
  });
  return { doc: b.doc };
}
