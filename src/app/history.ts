// Undo/redo via whole-document JSON snapshots, one per command.
import type { SheetDoc } from '../model/types';

export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  private readonly limit: number;

  constructor(limit = 200) {
    this.limit = limit;
  }

  /** Record `before` (snapshot taken before a command) if the document changed since. Returns true if recorded. */
  commit(before: string, doc: SheetDoc): boolean {
    if (JSON.stringify(doc) === before) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }

  undo(current: SheetDoc): SheetDoc | null {
    const prev = this.undoStack.pop();
    if (prev === undefined) return null;
    this.redoStack.push(JSON.stringify(current));
    return JSON.parse(prev) as SheetDoc;
  }

  redo(current: SheetDoc): SheetDoc | null {
    const next = this.redoStack.pop();
    if (next === undefined) return null;
    this.undoStack.push(JSON.stringify(current));
    return JSON.parse(next) as SheetDoc;
  }

  /** The newest `limit` undo snapshots and the redo stack, for persisting. */
  stacks(limit = this.limit): { undo: string[]; redo: string[] } {
    return { undo: this.undoStack.slice(-limit), redo: this.redoStack.slice(-limit) };
  }

  restore(undo: string[], redo: string[]): void {
    this.undoStack = undo.slice(-this.limit);
    this.redoStack = redo.slice(-this.limit);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

export function snapshot(doc: SheetDoc): string {
  return JSON.stringify(doc);
}
