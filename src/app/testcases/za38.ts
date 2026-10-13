// The ZA 38 exercise (docs/testcases/ZA38.md) drawn through the command line only, the way a student
// types it. Used by the end-to-end test and by scripts/render-za38.test.ts; not imported by the app.
import { newSheet, toSheet } from '../../model/doc';
import type { SheetDoc } from '../../model/types';
import { CommandContext, defaultSettings } from '../commands/types';
import { CommandRunner } from '../runner';
import { pickEntity } from '../selection';

const TAN30 = Math.tan(Math.PI / 6);

function setup(doc: SheetDoc) {
  const log: string[] = [];
  const ctx = new CommandContext(() => doc, defaultSettings(doc), (m) => log.push(m));
  const runner = new CommandRunner(ctx, {
    pick: (p, filter) => pickEntity(doc, p, 1, filter ? (id) => filter(doc.entities.find((e) => e.id === id)!) : undefined),
    hostCommand: () => {},
    takeSelection: () => [],
    onStart: () => {},
    onEnd: () => {},
  });
  const type = (...lines: string[]) => {
    for (const l of lines) runner.text(l);
  };
  /** Click at a point given in the current view's local mm. */
  const click = (x: number, y: number) => runner.click(toSheet(ctx.view(), { x, y }), null);
  return { ctx, runner, type, click, log };
}

export function drawZA38(): { doc: SheetDoc; log: string[] } {
  const doc = newSheet();
  doc.format = 'A4';
  doc.orientation = 'portrait';
  doc.views[0].name = 'Teil 1';
  // Part 1: left end 25 mm from the frame (x0 = 20), axis 40 mm below the top frame line (y1 = 287).
  doc.views[0].origin = { x: 45, y: 247 };
  doc.titleBlock = { ...doc.titleBlock, title: 'Aufbrechen von Werkstück-Details', drawingNumber: 'ZA 38', owner: 'HTL', material: 'S235JR' };
  const { ctx, type, click, runner, log } = setup(doc);
  const lt = (k: string) => type('LT', k);

  // ---------- Part 1: stepped shaft, upper half, then mirrored about the axis ----------
  type('L', '0,0', '0,14', '40,14', '40,17.5', '52,17.5', '52,25', '70,25', '70,15', '76,15', '76,12', '108,12', '108,7.5', '136,7.5', '136,0', '');
  // counterbore ⌀20 × 17, blind bore ⌀13 × 28 with a 120° drill point, cone base edge
  type('L', '0,10', '17,10', '17,6.5', '28,6.5', `${28 + 6.5 / Math.tan(Math.PI / 3)},0`, '');
  type('MIRROR', 'ALL', '', '0,0', '10,0', 'N');
  // recess ⌀42 × 10 in the collar's right face, around the ⌀30 neck: visible in the break-out, hidden below
  type('L', '70,21', '60,21', '60,15', '70,15', '');
  lt('H');
  type('L', '70,-21', '60,-21', '60,-15', '70,-15', '');
  lt('V');
  type('L', '28,6.5', '28,-6.5', '');
  lt('C');
  type('L', '-3,0', '139,0', '');
  lt('V');
  // break-outs: freehand limits, then hatching
  type('SK', '36,14', '33,6', '35,-5', '36,-14', '');
  type('SK', '56,25', '57,20', '60,17', '');
  type('H', '2,12', '64,23', '');
  // notes from the Vorlage (ISO 128-22 leaders): the cut details are dimensioned by note, not by a diameter
  // dimension, because their surfaces sit inside the part. Two rows between the part and the frame: the bore
  // note on the lower row ends before the collar note's leader; the counterbore note on the upper row ends
  // before the top centring mark (sheet x 105), the collar note starts after it. The leaders are near-vertical
  // so none of them runs through the first letters of a note on the row it crosses.
  type('LEADER', 'T', 'A', '7,10', '10,30.5', '', 'Senkung ⌀20 x 17 tief');
  type('LEADER', 'T', 'A', '18,6.5', '19,25.5', '', 'Bohrung ⌀13 x 28 tief');
  type('LEADER', 'T', 'A', '65.5,21', '67,30.5', '', 'Ausdrehung auf ⌀42 x 10 tief');
  // dimensions
  type('DLI', '0,-14', '40,-17.5', '20,-32');
  type('DLI', '0,-14', '52,-25', '26,-39');
  type('DLI', '0,-14', '136,-7.5', '68,-53');
  type('DLI', '108,-7.5', '136,-7.5', '122,-32');
  type('DLI', '76,-12', '136,-7.5', '106,-39');
  type('DLI', '70,-15', '136,-7.5', '103,-46');
  // Diameter dimensions: every ⌀ dimension line crosses the part's centreline, so each value is slid along
  // its line (DLI Text shift) instead of sitting on it, alternating above and below in the order of the
  // dimension lines: ⌀28 below, ⌀35 above, ⌀30 below, ⌀50 above, ⌀24 below, ⌀15 above. 6 mm centres a value in
  // the ⌀24 half-section it stands in (⌀50's line runs through it): 2 mm clear of the axis and of the outline,
  // where 8 mm put ⌀50 and ⌀24 on the ⌀24 outline. ⌀15's line lies beyond the end of the centre line; 2.5 mm
  // keeps it the text gap clear of its own extension line.
  for (const [x, r, loc, shift] of [[20, 14, '-9,0', -6], [46, 17.5, '46,0', 6], [61, 25, '88,0', 6], [73, 15, '73,0', -6], [100, 12, '100,0', -6], [122, 7.5, '146,0', 2.5]] as const) {
    type('DLI', `${x},${r}`, `${x},${-r}`, 'T', '%%c<>', 'S', `${shift}`, loc);
  }
  type('DT', '-12,20', '5', '0', '1', '');

  // ---------- Part 2: front view (unlinked), top view linked below it ----------
  // left end 30 mm from the frame → sheet x 50; bottom face at sheet y 152.5
  type('VIEW', 'N', 'Teil 2', '1:1', 'U', `${50 - 45},${152.5 - 247}`);
  type('VIEW', 'LA'); // a second part is identified by its item number, not a view label
  type('L', '0,0', '53,0', '53,10', '115,10', '115,25', '');
  type('L', '0,0', '0,15', '35,15', `@${10 / Math.cos(Math.PI / 6)}<60`, '115,25', '');
  // counterbore ⌀20 × 8 and hole ⌀14, now visible edges in the break-out
  type('L', '7,15', '7,7', '27,7', '27,15', '');
  type('L', '10,7', '10,0', '');
  type('L', '24,7', '24,0', '');
  // milled recess 4 deep and slot, visible in the second break-out; recess bottom beyond the cut
  type('L', '74,25', '74,21', '78,21', '78,10', '');
  type('L', '78,21', '115,21', '');
  lt('C');
  type('L', '17,-3', '17,18', '');
  lt('T');
  type('L', '35,15', '35,36', ''); // extension line for the 35 and the 30° slope angle
  lt('V');
  type('SK', '32,15', '30,8', '32,0', '');
  type('SK', '66,25', '64,17', '66,10', '');
  type('H', '3,3', '29,3', '70,15', '');
  // notes from the Vorlage for Teil 2's two cuts. The counterbore note cannot stand above the part (the 35 and
  // the 30° fill that space) and at 3.5 mm it does not fit below either: it would cross the 62's extension line
  // (sheet x 103) or the left centring mark (sheet y 148.5). So it is 2.5 mm (ISO 3098 minimum for A4), left
  // of its leader, which comes out of the counterbore through the ⌀14 hole without crossing an edge.
  // TEXT keeps its height for what follows, so set it for each note (an empty TEXT creates nothing).
  type('DT', '0,0', '2.5', '0', '');
  type('LEADER', 'T', 'A', '27,14.8', '15.5,-9', '', 'Senkung ⌀20 x 8 tief');
  type('DT', '0,0', '3.5', '0', '');
  type('LEADER', 'T', 'A', '95,21', '95,34', '', 'Einfräsung 4 tief');
  type('DLI', '0,15', '35,15', '17,33');
  type('DLI', '53,0', '115,10', '84,-9');
  type('DLI', '0,0', '0,15', '-9,7');
  type('DLI', '115,10', '115,25', '124,17');
  type('DLI', '53,0', '115,25', '132,12');
  type('DAN');
  click(35, 30); // the thin extension line
  click(38, 20); // the slope
  // arc radius 10.5: at 14 the value (placed outside, left of the vertical leg) ran into the 35's dimension line
  type(`${35 + 10.5 * Math.cos((75 * Math.PI) / 180)},${15 + 10.5 * Math.sin((75 * Math.PI) / 180)}`);
  type('DT', '-12,30', '5', '0', '2', '');

  // top view: 15 mm gap below the front view → axis at sheet y 120 (= 32.5 below the front view origin)
  type('VIEW', 'N', 'Teil 2 Draufsicht', '1:1', '0,-32.5');
  if (ctx.view().link?.freeAxis !== 'y') log.push('error: top view is not projection-linked below the front view');
  type('L', '0,-17.5', '85,-17.5', '115,-15', '115,-11', '');
  type('L', '0,17.5', '85,17.5', '115,15', '115,11', '');
  type('L', '0,-17.5', '0,17.5', '');
  type('L', '115,-11', '85,-11', '');
  type('L', '115,11', '85,11', '');
  type('L', '115,-7', '85,-7', '');
  type('L', '115,7', '85,7', '');
  type('L', '115,-11', '115,-7', '');
  type('L', '115,7', '115,11', '');
  type('A', 'C', '85,0', '85,11', '85,-11');
  type('A', 'C', '85,0', '85,7', '85,-7');
  type('C', '17,0', '7');
  type('C', '17,0', '10');
  type('L', '35,-17.5', '35,17.5', '');
  type('L', `${35 + 10 * TAN30},-17.5`, `${35 + 10 * TAN30},17.5`, '');
  lt('H');
  type('L', '53,-17.5', '53,17.5', '');
  lt('C');
  type('L', '-3,0', '120,0', '');
  type('L', '17,-13', '17,13', '');
  lt('V');
  type('DLI', '0,-17.5', '0,17.5', '-9,0');
  type('DLI', '0,-17.5', '17,0', '8,-26');
  type('DLI', '85,0', '115,-15', '100,-26');
  type('DLI', '0,-17.5', '115,-15', '57,-34');
  type('DLI', '115,-7', '115,7', 'S', '3.5', '124,0'); // value off the centre line, which reaches x 120
  type('DLI', '115,-11', '115,11', '131,0');
  type('DLI', '115,-15', '115,15', '138,0');
  // ⌀14 at 41°, the value inside the view below its top edge (at 45° and radius 16 it crossed the edge)
  const a14 = (41 * Math.PI) / 180;
  type('DDI');
  click(17 + 7 * Math.cos(a14), 7 * Math.sin(a14));
  type(`${17 + 12.9 * Math.cos(a14)},${12.9 * Math.sin(a14)}`);

  // parts list: item 1 shaft, item 2 fork lever
  type('BOM', 'A', '', '', 'Welle', '', 'S235JR', '⌀55x140', '');
  type('A', '', '', 'Gabelhebel', '', 'S235JR', 'Fl 40x30x120', '');
  type('');
  if (runner.active) log.push(`error: command still active: ${runner.name}`);
  return { doc, log };
}
