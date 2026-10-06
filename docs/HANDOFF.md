# Handoff — drafting-aids review (2026-10-06)

Review of object snaps, polar/ortho, point input and the recent fixes against AutoCAD behaviour, in code and in the running app (Vite dev server driven with Playwright). Base commit `23d1cb8`, branch `master`.

## Current state

- `npm test`: 12 files, 135 tests, all passing. `npm run typecheck` and `npm run build` clean.
- No code changes were made in this review — nothing found was a clear bug in the core aids; everything below is either a small gap or a judgement call (listed with pointers, ready to implement).
- Screenshots: `C:\Users\glein\.playwright-mcp\fable-review-{rubberband,snap-per,polar,overview}.png`.

## Verified working (in the running app, zoom 4 px/mm unless noted)

Object snaps (`src/app/snap.ts`, `src/geom/snap.ts`), with a LINE base point where needed:
- Endpoint, midpoint, intersection (line–line), center, quadrant (circle), nearest — all snap to exact coordinates.
- Perpendicular: onto a line interior (foot (65,0) from (65,30)), onto a circle (near side), onto an arc (foot inside the arc extent).
- Tangent: both tangent points from an external point to a circle.
- Arc endpoint and arc midpoint.
- Across views: in a 1:2 "Top view" linked below the front view, hovering the front view's line endpoint snaps (`endpoint`, converted to top-view local (200,200)); the created entity lands in the top view with the right local coordinates.
- Osnap beats polar and beats ortho when a snap is in the aperture (`app.ts:628-637`).

Snap priority (`SNAP_PRIORITY`, `snap.ts:30-39`): endpoint > intersection > center/midpoint > quadrant > per/tan > nearest, distance breaks ties — behaves as designed; nearest only when nothing else is in the aperture. Side effects are in "Judgement calls" below.

Polar tracking (F10, 15°; `input.ts:69-82`, `app.ts:641-649`):
- Cursor at 31° snaps to the 30° ray, tooltip `Polar: 69.96 < 30°`, dashed track line drawn.
- Typed `50` (direct distance) goes along the polar ray: (0,-60) → (43.30,-35).
- 180° and 0° rays from the new base work; F10 turns ortho off and vice versa (`app.ts:437-453`); restored session also enforces exclusivity (`session.ts:73`).

Ortho (F8; `input.ts:61-63`): dominant axis kept, direct distance along the axis ((0,-60) + `30` → (30,-60)); ortho + snap → snap wins. T-square tracking across views: with ortho on, acquiring the front view's endpoint and moving down into the top view locks x to 220 sheet mm (`Tracking` hint).

Point input (`input.ts`, `runner.ts:206-216`): `x,y`, `@dx,dy`, `@len<angle`, bare number (direct distance) all produce the expected geometry, also at view scale 2 (unit tests `commands.test.ts:27-71`).

Recent fixes:
- TRIM Fence via mouse clicks: fence (15,-8)→(15,8), Enter → `1 object(s) trimmed.`, line (0,0)-(100,0) becomes (30,0)-(100,0); the command returns to "Select object to trim [Fence]".
- Session restore on reload: polar toggle, zoom, pan, current view, 13 entities and the 13-deep undo stack all survive `page.reload()`; UNDO afterwards works.
- Teal rubber band (`#0097a7`, `app.ts:28`) is drawn after the crosshair and stays visible where it crosses it (`fable-review-rubberband.png`).

## Bugs fixed

None (no commits besides this file).

## Open items — small gaps, ready to implement

> **Done 2026-10-06 (branch `feat/za38-partslist`):** all three below.
> 1. New contract export `perpendicularFeet()` (`geom/snap.ts`) returns both feet on circles (arcs: those on the extent); `app/snap.ts` considers each. Test in `snap.test.ts`.
> 2. `allowEnter` on "Specify first fence point"; Enter returns to "Select object to trim/extend". Test in `commands.test.ts`.
> 3. Runner `onEnd` in `app.ts` clears `acquired` and `track` (no unit test — app.ts needs a DOM).

1. **PER onto a circle only offers the near-side foot.** `src/geom/snap.ts:43-47` returns one point; from (100,40) the far foot (169.6,26.1) on the r=20 circle at (150,30) comes back as `nearest`. AutoCAD offers the perpendicular on either side of the diameter. Fix: return both feet for circles (and the antipodal one for arcs when it lies on the arc). `perpendicularFoot` is part of the `geom/index.ts:12` contract — add a `perpendicularFeet(): Vec2[]` export or change the return type and update the single caller `src/app/snap.ts:84`. Add a case to `src/app/snap.test.ts`.
2. **Fence: Enter at "Specify first fence point" cancels the whole TRIM/EXTEND.** `src/app/commands/modify.ts:66` has no `allowEnter`, so `runner.ts:178-179` cancels. AutoCAD returns to "Select object to trim". Fix: `allowEnter: true` on the first prompt, return `null` on `enter` (the caller already `continue`s on null, `modify.ts:152`). Repro: `TR`, Enter, `F`, Enter → `*Cancel*`.
3. **Acquired tracking points never clear.** `src/app/app.ts:83,630-633` keeps the last 4 snapped points across commands, so with ortho on the cursor can lock to points from an earlier command. AutoCAD drops acquired points when the command ends. Fix: clear `acquired` in the runner host `onEnd` (`app.ts:121`).

## Judgement calls (not implemented — need a decision)

A. **PER onto a line's extension is unreachable.** `geom/snap.ts:39-42` computes the foot on the infinite line, but `app/snap.ts:66-68` only generates PER/TAN/NEA for curves whose *segment* is within the aperture of the cursor, and `consider()` (`snap.ts:53-61`) also requires the *foot* to be within the aperture. Beyond the end, the endpoint is then always in the aperture too and wins on rank. Repro: `L`, `103,30`, hover (103,0.3) → `endpoint (100,0)`; hover (110,0.3) with base (110,30) → no snap. AutoCAD semantics are object-based: hovering anywhere on the line shows the PER marker at the foot, even off-segment. Implementing that means relaxing the distance check for PER/TAN (marker may be far from the cursor) and deciding how they rank against NEA.

B. **Tiered priority vs AutoCAD closest-wins.** AutoCAD picks the candidate closest to the cursor (tiers only break ties). The tiers from `329a52a` make lower-ranked snaps unreachable on short curves without zooming: midpoint of a line shorter than 2×aperture (20 px; 6.6 mm at zoom-to-fit of A3 on a 1400 px canvas — a 5 mm and an 8 mm line both gave `endpoint` when hovering their midpoint), PER/TAN on a quarter arc r=20 at 1.67 px/mm (aperture 6 mm covers the whole arc with end/mid points). Options: keep (zoom is the workaround, chamfer case stays solved), hybrid (tier only when candidates are within ~aperture/2 of each other), or Tab cycling through candidates. Numbers: `APERTURE_PX = 10` at `app.ts:24`.

C. **Deferred perpendicular/tangent (PER/TAN as first point) is not supported** — there are no typed osnap overrides at point prompts (`runner.ts:95-150` has no keyword path) and `findSnap` needs a `from` point for PER/TAN (`app/snap.ts:83`). Would need a "deferred" snap kind resolved when the next point arrives.

D. **CEN snap is reachable by hovering the centre itself** (`app/snap.ts:68-71` keeps circle/arc candidates even when the curve is not near). Convenient for training, unlike AutoCAD (hover the circumference). Keep or not.

## Review checklist items not reached

- MIRROR with dimensions in the browser (unit tests pass: `commands.test.ts:170-228`).
- EXTEND Fence in the browser (unit test `commands.test.ts:255-263` passes).
- Tangent from a point to an *arc* (extent filter `geom/snap.ts:59`), quadrant snaps on arcs (my test point coincided with the arc end), intersections line–circle / circle–circle / across views.
- Polar tooltip at view scale ≠ 1 (`app.ts:646` divides by `view.scale`).
- Direct distance with the mouse off-canvas (`runner.ts:213` falls back to +x).
- Dimension anchors from cross-view snaps (`dims.ts:38-43` drops the ref when views differ — by design, not verified).

## How to resume

```
cd D:\dev\ManualCAD
npm test            # vitest, 135 tests
npm run typecheck
npm run dev         # http://localhost:5173 ; window.manualcad is the App in dev builds
```

Driving the app with Playwright: view-local mm → CSS px is
`v = app.doc.views.find(w => w.id === app.settings.currentViewId); s = {x: v.origin.x + x*v.scale, y: v.origin.y + y*v.scale}; d = app.vp.toScreen(s); rect = app.ui.canvas.getBoundingClientRect(); css = {x: rect.x + d.x/devicePixelRatio, y: rect.y + d.y/devicePixelRatio}`, then `page.mouse.move`. Read `app.snapHit`, `app.eff`, `app.hint`, `app.runner.prompt` for state; `app.ui.input.value = '...'; app.submit()` types a command line. Keep hover points inside the canvas (points below the canvas land on the command line and the previous snap silently persists). Note that `localStorage.clear()` followed by `reload()` re-saves the current session on `pagehide`, so toggles from before the clear come back — set a known viewport/toggles explicitly instead.
