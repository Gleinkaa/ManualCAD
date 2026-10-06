import { describe, expect, it } from 'vitest';
import { Viewport } from './viewport';

describe('Viewport', () => {
  it('round-trips points and keeps the cursor point fixed while zooming', () => {
    const vp = new Viewport();
    vp.resize(800, 600);
    vp.fit(420, 297);
    const s = vp.toSheet(123, 456);
    const back = vp.toScreen(s);
    expect(back.x).toBeCloseTo(123);
    expect(back.y).toBeCloseTo(456);
    vp.zoomAt(123, 456, 1.7);
    const s2 = vp.toSheet(123, 456);
    expect(s2.x).toBeCloseTo(s.x);
    expect(s2.y).toBeCloseTo(s.y);
  });

  it('fit centres the sheet', () => {
    const vp = new Viewport();
    vp.resize(1000, 500);
    vp.fit(420, 297);
    const c = vp.toScreen({ x: 210, y: 148.5 });
    expect(c.x).toBeCloseTo(500);
    expect(c.y).toBeCloseTo(250);
  });
});
