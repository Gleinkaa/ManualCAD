// The interactive app: wires DOM events, viewport, snaps, selection and the command runner together.
import { plotDimension } from '../dim';
import { dist } from '../geom';
import type { Vec2 } from '../geom/types';
import { getView, newSheet, parse, serialize, toLocal, toSheet } from '../model/doc';
import { formatScale, sheetSize } from '../model/standards';
import type { LineGroupId, LineTypeId, Orientation, SheetDoc, SheetFormat } from '../model/types';
import { exportPdf, frameGeometry, loadFonts, PARTS_LIST, plotAnnotation, plotCurve, plotSheet, renderCanvas, type PlotOptions, type Primitive } from '../plot';
import { resolveCommand, suggestCommands } from './commands';
import { CommandContext, defaultSettings, type AppSettings, type Preview } from './commands/types';
import { History, snapshot } from './history';
import { applyLock, applyOrtho, applyPolar, fmt } from './input';
import { drawCrosshair, drawGrip, drawMarker, drawSelectionBox, drawSnapMarker, drawTrackLine, drawViewOrigin, tooltip } from './overlay';
import { nearestGrip, objectGrips, type Grip } from './grips';
import { CommandRunner } from './runner';
import { decodeSession, docHash, encodeSession, PERSISTED_UNDO, type SessionView } from './session';
import { boxSelect, pick, pickEntity } from './selection';
import { findSnap, SNAP_LABELS, type SnapHit } from './snap';
import { buildUI, el, lineTypeLabel, openHelpDialog, openPartsListDialog, openTitleBlockDialog, setOptions, type UIRefs } from './ui';
import { Viewport } from './viewport';
import { visibleEntities } from './xform';

const AUTOSAVE_KEY = 'manualcad.autosave';
const SESSION_KEY = 'manualcad.session';
const SCREEN: PlotOptions = { includeConstruction: true, screenColors: true };
const APERTURE_PX = 10;
const PICKBOX_PX = 5;
const GRIP_PX = 6;
/** A second pointerdown within this time and distance of the last one is the second click of a double-click. */
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_SLOP_PX = 4;
const HIGHLIGHT = '#1e6fd9';
/** Rollover highlight of the object under the pick box: lighter than the selection, so both are told apart. */
const HOVER = '#6fa3e8';
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
  /** PAN: the left button drags the sheet until Esc or Enter. */
  panMode = false;

  private dpr = 1;
  private mousePx: Vec2 | null = null;
  private raw: Vec2 | null = null;           // sheet mm under the cursor
  private eff: Vec2 | null = null;           // after snap / ortho / polar / tracking
  private snapHit: SnapHit | null = null;
  private hint: string | null = null;        // polar / tracking tooltip
  private track: Vec2[] = [];                // tracking origins drawn as dashed lines
  private acquired: Vec2[] = [];             // snap points acquired for tracking
  private hover: string | null = null;       // object under the pick box (rollover highlight)
  private grips: Grip[] = [];                // grips of the selection while no command runs
  private hotGrip: Grip | null = null;       // grip under the cursor, or the one being dragged
  private hotSet: Grip[] = [];               // grips collected with Shift+click, dragged together
  private windowStart: { sheet: Vec2; px: Vec2 } | null = null;
  private panning: Vec2 | null = null;
  private lastMiddle = 0;
  private lastDown: { t: number; p: Vec2 } | null = null;
  private before: string | null = null;
  private prims: Primitive[] | null = null;
  private plotError = false;
  private frame = 0;
  private fitted = false;
  private savedView: SessionView | null = null;
  private sessionTimer = 0;
  private suggestions: { name: string; alias: string | null; summary: string }[] = [];
  private suggestIndex = -1;
  private statusHint: string | null = null;  // hovered toolbar button

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
      zoomWindow: (a, b) => this.zoomWindow(a, b),
      titleBlock: () => this.titleBlock(),
      partsList: () => this.partsList(),
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
        // AutoCAD drops acquired tracking points when the command ends
        this.acquired = [];
        this.track = [];
        this.hotSet = [];
        this.docChanged();
      },
    });
    this.bind();
    this.log('ManualCAD ready. Type a command (LINE, CIRCLE, HATCH, DIMLINEAR …) or use the toolbar. F1 or ? shows the command reference.');
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
      case 'HELP':
        openHelpDialog(() => this.ui.input.focus());
        return;
      case 'PAN':
        this.panMode = true;
        this.log('Drag with the left mouse button to pan; Esc or Enter ends it.');
        this.refreshUI();
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

  private partsList(): void {
    openPartsListDialog(
      this.doc.partsList,
      (rows) => this.mutate((d) => (d.partsList = rows)),
      () => this.ui.input.focus(),
    );
  }

  /** Double-click (no command running): edit the object under the cursor, or the title block / parts list. */
  private onDoubleClick(ev: MouseEvent): void {
    if (this.runner.active || this.panMode) return;
    const px = this.px(ev);
    const p = this.vp.toSheet(px.x, px.y);
    const id = pick(this.doc, p, this.tol(PICKBOX_PX));
    if (id) {
      const a = this.doc.annotations.find((x) => x.id === id);
      const cmd = a ? (a.kind === 'hatch' ? 'HATCHEDIT' : 'TEXTEDIT') : this.doc.dimensions.some((d) => d.id === id) ? 'DIMEDIT' : null;
      if (cmd) {
        this.selection = [];
        this.log(`Command: ${cmd}`);
        this.runner.start(cmd, [id]);
        this.afterInput();
        this.ui.input.focus();
      }
      return;
    }
    const { titleBlock: tb } = frameGeometry(this.doc);
    if (p.x < tb.x0 || p.x > tb.x1 || p.y < tb.y0) return;
    if (p.y <= tb.y1) this.titleBlock();
    else if (p.y <= tb.y1 + PARTS_LIST.headerHeight + this.doc.partsList.length * PARTS_LIST.rowHeight) this.partsList();
  }

  zoomExtents(): void {
    const s = sheetSize(this.doc.format, this.doc.orientation);
    this.vp.fit(s.w, s.h, 0.03);
    this.saveSession();
    this.redraw();
  }

  zoomWindow(a: Vec2, b: Vec2): void {
    this.vp.fitBox(a, b);
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
    let text = this.ui.input.value;
    // Enter on a partial command name runs the highlighted suggestion (AutoCAD autocomplete).
    if (!this.runner.active && text.trim() && !resolveCommand(text) && this.suggestions.length > 0) {
      text = this.suggestions[Math.max(0, this.suggestIndex)].name;
    }
    this.ui.input.value = '';
    this.clearSuggestions();
    if (!this.runner.text(text)) this.ui.input.value = text.trim();
    this.afterInput();
  }

  private escape(): void {
    if (this.suggestions.length > 0 && this.ui.input.value) {
      this.ui.input.value = '';
      this.clearSuggestions();
      return;
    }
    if (this.windowStart) this.windowStart = null;
    else if (this.hotSet.length > 0) this.hotSet = [];
    else if (this.panMode) this.endPan();
    else if (this.runner.locked) {
      this.runner.lock = { length: null, angleDeg: null };
      this.log('<Lock released>');
    } else if (this.runner.active) this.runner.cancel();
    else this.selection = [];
    this.ui.input.value = '';
    this.clearSuggestions();
    this.refreshUI();
    this.afterInput();
  }

  private endPan(): void {
    this.panMode = false;
    this.panning = null;
    this.ui.canvas.classList.remove('panning');
  }

  // --- autocomplete ---

  private updateSuggestions(): void {
    const text = this.ui.input.value;
    this.suggestions = this.runner.active || !text.trim() ? [] : suggestCommands(text);
    this.suggestIndex = this.suggestions.length > 0 ? 0 : -1;
    this.renderSuggestions();
  }

  private clearSuggestions(): void {
    this.suggestions = [];
    this.suggestIndex = -1;
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    const box = this.ui.suggest;
    box.hidden = this.suggestions.length === 0;
    box.replaceChildren(
      ...this.suggestions.map((s, i) => {
        const row = el('div', { class: `mc-suggest-row${i === this.suggestIndex ? ' active' : ''}` }, el('b', {}, s.name), el('i', {}, s.alias ?? ''), el('span', {}, s.summary));
        row.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          this.ui.input.value = s.name;
          this.clearSuggestions();
          this.submit();
        });
        return row;
      }),
    );
  }

  private moveSuggestion(delta: number): void {
    if (this.suggestions.length === 0) return;
    this.suggestIndex = (this.suggestIndex + delta + this.suggestions.length) % this.suggestions.length;
    this.renderSuggestions();
  }

  // --- UI sync ---

  private refreshPrompt(): void {
    this.ui.prompt.textContent = this.runner.prompt;
    const req = this.runner.request;
    const opts = req?.options ?? [];
    this.ui.chips.replaceChildren(
      ...opts.map((o) => {
        const b = el('button', { type: 'button', class: 'mc-chip', title: `Type ${o.key}` }, o.label);
        b.addEventListener('click', () => {
          this.runner.text(o.key);
          this.afterInput();
          this.ui.input.focus();
        });
        return b;
      }),
    );
    const active = this.runner.name;
    for (const b of this.ui.commandButtons) b.classList.toggle('active', (!!active && b.dataset.cmd?.split(' ')[0] === active) || (this.panMode && b.dataset.cmd === 'PAN'));
    this.ui.hint.textContent = this.statusHint ?? this.defaultHint();
  }

  /** Mouse hint for the current state, shown in the status bar when no toolbar button is hovered. */
  private defaultHint(): string {
    if (this.panMode) return 'Pan: drag with the left button · Esc ends';
    const req = this.runner.request;
    if (!req) {
      if (this.hotSet.length > 0) return `${this.hotSet.length} grip${this.hotSet.length === 1 ? '' : 's'} collected · click one to drag them together · Esc drops them`;
      if (this.selection.length > 0) return 'Drag a blue grip to stretch, Shift+click collects several · Delete erases · Esc clears the selection';
      return this.runner.lastCommand ? `Click to select, drag a window · Enter repeats ${this.runner.lastCommand} · Esc clears` : 'Click to select, drag a window · F1 help';
    }
    switch (req.kind) {
      case 'point':
        if (this.runner.locked) return `${this.runner.lockLabel()} · click or type the other value · Esc releases`;
        return req.base
          ? 'Click a point or type coordinates · 50 = length, <20 or 20° = angle, Tab locks it · right-click = Enter · Esc cancels'
          : 'Click a point or type coordinates · right-click = Enter · Esc cancels';
      case 'entity':
        return 'Click the object · Esc cancels';
      case 'selection':
        return 'Click objects or drag a window, Enter when done · Esc cancels';
      default:
        return 'Type a value, Enter accepts the default · Esc cancels';
    }
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
    this.grips = this.runner.active && this.runner.name !== 'GRIPSTRETCH' ? [] : this.selection.flatMap((id) => objectGrips(doc, id));
    const n = this.runner.request?.kind === 'selection' ? this.runner.gathering.length : this.selection.length;
    ui.selInfo.textContent = n > 0 ? `${n} selected` : '';
    ui.canvas.classList.toggle('panmode', this.panMode);
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
    for (const b of ui.commandButtons) {
      b.addEventListener('click', () => this.run(b.dataset.cmd!));
      b.addEventListener('pointerenter', () => {
        this.statusHint = b.title;
        ui.hint.textContent = b.title;
      });
      b.addEventListener('pointerleave', () => {
        this.statusHint = null;
        ui.hint.textContent = this.defaultHint();
      });
    }
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
    ui.input.addEventListener('input', () => this.updateSuggestions());
    ui.input.addEventListener('blur', () => this.clearSuggestions());
    document.addEventListener('keydown', (ev) => this.onGlobalKey(ev));

    const c = ui.canvas;
    c.addEventListener('pointermove', (ev) => this.onMove(ev));
    c.addEventListener('pointerdown', (ev) => this.onDown(ev));
    c.addEventListener('pointerup', (ev) => this.onUp(ev));
    c.addEventListener('dblclick', (ev) => this.onDoubleClick(ev));
    c.addEventListener('pointerleave', () => {
      this.mousePx = null;
      this.updateCursor(); // drops the snap marker too
      this.redraw();
    });
    c.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      if (this.panMode) {
        this.endPan();
        this.refreshUI();
        return;
      }
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
    if (this.suggestions.length > 0) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        this.moveSuggestion(ev.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (ev.key === 'Tab') {
        ev.preventDefault();
        input.value = this.suggestions[Math.max(0, this.suggestIndex)].name;
        this.moveSuggestion(1);
        return;
      }
    }
    if (ev.key === 'Tab' && input.value.trim() && this.runner.lockText(input.value, 'tab')) {
      // dynamic input: Tab locks the typed length or angle, the mouse sets the other
      ev.preventDefault();
      input.value = '';
      this.clearSuggestions();
      this.afterInput();
      return;
    }
    if (ev.key === 'Enter' || (ev.key === ' ' && !(this.runner.request?.kind === 'text' && input.value.trim() !== ''))) {
      ev.preventDefault();
      ev.stopPropagation();
      if (this.panMode && input.value.trim() === '') {
        this.endPan();
        this.refreshUI();
        return;
      }
      this.submit();
    }
  }

  private onGlobalKey(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement | null;
    if (target?.closest('dialog') || target === this.ui.layerNew) return;
    const ctrl = ev.ctrlKey || ev.metaKey;
    const k = ev.key;
    if (k === 'F1') {
      ev.preventDefault();
      this.hostCommand('HELP');
      return;
    }
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
      } else if (lower === 'a' && !this.runner.active && !(target instanceof HTMLInputElement && target !== this.ui.input)) {
        ev.preventDefault();
        this.selectAll();
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
        if (this.panMode) {
          this.endPan();
          this.refreshUI();
          return;
        }
        this.submit();
        return;
      }
      if (k.length === 1 && !ev.altKey) {
        ev.preventDefault();
        this.ui.input.value += k;
        this.ui.input.focus();
        this.updateSuggestions();
      }
    }
  }

  private selectAll(): void {
    const hidden = new Set(this.doc.layers.filter((l) => !l.visible).map((l) => l.name));
    this.selection = [
      ...visibleEntities(this.doc).map((e) => e.id),
      ...this.doc.dimensions.filter((d) => !hidden.has(d.layer)).map((d) => d.id),
      ...this.doc.annotations.filter((a) => !hidden.has(a.layer)).map((a) => a.id),
    ];
    this.log(`${this.selection.length} selected.`);
    this.refreshUI();
    this.redraw();
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

  private startDragPan(ev: PointerEvent, p: Vec2): void {
    this.panning = p;
    this.ui.canvas.setPointerCapture(ev.pointerId);
    this.ui.canvas.classList.add('panning');
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
      this.startDragPan(ev, p);
      return;
    }
    if (ev.button !== 0) return;
    if (this.panMode) {
      ev.preventDefault();
      this.startDragPan(ev, p);
      return;
    }
    this.updateCursor();
    const now = performance.now();
    const doubleClick = this.lastDown !== null && now - this.lastDown.t < DOUBLE_CLICK_MS && dist(p, this.lastDown.p) <= DOUBLE_CLICK_SLOP_PX * this.dpr;
    this.lastDown = { t: now, p };
    const req = this.runner.request;
    const raw = this.raw!;
    if (req?.kind === 'point') {
      this.runner.click(this.eff!, this.snapHit);
    } else if (req?.kind === 'entity') {
      this.runner.click(raw, null);
    } else if (this.windowStart) {
      this.finishWindow(raw, ev.shiftKey);
    } else if (this.hotGrip && ev.shiftKey) {
      this.toggleHotGrip(this.hotGrip);
    } else if (this.hotGrip && !doubleClick) {
      this.startGripDrag(this.hotGrip);
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
    if ((ev.button === 1 || (ev.button === 0 && this.panMode)) && this.panning) {
      this.panning = null;
      this.saveSession();
      this.ui.canvas.releasePointerCapture(ev.pointerId);
      if (!this.panMode) this.ui.canvas.classList.remove('panning');
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

  private sameGrip(a: Grip, b: Grip): boolean {
    return a.id === b.id && a.kind === b.kind && a.index === b.index;
  }

  /** Shift+click on a grip collects it (and the grips at the same spot) for a joint drag; a second Shift+click drops it. */
  private toggleHotGrip(grip: Grip): void {
    const tol = this.tol(1);
    const spot = this.grips.filter((g) => dist(g.p, grip.p) <= tol);
    const already = this.hotSet.some((g) => this.sameGrip(g, grip));
    this.hotSet = already ? this.hotSet.filter((g) => !spot.some((h) => this.sameGrip(g, h))) : [...this.hotSet, ...spot.filter((g) => !this.hotSet.some((h) => this.sameGrip(g, h)))];
    this.ui.hint.textContent = this.defaultHint();
  }

  /** Click on a grip: every selected grip at the same spot (plus the Shift-collected ones) becomes hot and GRIPSTRETCH asks for the new point. */
  private startGripDrag(grip: Grip): void {
    const tol = this.tol(1);
    const spot = this.grips.filter((g) => dist(g.p, grip.p) <= tol);
    const hot = [...this.hotSet, ...spot.filter((g) => !this.hotSet.some((h) => this.sameGrip(g, h)))];
    this.ctx.grip = { grips: hot, base: grip.p, selection: [...this.selection] };
    this.hotGrip = grip;
    this.log('Command: GRIPSTRETCH');
    this.runner.start('GRIPSTRETCH', []);
    this.refreshUI();
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
      this.refreshUI();
      return;
    }
    if (remove) this.selection = this.selection.filter((id) => !ids.includes(id));
    else for (const id of ids) if (!this.selection.includes(id)) this.selection.push(id);
    this.hotSet = [];
    this.refreshUI();
  }

  /** Recompute raw, snapped and constrained cursor positions, and the rollover object. */
  private updateCursor(): void {
    this.snapHit = null;
    this.hint = null;
    this.track = [];
    this.hover = null;
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
      this.hotGrip = !req && !this.panMode && !this.windowStart && !this.panning ? nearestGrip(this.grips, raw, this.tol(GRIP_PX)) : null;
      if (!this.panMode && !this.windowStart && !this.panning && !this.hotGrip) this.hover = this.rollover(raw);
      return;
    }
    const aperture = this.tol(APERTURE_PX);
    const base = req.base ?? null;
    if (base && this.runner.locked) {
      // dynamic input lock: the typed length/angle wins over snap, ortho and polar
      const view = getView(this.doc, this.settings.currentViewId);
      const lp = applyLock(toLocal(view, base), toLocal(view, raw), this.runner.lock);
      this.eff = lp ? toSheet(view, lp) : raw;
      this.runner.cursor = this.eff;
      this.hint = this.runner.lockLabel();
      this.track.push(base);
      return;
    }
    const only = this.runner.snapOverride ?? undefined;
    if (this.snapOn || only) {
      try {
        this.snapHit = findSnap(this.doc, raw, aperture, base, only);
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

  /** Object under the pick box for rollover highlighting: what a click would pick right now. */
  private rollover(p: Vec2): string | null {
    const req = this.runner.request;
    try {
      if (req?.kind === 'entity') {
        const filter = req.filter;
        return pickEntity(this.doc, p, this.tol(PICKBOX_PX), filter ? (id) => filter(this.doc.entities.find((e) => e.id === id)!) : undefined);
      }
      return pick(this.doc, p, this.tol(PICKBOX_PX));
    } catch {
      return null;
    }
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
    const selected = new Set(this.runner.request?.kind === 'selection' ? this.runner.gathering : this.selection);
    if (this.hover && !selected.has(this.hover)) this.draw(this.highlightPrims(new Set([this.hover]), HOVER), t);
    this.draw(this.highlightPrims(selected, HIGHLIGHT), t);

    // crosshair under the rubber band, so an ortho preview lying on it stays visible
    const req = this.runner.request;
    const cur = this.mousePx && this.eff ? vp.toScreen(this.eff) : null;
    if (cur && this.mousePx && !this.panMode) {
      const pickbox = !req || req.kind === 'entity' || req.kind === 'selection' ? PICKBOX_PX * dpr : 0;
      drawCrosshair(g, req?.kind === 'point' ? cur : this.mousePx, w, h, pickbox, dpr);
    }
    this.draw(this.previewPrims(pv), t);

    const view = this.doc.views.find((v) => v.id === this.settings.currentViewId);
    if (view) drawViewOrigin(g, vp.toScreen(view.origin), dpr);
    for (const m of pv?.markers ?? []) drawMarker(g, vp.toScreen(m), dpr);

    if (this.windowStart && this.mousePx) drawSelectionBox(g, vp.toScreen(this.windowStart.sheet), this.mousePx, dpr);
    const dragging = this.runner.name === 'GRIPSTRETCH' ? this.ctx.grip ?? null : null;
    for (const gr of this.grips) {
      const hot = (this.hotGrip !== null && dist(gr.p, this.hotGrip.p) <= this.tol(1)) || this.hotSet.some((h) => this.sameGrip(h, gr));
      if (dragging && hot) continue; // the dragged grips follow the cursor in the preview
      drawGrip(g, vp.toScreen(gr.p), hot, dpr);
    }

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

  private highlightPrims(ids: Set<string>, color: string): Primitive[] {
    if (ids.size === 0) return [];
    const z = this.vp.zoom;
    const out: Primitive[] = [];
    const recolor = (p: Primitive): Primitive => {
      if (p.kind === 'polyline' || p.kind === 'arc') {
        return { ...p, style: { width: Math.max(p.style.width, (2 * this.dpr) / z), dash: [(6 * this.dpr) / z, (4 * this.dpr) / z], dashOffset: 0, color } };
      }
      return { ...p, color };
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
      const { length, angleDeg } = this.runner.lock;
      text += `   ${fmt(length ?? d)}${length !== null ? ' mm 🔒' : ''} < ${fmt(angleDeg ?? (a + 360) % 360, 1)}°${angleDeg !== null ? ' 🔒' : ''}`;
    }
    this.ui.coords.textContent = text;
  }
}
