// Drawing commands: LINE, CIRCLE, ARC, RECTANG.
import { arcFrom3Points, arcFromCenter, dist } from '../../geom';
import type { Curve, Vec2 } from '../../geom/types';
import type { CommandContext, CommandGen, Preview } from './types';

function lineCurve(a: Vec2, b: Vec2): Curve {
  return { kind: 'line', a, b };
}

export function* line(ctx: CommandContext): CommandGen {
  const first = yield { kind: 'point', prompt: 'Specify first point' };
  if (first.kind !== 'point') return;
  const pts: Vec2[] = [first.p];
  const ids: string[] = [];
  for (;;) {
    const prev = pts[pts.length - 1];
    const options = [{ key: 'U', label: 'Undo' }];
    if (ids.length >= 2) options.unshift({ key: 'C', label: 'Close' });
    const r = yield {
      kind: 'point',
      prompt: 'Specify next point',
      options,
      allowEnter: true,
      base: prev,
      preview: (p) => ({ curves: [{ curve: lineCurve(ctx.local(prev), ctx.local(p)), lineType: ctx.settings.lineType }] }),
    };
    if (r.kind === 'enter') return;
    if (r.kind === 'option' && r.key === 'C') {
      ctx.addEntity(lineCurve(ctx.local(prev), ctx.local(pts[0])));
      return;
    }
    if (r.kind === 'option' && r.key === 'U') {
      const id = ids.pop();
      if (id) {
        ctx.removeEntity(id);
        pts.pop();
      } else {
        ctx.log('All segments already undone.');
      }
      continue;
    }
    if (r.kind !== 'point') continue;
    if (dist(prev, r.p) < 1e-9) {
      ctx.log('Zero-length line ignored.');
      continue;
    }
    ids.push(ctx.addEntity(lineCurve(ctx.local(prev), ctx.local(r.p))).id);
    pts.push(r.p);
  }
}

export function* circle(ctx: CommandContext): CommandGen {
  const r0 = yield { kind: 'point', prompt: 'Specify center point for circle', options: [{ key: '2P', label: '2P' }] };
  const lt = ctx.settings.lineType;
  if (r0.kind === 'option') {
    const a = yield { kind: 'point', prompt: 'Specify first end point of circle\'s diameter' };
    if (a.kind !== 'point') return;
    const two = (p: Vec2): Curve => {
      const la = ctx.local(a.p);
      const lb = ctx.local(p);
      return { kind: 'circle', c: { x: (la.x + lb.x) / 2, y: (la.y + lb.y) / 2 }, r: dist(la, lb) / 2 };
    };
    const b = yield {
      kind: 'point',
      prompt: 'Specify second end point of circle\'s diameter',
      base: a.p,
      preview: (p) => ({ curves: [{ curve: two(p), lineType: lt }] }),
    };
    if (b.kind !== 'point') return;
    const c = two(b.p);
    if (c.kind === 'circle' && c.r > 0) ctx.addEntity(c);
    return;
  }
  if (r0.kind !== 'point') return;
  const center = ctx.local(r0.p);
  let diameter = false;
  for (;;) {
    const r = yield {
      kind: 'point',
      prompt: diameter ? 'Specify diameter of circle' : 'Specify radius of circle',
      options: diameter ? [] : [{ key: 'D', label: 'Diameter' }],
      base: r0.p,
      preview: (p) => ({ curves: [{ curve: { kind: 'circle', c: center, r: dist(center, ctx.local(p)) / (diameter ? 2 : 1) }, lineType: lt }] }),
    };
    if (r.kind === 'option') {
      diameter = true;
      continue;
    }
    if (r.kind !== 'point') return;
    const rad = dist(center, ctx.local(r.p)) / (diameter ? 2 : 1);
    if (rad <= 0) {
      ctx.log('Radius must be positive.');
      continue;
    }
    ctx.addEntity({ kind: 'circle', c: center, r: rad });
    return;
  }
}

export function* arc(ctx: CommandContext): CommandGen {
  const lt = ctx.settings.lineType;
  const r0 = yield { kind: 'point', prompt: 'Specify start point of arc', options: [{ key: 'C', label: 'Center' }] };
  if (r0.kind === 'option') {
    const c = yield { kind: 'point', prompt: 'Specify center point of arc' };
    if (c.kind !== 'point') return;
    const s = yield {
      kind: 'point',
      prompt: 'Specify start point of arc',
      base: c.p,
      preview: (p) => ({ curves: [{ curve: lineCurve(ctx.local(c.p), ctx.local(p)), lineType: 'construction' }] }),
    };
    if (s.kind !== 'point') return;
    const make = (p: Vec2) => arcFromCenter(ctx.local(c.p), ctx.local(s.p), ctx.local(p));
    const e = yield {
      kind: 'point',
      prompt: 'Specify end point of arc (counter-clockwise)',
      base: c.p,
      preview: (p) => (dist(p, c.p) > 1e-9 ? { curves: [{ curve: make(p), lineType: lt }] } : {}),
    };
    if (e.kind !== 'point') return;
    ctx.addEntity(make(e.p));
    return;
  }
  if (r0.kind !== 'point') return;
  const p1 = r0.p;
  const r1 = yield {
    kind: 'point',
    prompt: 'Specify second point of arc',
    base: p1,
    preview: (p) => ({ curves: [{ curve: lineCurve(ctx.local(p1), ctx.local(p)), lineType: 'construction' }] }),
  };
  if (r1.kind !== 'point') return;
  const p2 = r1.p;
  const make = (p: Vec2) => arcFrom3Points(ctx.local(p1), ctx.local(p2), ctx.local(p));
  const r2 = yield {
    kind: 'point',
    prompt: 'Specify end point of arc',
    base: p2,
    preview: (p): Preview => {
      const a = make(p);
      return a ? { curves: [{ curve: a, lineType: lt }] } : {};
    },
  };
  if (r2.kind !== 'point') return;
  const a = make(r2.p);
  if (a) ctx.addEntity(a);
  else ctx.log('Points are collinear, no arc created.');
}

function rectLines(a: Vec2, b: Vec2): Curve[] {
  const c1 = { x: b.x, y: a.y };
  const c2 = { x: a.x, y: b.y };
  return [lineCurve(a, c1), lineCurve(c1, b), lineCurve(b, c2), lineCurve(c2, a)];
}

export function* rectang(ctx: CommandContext): CommandGen {
  const lt = ctx.settings.lineType;
  const r0 = yield { kind: 'point', prompt: 'Specify first corner point' };
  if (r0.kind !== 'point') return;
  const a = ctx.local(r0.p);
  for (;;) {
    const r = yield {
      kind: 'point',
      prompt: 'Specify other corner point',
      options: [{ key: 'D', label: 'Dimensions' }],
      base: r0.p,
      preview: (p) => ({ curves: rectLines(a, ctx.local(p)).map((curve) => ({ curve, lineType: lt })) }),
    };
    let b: Vec2;
    if (r.kind === 'option') {
      const w = yield { kind: 'number', prompt: 'Specify length for rectangles' };
      if (w.kind !== 'number') return;
      const h = yield { kind: 'number', prompt: 'Specify width for rectangles' };
      if (h.kind !== 'number') return;
      b = { x: a.x + w.value, y: a.y + h.value };
    } else if (r.kind === 'point') {
      b = ctx.local(r.p);
    } else {
      return;
    }
    if (Math.abs(b.x - a.x) < 1e-9 || Math.abs(b.y - a.y) < 1e-9) {
      ctx.log('Rectangle has zero size.');
      continue;
    }
    for (const c of rectLines(a, b)) ctx.addEntity(c);
    return;
  }
}
