import { describe, expect, it } from 'vitest';
import { newSheet } from '../model/doc';
import { defaultSettings } from './commands/types';
import { History, snapshot } from './history';
import { decodeSession, docHash, encodeSession, type Session } from './session';

function sample(): { doc: ReturnType<typeof newSheet>; session: Session } {
  const doc = newSheet();
  doc.views.push({ id: 'v-top', name: 'Top view', scale: 1, origin: { x: 120, y: 60 }, link: null });
  doc.layers.push({ name: 'Hidden', visible: true });
  const settings = { ...defaultSettings(doc), currentViewId: 'v-top', lineType: 'center' as const, layer: 'Hidden', filletRadius: 3, offsetDistance: 5 };
  return {
    doc,
    session: {
      view: { cx: 100, cy: 80, zoom: 3.5 },
      settings,
      toggles: { snap: false, ortho: true, polar: false },
      history: { doc: docHash(doc), undo: ['a', 'b'], redo: ['c'] },
    },
  };
}

describe('session persistence', () => {
  it('round-trips view, settings, toggles and history', () => {
    const { doc, session } = sample();
    const back = decodeSession(encodeSession(session), doc, defaultSettings(doc));
    expect(back).toEqual(session);
  });

  it('falls back to defaults for missing, corrupt or stale data', () => {
    const { doc, session } = sample();
    const defaults = defaultSettings(doc);
    expect(decodeSession(null, doc, defaults).settings).toEqual(defaults);
    expect(decodeSession('{not json', doc, defaults).toggles).toEqual({ snap: true, ortho: false, polar: false });

    const other = newSheet();          // the view and layer no longer exist
    const back = decodeSession(encodeSession(session), other, defaultSettings(other));
    expect(back.settings.currentViewId).toBe('v-front');
    expect(back.settings.layer).toBe('0');
    expect(back.settings.lineType).toBe('center');
    expect(back.history).toBeNull();   // history belongs to a different drawing
  });

  it('rejects unknown line types and bad numbers', () => {
    const { doc, session } = sample();
    const raw = JSON.parse(encodeSession(session));
    raw.settings.lineType = 'zigzag';
    raw.settings.filletRadius = -1;
    raw.view.zoom = 0;
    const back = decodeSession(JSON.stringify(raw), doc, defaultSettings(doc));
    expect(back.settings.lineType).toBe('visible');
    expect(back.settings.filletRadius).toBe(0);
    expect(back.view).toBeNull();
  });
});

describe('History persistence', () => {
  it('restores undo/redo stacks', () => {
    const doc = newSheet();
    const h = new History();
    const before = snapshot(doc);
    doc.format = 'A4';
    h.commit(before, doc);
    const h2 = new History();
    const { undo, redo } = h.stacks();
    h2.restore(undo, redo);
    expect(h2.undo(doc)?.format).toBe('A3');
  });
});
