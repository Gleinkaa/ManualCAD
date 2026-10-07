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
  doc.titleBlock = { ...doc.titleBlock, title: 'Aufbrechen von Werkstück-Details', drawingNumber: 'ZA 38', owner: 'HTL' };
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
  // dimensions
  type('DLI', '0,-14', '40,-17.5', '20,-32');
  type('DLI', '0,-14', '52,-25', '26,-39');
  type('DLI', '0,-14', '136,-7.5', '68,-53');
  type('DLI', '108,-7.5', '136,-7.5', '122,-32');
  type('DLI', '76,-12', '136,-7.5', '106,-39');
  type('DLI', '70,-15', '136,-7.5', '103,-46');
  for (const [x, r, loc] of [[20, 14, '-9,0'], [46, 17.5, '46,0'], [61, 25, '88,0'], [73, 15, '73,0'], [100, 12, '100,0'], [122, 7.5, '146,0']] as const) {
    type('DLI', `${x},${r}`, `${x},${-r}`, 'T', '%%c<>', loc);
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
  type('DLI', '0,15', '35,15', '17,33');
  type('DLI', '53,0', '115,10', '84,-9');
  type('DLI', '0,0', '0,15', '-9,7');
  type('DLI', '115,10', '115,25', '124,17');
  type('DLI', '53,0', '115,25', '132,12');
  type('DAN');
  click(35, 30); // the thin extension line
  click(38, 20); // the slope
  type(`${35 + 14 * Math.cos((75 * Math.PI) / 180)},${15 + 14 * Math.sin((75 * Math.PI) / 180)}`);
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
  type('DLI', '115,-7', '115,7', '124,0');
  type('DLI', '115,-11', '115,11', '131,0');
  type('DLI', '115,-15', '115,15', '138,0');
  type('DDI');
  click(17 + 7 * Math.SQRT1_2, 7 * Math.SQRT1_2);
  type(`${17 + 16 * Math.SQRT1_2},${16 * Math.SQRT1_2}`);

  // parts list: item 1 shaft, item 2 fork lever
  type('BOM', 'A', '', '', 'Welle', '', 'S235JR', '⌀55x140', '');
  type('A', '', '', 'Gabelhebel', '', 'S235JR', 'Fl 40x30x120', '');
  type('');
  if (runner.active) log.push(`error: command still active: ${runner.name}`);
  return { doc, log };
}
