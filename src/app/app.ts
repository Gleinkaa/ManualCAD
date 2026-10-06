// The interactive app: wires DOM events, viewport, snaps, selection and the command runner together.
import { plotDimension } from '../dim';
import { dist } from '../geom';
import type { Vec2 } from '../geom/types';
import { getView, newSheet, parse, serialize, toLocal } from '../model/doc';
import { formatScale, sheetSize } from '../model/standards';
import type { LineGroupId, LineTypeId, Orientation, SheetDoc, SheetFormat } from '../model/types';
import { exportPdf, loadFonts, plotAnnotation, plotCurve, plotSheet, renderCanvas, type PlotOptions, type Primitive } from '../plot';
import { resolveCommand } from './commands';
import { CommandContext, defaultSettings, type AppSettings, type Preview } from './commands/types';
import { History, snapshot } from './history';
import { applyOrtho, applyPolar, fmt } from './input';
import { drawCrosshair, drawMarker, drawSelectionBox, drawSnapMarker, drawTrackLine, drawViewOrigin, tooltip } from './overlay';
import { CommandRunner } from './runner';
import { decodeSession, docHash, encodeSession, PERSISTED_UNDO, type SessionView } from './session';
import { boxSelect, pick, pickEntity } from './selection';
import { findSnap, SNAP_LABELS, type SnapHit } from './snap';
import { buildUI, el, lineTypeLabel, openTitleBlockDialog, setOptions, type UIRefs } from './ui';
import { Viewport } from './viewport';

const AUTOSAVE_KEY = 'manualcad.autosave';
const SESSION_KEY = 'manualcad.session';
const SCREEN: PlotOptions = { includeConstruction: true, screenColors: true };
const APERTURE_PX = 10;
const PICKBOX_PX = 5;
const HIGHLIGHT = '#1e6fd9';
/** Rubber-band preview colour: distinct from every screen line-type colour, selection blue and the crosshair. */
const PREVIEW = '#0097a7';

function loadAutosave(): SheetDoc | null {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    return json ? parse(json) : null;
  } catch {
    return null;
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(doc: SheetDoc): string {
  const base = doc.titleBlock.drawingNumber || doc.titleBlock.title || 'drawing';
  return base.replace(/[\\/:*?"<>|]+/g, '_');
}

export class App {
  doc: SheetDoc;
  readonly settings: AppSettings;
  readonly history = new History();
  readonly ctx: CommandContext;
  readonly runner: CommandRunner;
  readonly vp = new Viewport();
  readonly ui: UIRefs;
  private readonly g: CanvasRenderingContext2D;

  selection: string[] = [];
  snapOn = true;
  orthoOn = false;
  polarOn = false;

  private dpr = 1;
  private mousePx: Vec2 | null = null;
  private raw: Vec2 | null = null;           // sheet mm under the cursor
  private eff: Vec2 | null = null;           // after snap / ortho / polar / tracking
  private snapHit: SnapHit | null = null;
  private hint: string | null = null;        // polar / tracking tooltip
  private track: Vec2[] = [];                // tracking origins drawn as dashed lines
  private acquired: Vec2[] = [];             // snap points acquired for tracking
  private windowStart: { sheet: Vec2; px: Vec2 } | null = null;
  private panning: Vec2 | null = null;
  private lastMiddle = 0;
  private before: string | null = null;
  private prims: Primitive[] | null = null;
  private plotError = false;
  private frame = 0;
  private fitted = false;
  private savedView: SessionView | null = null;
  private sessionTimer = 0;

  constructor(root: HTMLElement) {
    this.ui = buildUI(root);
    this.g = this.ui.canvas.getContext('2d')!;
    this.doc = loadAutosave() ?? newSheet();
    const session = decodeSession(readStorage(SESSION_KEY), this.doc, defaultSettings(this.doc));
    this.settings = session.settings;
    this.snapOn = session.toggles.snap;
    this.orthoOn = session.toggles.ortho;
    this.polarOn = session.toggles.polar;
    this.savedView = session.view;
    if (session.history) this.history.restore(session.history.undo, session.history.redo);
    this.ctx = new CommandContext(() => this.doc, this.settings, (m) => this.log(m), {
      zoomExtents: () => this.zoomExtents(),
      titleBlock: () => this.titleBlock(),
    });
    this.runner = new CommandRunner(this.ctx, {
      pick: (p, filter) => pickEntity(this.doc, p, this.tol(PICKBOX_PX), filter ? (id) => filter(this.doc.entities.find((e) => e.id === id)!) : undefined),
      hostCommand: (name) => this.hostCommand(name),
      takeSelection: () => {
        const s = this.selection;
        this.selection = [];
        return s;
      },
      onStart: () => {
        this.before = snapshot(this.doc);
      },
      onEnd: () => {
        if (this.before !== null) this.history.commit(this.before, this.doc);
        this.before = null;
        this.docChanged();
      },
    });
    this.bind();
    this.log('ManualCAD ready. Type a command (LINE, CIRCLE, TRIM, DIMLINEAR, VIEW, ...) or use the toolbar.');
    this.docChanged();
    void loadFonts().then(() => {
      this.prims = null;
      this.redraw();
    });
  }

  // --- document state ---

  private docChanged(): void {
    this.prims = null;
    const s = this.settings;
    if (!this.doc.views.some((v) => v.id === s.currentViewId)) s.currentViewId = this.doc.views[0]?.id ?? '';
    if (!this.doc.layers.some((l) => l.name === s.layer)) s.layer = this.doc.layers[0]?.name ?? '0';
    const ids = new Set([...this.doc.entities.map((e) => e.id), ...this.doc.dimensions.map((d) => d.id), ...this.doc.annotations.map((a) => a.id)]);
    this.selection = this.selection.filter((id) => ids.has(id));
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialize(this.doc));
    } catch {
      // storage full or unavailable: autosave is best effort
    }
    this.refreshUI();
    this.redraw();
  }

  /** Persist viewport, settings, toggles and undo history (debounced; immediately with `now`). */
  private saveSession(now = false): void {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = 0;
    if (!now) {
      this.sessionTimer = window.setTimeout(() => this.saveSession(true), 400);
      return;
    }
    const vp = this.vp;
    const centre = vp.toSheet(vp.width / 2, vp.height / 2);
    const base = {
      view: this.fitted ? { cx: centre.x, cy: centre.y, zoom: vp.zoom / this.dpr } : this.savedView,
      settings: this.settings,
      toggles: { snap: this.snapOn, ortho: this.orthoOn, polar: this.polarOn },
    };
    const h = this.history.stacks(PERSISTED_UNDO);
    try {
      localStorage.setItem(SESSION_KEY, encodeSession({ ...base, history: { doc: docHash(this.doc), ...h } }));
    } catch {
      try {
        localStorage.setItem(SESSION_KEY, encodeSession({ ...base, history: null }));
      } catch {
        // best effort
      }
    }
  }

  /** An undoable change outside of commands (toolbar, dialogs). */
  mutate(fn: (doc: SheetDoc) => void): void {
    if (this.runner.active) this.runner.cancel();
    const before = snapshot(this.doc);
    fn(this.doc);
    this.history.commit(before, this.doc);
    this.docChanged();
  }

  private replaceDoc(doc: SheetDoc, undoable: boolean): void {
    if (this.runner.active) this.runner.cancel();
    const before = snapshot(this.doc);
    this.doc = doc;
    if (undoable) this.history.commit(before, doc);
    this.selection = [];
    this.docChanged();
  }

  private hostCommand(name: string): void {
    switch (name) {
      case 'UNDO':
      case 'REDO': {
        if (this.runner.active) this.runner.cancel();
        const d = name === 'UNDO' ? this.history.undo(this.doc) : this.history.redo(this.doc);
        if (!d) {
          this.log(name === 'UNDO' ? 'Nothing to undo.' : 'Nothing to redo.');
          return;
        }
        this.doc = d;
        this.selection = [];
        this.log(name === 'UNDO' ? 'Undone.' : 'Redone.');
        this.docChanged();
        return;
      }
      case 'SAVE':
        download(new Blob([serialize(this.doc)], { type: 'application/json' }), `${safeName(this.doc)}.mcad`);
        this.log(`Saved ${safeName(this.doc)}.mcad`);
        return;
      case 'OPEN':
        this.ui.fileInput.value = '';
        this.ui.fileInput.click();
        return;
      case 'NEW':
        this.replaceDoc(newSheet(), true);
        this.settings.lineType = 'visible';
        this.zoomExtents();
        this.log('New drawing (UNDO restores the previous one).');
        return;
      case 'PLOT':
      case 'EXPORTPDF':
        this.log('Creating PDF ...');
        exportPdf(this.doc).then(
          (blob) => {
            download(blob, `${safeName(this.doc)}.pdf`);
            this.log(`Exported ${safeName(this.doc)}.pdf`);
          },
          (err: unknown) => this.log(`PDF export failed: ${err instanceof Error ? err.message : String(err)}`),
        );
        return;
    }
  }

  private titleBlock(): void {
    openTitleBlockDialog(
      this.doc.titleBlock,
      (v) => this.mutate((d) => (d.titleBlock = v)),
      () => this.ui.input.focus(),
    );
  }

  zoomExtents(): void {
    const s = sheetSize(this.doc.format, this.doc.orientation);
    this.vp.fit(s.w, s.h, 0.03);
    this.saveSession();
    this.redraw();
  }

  // --- command line ---

  log(msg: string): void {
    const h = this.ui.history;
    h.append(el('div', {}, msg));
    while (h.childElementCount > 300) h.firstElementChild?.remove();
    h.scrollTop = h.scrollHeight;
  }

  private afterInput(): void {
    this.prims = null;
    this.updateCursor();
    this.refreshPrompt();
    this.redraw();
  }

  /** Run a command line string, e.g. from a toolbar button. */
  run(text: string): void {
    const [cmd, ...rest] = text.split(' ');
    if (this.runner.active) this.runner.cancel();
    const name = resolveCommand(cmd);
    if (!name) return;
    this.log(`Command: ${name}`);
    this.runner.start(name);
    for (const r of rest) this.runner.text(r);
    this.afterInput();
    this.ui.input.focus();
  }

  private submit(): void {
    const text = this.ui.input.value;
    this.ui.input.value = '';
    this.runner.text(text);
    this.afterInput();
  }

  private escape(): void {
    if (this.windowStart) this.windowStart = null;
    else if (this.runner.active) this.runner.cancel();
    else this.selection = [];
    this.ui.input.value = '';
    this.refreshUI();
    this.afterInput();
  }

  // --- UI sync ---

  private refreshPrompt(): void {
    this.ui.prompt.textContent = this.runner.prompt;
  }

  private refreshUI(): void {
    const { ui, doc, settings } = this;
    ui.format.value = doc.format;
    ui.orientation.value = doc.orientation;
    ui.lineGroup.value = doc.lineGroup;
    setOptions(ui.view, doc.views.map((v) => [v.id, `${v.name} (${formatScale(v.scale)})${v.link ? ' ⇄' : ''}`]), settings.currentViewId);
    ui.lineType.value = this.selectedLineType() ?? settings.lineType;
    setOptions(ui.layer, doc.layers.map((l) => [l.name, l.name]), settings.layer);
    ui.layerList.replaceChildren(
      ...doc.layers.map((l) => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = l.visible;
        cb.addEventListener('change', () => this.mutate((d) => {
          const layer = d.layers.find((x) => x.name === l.name);
          if (layer) layer.visible = cb.checked;
        }));
        return el('label', { class: 'mc-layer-item' }, cb, l.name === settings.layer ? `${l.name} (current)` : l.name);
      }),
    );
    ui.toggles.snap.classList.toggle('on', this.snapOn);
    ui.toggles.ortho.classList.toggle('on', this.orthoOn);
    ui.toggles.polar.classList.toggle('on', this.polarOn);
    const v = getView(doc, settings.currentViewId);
    ui.viewInfo.textContent = `${v.name} ${formatScale(v.scale)} · ${doc.format} · LG ${doc.lineGroup} · ${lineTypeLabel(settings.lineType)}`;
    this.refreshPrompt();
    this.saveSession();
  }

  /** Line type shared by all selected entities (shown in the toolbar while something is selected). */
  private selectedLineType(): LineTypeId | null {
    const ents = this.doc.entities.filter((e) => this.selection.includes(e.id));
    if (ents.length === 0) return null;
    return ents.every((e) => e.lineType === ents[0].lineType) ? ents[0].lineType : null;
  }

  // --- events ---

  private bind(): void {
    const { ui } = this;
    ui.format.addEventListener('change', () => this.mutate((d) => (d.format = ui.format.value as SheetFormat)));
    ui.orientation.addEventListener('change', () => this.mutate((d) => (d.orientation = ui.orientation.value as Orientation)));
    ui.lineGroup.addEventListener('change', () => this.mutate((d) => (d.lineGroup = ui.lineGroup.value as LineGroupId)));
    ui.view.addEventListener('change', () => {
      this.settings.currentViewId = ui.view.value;
      this.refreshUI();
      this.redraw();
      ui.input.focus();
    });
    ui.lineType.addEventListener('change', () => {
      const lt = ui.lineType.value as LineTypeId;
      const ids = new Set(this.selection);
      if (this.doc.entities.some((e) => ids.has(e.id))) {
        this.mutate((d) => d.entities.forEach((e) => ids.has(e.id) && (e.lineType = lt)));
        this.log(`Line type of the selection changed to ${lineTypeLabel(lt)}.`);
      } else {
        this.settings.lineType = lt;
        this.refreshUI();
      }
      ui.input.focus();
    });
    ui.layer.addEventListener('change', () => {
      this.settings.layer = ui.layer.value;
      this.refreshUI();
      ui.input.focus();
    });
    ui.layerNew.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.stopPropagation();
      const name = ui.layerNew.value.trim();
      ui.layerNew.value = '';
      if (!name || this.doc.layers.some((l) => l.name === name)) return;
      this.mutate((d) => d.layers.push({ name, visible: true }));
      this.settings.layer = name;
      this.refreshUI();
    });
    for (const b of ui.commandButtons) b.addEventListener('click', () => this.run(b.dataset.cmd!));
    ui.toggles.snap.addEventListener('click', () => this.toggle('snap'));
    ui.toggles.ortho.addEventListener('click', () => this.toggle('ortho'));
    ui.toggles.polar.addEventListener('click', () => this.toggle('polar'));
    ui.fileInput.addEventListener('change', () => {
      const f = ui.fileInput.files?.[0];
      if (!f) return;
      f.text().then(
        (text) => {
          try {
            this.replaceDoc(parse(text), true);
            this.zoomExtents();
            this.log(`Opened ${f.name}`);
          } catch (err) {
            this.log(`Cannot open ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
        () => this.log(`Cannot read ${f.name}`),
      );
    });

    ui.input.addEventListener('keydown', (ev) => this.onInputKey(ev));
    document.addEventListener('keydown', (ev) => this.onGlobalKey(ev));

    const c = ui.canvas;
    c.addEventListener('pointermove', (ev) => this.onMove(ev));
    c.addEventListener('pointerdown', (ev) => this.onDown(ev));
    c.addEventListener('pointerup', (ev) => this.onUp(ev));
    c.addEventListener('pointerleave', () => {
      this.mousePx = null;
      this.redraw();
    });
    c.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      this.runner.enter();
      this.afterInput();
    });
    c.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const p = this.px(ev);
      this.vp.zoomAt(p.x, p.y, Math.pow(1.0015, -ev.deltaY * (ev.deltaMode === 1 ? 33 : 1)));
      this.saveSession();
      this.updateCursor();
      this.redraw();
    }, { passive: false });

    window.addEventListener('pagehide', () => this.saveSession(true));
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && this.saveSession(true));
    new ResizeObserver(() => this.resize()).observe(ui.canvasWrap);
    this.resize();
    ui.input.focus();
  }

  private toggle(which: 'snap' | 'ortho' | 'polar'): void {
    if (which === 'snap') this.snapOn = !this.snapOn;
    if (which === 'ortho') {
      this.orthoOn = !this.orthoOn;
      if (this.orthoOn) this.polarOn = false;
    }
    if (which === 'polar') {
      this.polarOn = !this.polarOn;
      if (this.polarOn) this.orthoOn = false;
    }
    const label = { snap: 'Snap', ortho: 'Ortho', polar: 'Polar' }[which];
    const on = { snap: this.snapOn, ortho: this.orthoOn, polar: this.polarOn }[which];
    this.log(`<${label} ${on ? 'on' : 'off'}>`);
    this.refreshUI();
    this.updateCursor();
    this.redraw();
  }

  private onInputKey(ev: KeyboardEvent): void {
    const input = this.ui.input;
    if (ev.key === 'Enter' || (ev.key === ' ' && !(this.runner.request?.kind === 'text' && input.value.trim() !== ''))) {
      ev.preventDefault();
      ev.stopPropagation();
      this.submit();
    }
  }

  private onGlobalKey(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement | null;
    if (target?.closest('dialog') || target === this.ui.layerNew) return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    const k = ev.key;
    if (k === 'F3' || k === 'F8' || k === 'F10') {
      ev.preventDefault();
      this.toggle(k === 'F3' ? 'snap' : k === 'F8' ? 'ortho' : 'polar');
      return;
    }
    if (k === 'Escape') {
      ev.preventDefault();
      this.escape();
      return;
    }
    if (ctrl && !ev.altKey) {
      const lower = k.toLowerCase();
      const map: Record<string, string> = { z: 'UNDO', y: 'REDO', s: 'SAVE', o: 'OPEN' };
      if (map[lower]) {
        ev.preventDefault();
        this.log(`Command: ${map[lower]}`);
        this.hostCommand(map[lower]);
        this.afterInput();
      }
      return;
    }
    if (k === 'Delete' && this.ui.input.value === '') {
      ev.preventDefault();
      if (!this.runner.active && this.selection.length > 0) this.run('ERASE');
      return;
    }
    if (target !== this.ui.input && !(target instanceof HTMLSelectElement) && !(target instanceof HTMLInputElement)) {
      if (k === 'Enter' || k === ' ') {
        ev.preventDefault();
        this.submit();
        return;
      }
      if (k.length === 1 && !ev.altKey) {
        ev.preventDefault();
        this.ui.input.value += k;
        this.ui.input.focus();
      }
    }
  }

  private px(ev: MouseEvent): Vec2 {
    const r = this.ui.canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * this.dpr, y: (ev.clientY - r.top) * this.dpr };
  }

  private tol(px: number): number {
    return (px * this.dpr) / this.vp.zoom;
  }

  private onMove(ev: PointerEvent): void {
    const p = this.px(ev);
    if (this.panning) {
      this.vp.panBy(p.x - this.panning.x, p.y - this.panning.y);
      this.panning = p;
    }
    this.mousePx = p;
    this.updateCursor();
    this.redraw();
  }

  private onDown(ev: PointerEvent): void {
    const p = this.px(ev);
    this.mousePx = p;
    if (ev.button === 1) {
      ev.preventDefault();
      const now = performance.now();
      if (now - this.lastMiddle < 350) {
        this.zoomExtents();
        this.lastMiddle = 0;
        return;
      }
      this.lastMiddle = now;
      this.panning = p;
      this.ui.canvas.setPointerCapture(ev.pointerId);
      this.ui.canvas.classList.add('panning');
      return;
    }
    if (ev.button !== 0) return;
    this.updateCursor();
    const req = this.runner.request;
    const raw = this.raw!;
    if (req?.kind === 'point') {
      this.runner.click(this.eff!, this.snapHit);
    } else if (req?.kind === 'entity') {
      this.runner.click(raw, null);
    } else if (this.windowStart) {
      this.finishWindow(raw, ev.shiftKey);
    } else {
      const id = pick(this.doc, raw, this.tol(PICKBOX_PX));
      if (id) this.addToSelection([id], ev.shiftKey);
      else this.windowStart = { sheet: raw, px: p };
    }
    this.afterInput();
    this.ui.input.focus();
    ev.preventDefault();
  }

  private onUp(ev: PointerEvent): void {
    if (ev.button === 1 && this.panning) {
      this.panning = null;
      this.saveSession();
      this.ui.canvas.releasePointerCapture(ev.pointerId);
      this.ui.canvas.classList.remove('panning');
      return;
    }
    if (ev.button === 0 && this.windowStart && this.raw) {
      const p = this.px(ev);
      if (dist(p, this.windowStart.px) > 6 * this.dpr) {
        this.finishWindow(this.raw, ev.shiftKey);
        this.afterInput();
      }
    }
  }

  private finishWindow(end: Vec2, remove: boolean): void {
    const ids = boxSelect(this.doc, this.windowStart!.sheet, end);
    this.windowStart = null;
    this.addToSelection(ids, remove);
  }

  private addToSelection(ids: string[], remove: boolean): void {
    if (this.runner.request?.kind === 'selection') {
      const before = this.runner.gathering.length;
      this.runner.addSelection(ids, remove);
      const n = this.runner.gathering.length - before;
      this.log(remove ? `${-n} removed, ${this.runner.gathering.length} total` : `${ids.length} found, ${this.runner.gathering.length} total`);
      return;
    }
    if (remove) this.selection = this.selection.filter((id) => !ids.includes(id));
    else for (const id of ids) if (!this.selection.includes(id)) this.selection.push(id);
    this.refreshUI();
  }

  /** Recompute raw, snapped and constrained cursor positions. */
  private updateCursor(): void {
    this.snapHit = null;
    this.hint = null;
    this.track = [];
    if (!this.mousePx) {
      this.raw = this.eff = null;
      return;
    }
    const raw = this.vp.toSheet(this.mousePx.x, this.mousePx.y);
    this.raw = raw;
    const req = this.runner.request;
    if (req?.kind !== 'point') {
      this.eff = raw;
      this.runner.cursor = raw;
      return;
    }
    const aperture = this.tol(APERTURE_PX);
    const base = req.base ?? null;
    if (this.snapOn) {
      try {
        this.snapHit = findSnap(this.doc, raw, aperture, base);
      } catch {
        this.snapHit = null;
      }
    }
    if (this.snapHit) {
      const sp = this.snapHit.point;
      if (this.snapHit.kind !== 'nearest' && !this.acquired.some((a) => dist(a, sp) < 1e-6)) {
        this.acquired.push(sp);
        if (this.acquired.length > 4) this.acquired.shift();
      }
      this.eff = sp;
      this.runner.cursor = sp;
      return;
    }
    let p = raw;
    if (base && this.orthoOn) {
      p = applyOrtho(base, raw);
    } else if (base && this.polarOn) {
      const r = applyPolar(base, raw, 15, aperture);
      if (r) {
        p = r.p;
        const view = getView(this.doc, this.settings.currentViewId);
        this.hint = `Polar: ${fmt(dist(base, p) / view.scale)} < ${fmt(r.angleDeg, 0)}°`;
        this.track.push(base);
      }
    }
    if (this.orthoOn) p = this.applyTracking(p, base, aperture);
    this.eff = p;
    this.runner.cursor = p;
  }

  /** Align the cursor with acquired snap points of any view (T-square projection). */
  private applyTracking(p: Vec2, base: Vec2 | null, aperture: number): Vec2 {
    const freeX = !base || Math.abs(p.y - base.y) < 1e-9;
    const freeY = !base || Math.abs(p.x - base.x) < 1e-9;
    let q = p;
    for (let i = this.acquired.length - 1; i >= 0; i--) {
      const a = this.acquired[i];
      if (freeX && q === p && Math.abs(p.x - a.x) < aperture && Math.abs(p.y - a.y) > aperture) {
        q = { x: a.x, y: q.y };
        this.track.push(a);
      } else if (freeY && Math.abs(p.y - a.y) < aperture && Math.abs(p.x - a.x) > aperture) {
        q = { x: q.x, y: a.y };
        this.track.push(a);
      }
    }
    if (this.track.length) this.hint = 'Tracking';
    return q;
  }

  // --- rendering ---

  private resize(): void {
    const wrap = this.ui.canvasWrap;
    this.dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(wrap.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(wrap.clientHeight * this.dpr));
    const c = this.ui.canvas;
    if (c.width === w && c.height === h && this.fitted) return;
    // keep the sheet point at the canvas centre fixed when resizing
    const centre = this.fitted ? this.vp.toSheet(this.vp.width / 2, this.vp.height / 2) : null;
    c.width = w;
    c.height = h;
    this.vp.resize(w, h);
    if (!this.fitted) {
      if (this.savedView) {
        this.vp.zoom = this.savedView.zoom * this.dpr;
        this.vp.panX = this.savedView.cx - w / 2 / this.vp.zoom;
        this.vp.panY = this.savedView.cy - h / 2 / this.vp.zoom;
      } else {
        this.zoomExtents();
      }
      this.fitted = true;
    } else if (centre) {
      this.vp.panX = centre.x - w / 2 / this.vp.zoom;
      this.vp.panY = centre.y - h / 2 / this.vp.zoom;
    }
    this.redraw();
  }

  redraw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private sheetPrims(): Primitive[] {
    if (!this.prims) {
      try {
        this.prims = plotSheet(this.doc, SCREEN);
        this.plotError = false;
      } catch (err) {
        if (!this.plotError) this.log(`Plot error: ${err instanceof Error ? err.message : String(err)}`);
        this.plotError = true;
        this.prims = [];
      }
    }
    return this.prims;
  }

  private render(): void {
    const g = this.g;
    const { width: w, height: h } = this.ui.canvas;
    const vp = this.vp;
    const dpr = this.dpr;
    const t = vp.transform();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#6f757c';
    g.fillRect(0, 0, w, h);

    const size = sheetSize(this.doc.format, this.doc.orientation);
    const tl = vp.toScreen({ x: 0, y: size.h });
    const br = vp.toScreen({ x: size.w, y: 0 });
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 12 * dpr;
    g.shadowOffsetX = 3 * dpr;
    g.shadowOffsetY = 3 * dpr;
    g.fillStyle = '#fff';
    g.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    g.restore();

    const pv = this.preview();
    this.draw(this.sheetPrims(), t);
    this.draw(this.highlightPrims(), t);

    // crosshair under the rubber band, so an ortho preview lying on it stays visible
    const req = this.runner.request;
    const cur = this.mousePx && this.eff ? vp.toScreen(this.eff) : null;
    if (cur && this.mousePx) {
      const pickbox = !req || req.kind === 'entity' || req.kind === 'selection' ? PICKBOX_PX * dpr : 0;
      drawCrosshair(g, req?.kind === 'point' ? cur : this.mousePx, w, h, pickbox, dpr);
    }
    this.draw(this.previewPrims(pv), t);

    const view = this.doc.views.find((v) => v.id === this.settings.currentViewId);
    if (view) drawViewOrigin(g, vp.toScreen(view.origin), dpr);
    for (const m of pv?.markers ?? []) drawMarker(g, vp.toScreen(m), dpr);

    if (this.windowStart && this.mousePx) drawSelectionBox(g, vp.toScreen(this.windowStart.sheet), this.mousePx, dpr);

    if (cur) {
      for (const a of this.track) drawTrackLine(g, vp.toScreen(a), cur, dpr);
      if (this.snapHit) drawSnapMarker(g, cur, this.snapHit.kind, SNAP_LABELS[this.snapHit.kind], dpr);
      else if (this.hint) tooltip(g, { x: cur.x + 14 * dpr, y: cur.y + 14 * dpr }, this.hint, dpr);
      this.updateCoords();
    }
  }

  private draw(prims: Primitive[], t: ReturnType<Viewport['transform']>): void {
    if (prims.length === 0) return;
    this.g.save();
    try {
      renderCanvas(this.g, prims, t);
    } catch (err) {
      if (!this.plotError) this.log(`Render error: ${err instanceof Error ? err.message : String(err)}`);
      this.plotError = true;
    }
    this.g.restore();
  }

  private highlightPrims(): Primitive[] {
    const ids = new Set(this.runner.request?.kind === 'selection' ? this.runner.gathering : this.selection);
    if (ids.size === 0) return [];
    const z = this.vp.zoom;
    const out: Primitive[] = [];
    const recolor = (p: Primitive): Primitive => {
      if (p.kind === 'polyline' || p.kind === 'arc') {
        return { ...p, style: { width: Math.max(p.style.width, (2 * this.dpr) / z), dash: [(6 * this.dpr) / z, (4 * this.dpr) / z], dashOffset: 0, color: HIGHLIGHT } };
      }
      if (p.kind === 'text') return { ...p, color: HIGHLIGHT };
      return { ...p, color: HIGHLIGHT };
    };
    try {
      for (const e of this.doc.entities) if (ids.has(e.id)) out.push(...plotCurve(this.doc, e.viewId, e.geom, e.lineType, SCREEN).map(recolor));
      for (const d of this.doc.dimensions) if (ids.has(d.id)) out.push(...plotDimension(this.doc, d).map(recolor));
      for (const a of this.doc.annotations) if (ids.has(a.id)) out.push(...plotAnnotation(this.doc, a, SCREEN).map(recolor));
    } catch {
      return [];
    }
    return out;
  }

  private preview(): Preview | null {
    const req = this.runner.request;
    if (req?.kind !== 'point' || !req.preview || !this.eff || !this.mousePx) return null;
    try {
      return req.preview(this.eff, this.snapHit);
    } catch {
      return null;
    }
  }

  private previewPrims(pv: Preview | null): Primitive[] {
    if (!pv) return [];
    const out: Primitive[] = [];
    try {
      for (const c of pv.curves ?? []) out.push(...plotCurve(this.doc, c.viewId ?? this.settings.currentViewId, c.curve, c.lineType, SCREEN));
      for (const d of pv.dims ?? []) out.push(...plotDimension(this.doc, structuredClone(d)));
      for (const a of pv.annotations ?? []) out.push(...plotAnnotation(this.doc, a, SCREEN));
    } catch {
      // incomplete geometry while rubber-banding
    }
    const minW = (1.5 * this.dpr) / this.vp.zoom;
    return out.map((p) =>
      p.kind === 'polyline' || p.kind === 'arc'
        ? { ...p, style: { ...p.style, width: Math.max(p.style.width, minW), color: PREVIEW } }
        : { ...p, color: PREVIEW },
    );
  }

  private updateCoords(): void {
    if (!this.eff) return;
    const view = getView(this.doc, this.settings.currentViewId);
    const l = toLocal(view, this.eff);
    const req = this.runner.request;
    let text = `${fmt(l.x)}, ${fmt(l.y)}`;
    if (req?.kind === 'point' && req.base) {
      const b = toLocal(view, req.base);
      const d = Math.hypot(l.x - b.x, l.y - b.y);
      const a = (Math.atan2(l.y - b.y, l.x - b.x) * 180) / Math.PI;
      text += `   ${fmt(d)} < ${fmt((a + 360) % 360, 1)}°`;
    }
    this.ui.coords.textContent = text;
  }
}

