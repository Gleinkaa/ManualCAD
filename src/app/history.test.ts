import { describe, expect, it } from 'vitest';
import { newSheet } from '../model/doc';
import { History, snapshot } from './history';

describe('History', () => {
  it('records only changed snapshots and undoes/redoes them', () => {
    const h = new History();
    let doc = newSheet();
    const before = snapshot(doc);
    expect(h.commit(before, doc)).toBe(false);

    doc.lineGroup = '0.7';
    expect(h.commit(before, doc)).toBe(true);
    const b2 = snapshot(doc);
    doc.format = 'A4';
    h.commit(b2, doc);

    doc = h.undo(doc)!;
    expect(doc.format).toBe('A3');
    expect(doc.lineGroup).toBe('0.7');
    doc = h.undo(doc)!;
    expect(doc.lineGroup).toBe('0.5');
    expect(h.undo(doc)).toBeNull();

    doc = h.redo(doc)!;
    expect(doc.lineGroup).toBe('0.7');
    expect(h.canRedo).toBe(true);

    // a new change clears the redo stack
    const b3 = snapshot(doc);
    doc.orientation = 'portrait';
    h.commit(b3, doc);
    expect(h.canRedo).toBe(false);
  });
});
