import { describe, expect, it } from 'vitest';
import { applyOrtho, applyPolar, directDistance, parseCoordinate, parseScale, resolveInput } from './input';

describe('parseCoordinate', () => {
  it('parses absolute, relative and polar input', () => {
    expect(parseCoordinate('10,20')).toEqual({ kind: 'absolute', p: { x: 10, y: 20 } });
    expect(parseCoordinate(' -1.5 , .5 ')).toEqual({ kind: 'absolute', p: { x: -1.5, y: 0.5 } });
    expect(parseCoordinate('@5,-3')).toEqual({ kind: 'relative', d: { x: 5, y: -3 } });
    const pol = parseCoordinate('@10<90');
    expect(pol?.kind).toBe('relative');
    if (pol?.kind === 'relative') {
      expect(pol.d.x).toBeCloseTo(0);
      expect(pol.d.y).toBeCloseTo(10);
    }
    const abs = parseCoordinate('2<180');
    expect(abs?.kind).toBe('absolute');
    if (abs?.kind === 'absolute') expect(abs.p.x).toBeCloseTo(-2);
    expect(parseCoordinate('@')).toEqual({ kind: 'relative', d: { x: 0, y: 0 } });
    expect(parseCoordinate('42.5')).toEqual({ kind: 'number', value: 42.5 });
  });

  it('rejects garbage', () => {
    expect(parseCoordinate('')).toBeNull();
    expect(parseCoordinate('abc')).toBeNull();
    expect(parseCoordinate('1,2,3')).toBeNull();
    expect(parseCoordinate('@x,1')).toBeNull();
  });
});

describe('resolveInput', () => {
  it('resolves relative input against the last point', () => {
    expect(resolveInput({ kind: 'relative', d: { x: 1, y: 2 } }, { x: 10, y: 10 }, null, null)).toEqual({ x: 11, y: 12 });
    expect(resolveInput({ kind: 'relative', d: { x: 1, y: 2 } }, null, null, null)).toBeNull();
  });

  it('direct distance goes along the cursor direction', () => {
    const p = resolveInput({ kind: 'number', value: 5 }, null, { x: 0, y: 0 }, { x: 3, y: 4 });
    expect(p!.x).toBeCloseTo(3);
    expect(p!.y).toBeCloseTo(4);
    expect(directDistance({ x: 1, y: 1 }, { x: 1, y: 1 }, 3)).toBeNull();
  });
});

describe('constraints', () => {
  it('ortho keeps the dominant axis', () => {
    expect(applyOrtho({ x: 0, y: 0 }, { x: 10, y: 3 })).toEqual({ x: 10, y: 0 });
    expect(applyOrtho({ x: 5, y: 5 }, { x: 4, y: -20 })).toEqual({ x: 5, y: -20 });
  });

  it('polar snaps to 15° increments within tolerance', () => {
    const a = 46 * (Math.PI / 180);
    const r = applyPolar({ x: 0, y: 0 }, { x: 100 * Math.cos(a), y: 100 * Math.sin(a) }, 15, 3);
    expect(r?.angleDeg).toBe(45);
    expect(r!.p.x).toBeCloseTo(r!.p.y);
    expect(applyPolar({ x: 0, y: 0 }, { x: 100, y: 7 }, 15, 3)).toBeNull();
    expect(applyPolar({ x: 0, y: 0 }, { x: -50, y: -1 }, 15, 3)?.angleDeg).toBe(180);
  });
});

describe('parseScale', () => {
  it('parses ratios and factors', () => {
    expect(parseScale('1:2')).toBe(0.5);
    expect(parseScale('5:1')).toBe(5);
    expect(parseScale('2')).toBe(2);
    expect(parseScale('0:1')).toBeNull();
    expect(parseScale('x')).toBeNull();
  });
});
