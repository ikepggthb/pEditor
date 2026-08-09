import { TextBuffer, type EditResult } from '../model/textBuffer.ts';
import {
  type Position,
  type TextRange,
  comparePositions,
  pos,
  positionsEqual,
} from '../model/position.ts';
import {
  type Selection,
  selectionAt,
  selectionEnd,
  selectionIsEmpty,
  selectionRange,
  selectionStart,
  selectionsEqual,
} from '../model/selection.ts';
import { History, type EditOrigin } from './history.ts';
import { Highlighter, languageForFilename, languageById } from '../syntax/highlighter.ts';
import type { Language } from '../syntax/types.ts';
import { Metrics } from '../view/metrics.ts';
import { Layout } from '../view/layout.ts';
import { Renderer } from '../view/renderer.ts';

export interface EditorConfig {
  tabSize: number;
  /** Insert spaces for Tab. Off means a literal tab character. */
  insertSpaces: boolean;
  wordWrap: boolean;
  lineNumbers: boolean;
  fontSize: number;
  autoCloseBrackets: boolean;
  autoIndent: boolean;
}

export const DEFAULT_CONFIG: EditorConfig = {
  tabSize: 2,
  insertSpaces: true,
  wordWrap: true,
  lineNumbers: true,
  fontSize: 15,
  autoCloseBrackets: true,
  autoIndent: true,
};

export type EditorEvent = 'change' | 'selection' | 'config' | 'scroll' | 'focus';

type Listener = () => void;

/**
 * The editor component: model, view, and the glue between them.
 *
 * Input handling lives in `input/`, which drives this class through its public
 * methods — that split keeps the awkward parts of mobile text entry (IME,
 * touch, soft keyboards) out of the editing logic.
 */
export class Editor {
  readonly buffer: TextBuffer;
  readonly history = new History();
  readonly metrics = new Metrics();
  readonly layout: Layout;
  readonly renderer: Renderer;
  readonly highlighter: Highlighter;

  config: EditorConfig;

  private sel: Selection = selectionAt(pos(0, 0));
  private composing: TextRange | null = null;
  private listeners = new Map<EditorEvent, Set<Listener>>();
  private renderScheduled = false;
  private pendingScrollToCaret = false;
  private focused = false;
  /** Column the caret aims for while moving vertically through short lines. */
  private goalColumn: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(text = '', config: Partial<EditorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.buffer = new TextBuffer(text);
    this.highlighter = new Highlighter(languageById('plain'));
    this.renderer = new Renderer(this.metrics);
    this.layout = new Layout(this.buffer, this.metrics, {
      tabSize: this.config.tabSize,
      wordWrap: this.config.wordWrap,
    });
  }

  // ---------------------------------------------------------------- lifecycle

  mount(parent: HTMLElement): void {
    parent.appendChild(this.renderer.editor);
    this.applyFontSize();

    this.renderer.scroller.addEventListener('scroll', this.onScroll, { passive: true });

    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(this.renderer.scroller);

    // Web fonts land after first paint; remeasure so the cell grid is right.
    if (document.fonts?.ready) void document.fonts.ready.then(() => this.measure());

    this.measure();
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.renderer.scroller.removeEventListener('scroll', this.onScroll);
    this.renderer.editor.remove();
  }

  private onScroll = (): void => {
    this.scheduleRender();
    this.emit('scroll');
  };

  /** Re-read the character cell size and the available width. */
  measure(): void {
    const metricsChanged = this.metrics.measure(this.renderer.measureProbe);
    const gutter = this.renderer.gutterWidth(this.buffer.lineCount, this.config.lineNumbers);
    const width = Math.max(80, this.renderer.scroller.clientWidth - gutter - 4);
    this.layout.setViewportWidth(width);

    if (metricsChanged) {
      this.layout.invalidateAll();
      this.renderer.invalidateAll();
    }
    this.scheduleRender();
  }

  private applyFontSize(): void {
    this.renderer.editor.style.setProperty('--pe-font-size', `${this.config.fontSize}px`);
  }

  // ------------------------------------------------------------------- events

  on(event: EditorEvent, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  private emit(event: EditorEvent): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) listener();
  }

  // ---------------------------------------------------------------- rendering

  scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (this.pendingScrollToCaret) {
      this.pendingScrollToCaret = false;
      this.performScrollToCaret();
    }
    this.renderer.render({
      buffer: this.buffer,
      layout: this.layout,
      highlighter: this.highlighter,
      selection: this.sel,
      composition: this.composing,
      scrollTop: this.renderer.scroller.scrollTop,
      viewportHeight: this.renderer.scroller.clientHeight,
      focused: this.focused,
      showLineNumbers: this.config.lineNumbers,
    });
  }

  setFocused(value: boolean): void {
    if (this.focused === value) return;
    this.focused = value;
    this.scheduleRender();
    this.emit('focus');
  }

  get isFocused(): boolean {
    return this.focused;
  }

  // ------------------------------------------------------------------ content

  getValue(): string {
    return this.buffer.getText();
  }

  setValue(text: string, filename?: string): void {
    this.buffer.setText(text);
    if (filename) this.highlighter.setLanguage(languageForFilename(filename));
    else this.highlighter.reset();
    this.history.clear();
    this.layout.invalidateAll();
    this.renderer.invalidateAll();
    this.sel = selectionAt(pos(0, 0));
    this.composing = null;
    this.renderer.scroller.scrollTop = 0;
    this.scheduleRender();
    this.emit('change');
    this.emit('selection');
  }

  get language(): Language<any> {
    return this.highlighter.lang;
  }

  setLanguage(id: string): void {
    this.highlighter.setLanguage(languageById(id));
    this.renderer.invalidateAll();
    this.scheduleRender();
    this.emit('config');
  }

  setConfig(patch: Partial<EditorConfig>): void {
    const next = { ...this.config, ...patch };
    const structural =
      next.tabSize !== this.config.tabSize ||
      next.wordWrap !== this.config.wordWrap ||
      next.fontSize !== this.config.fontSize ||
      next.lineNumbers !== this.config.lineNumbers;

    this.config = next;
    this.layout.options.tabSize = next.tabSize;
    this.layout.options.wordWrap = next.wordWrap;
    this.applyFontSize();

    if (structural) {
      this.layout.invalidateAll();
      this.renderer.invalidateAll();
      this.measure();
    }
    this.scheduleRender();
    this.emit('config');
  }

  // ---------------------------------------------------------------- selection

  get selection(): Selection {
    return this.sel;
  }

  get compositionRange(): TextRange | null {
    return this.composing;
  }

  setSelection(next: Selection, options: { scroll?: boolean; resetGoal?: boolean } = {}): void {
    const anchor = this.buffer.clamp(next.anchor);
    const head = this.buffer.clamp(next.head);
    const candidate: Selection = { anchor, head };
    const changed = !selectionsEqual(candidate, this.sel);
    this.sel = candidate;

    if (options.resetGoal !== false) this.goalColumn = null;
    if (options.scroll !== false) this.requestScrollToCaret();
    if (changed) {
      this.history.breakRun();
      this.emit('selection');
    }
    this.scheduleRender();
  }

  setCaret(p: Position, options?: { scroll?: boolean }): void {
    this.setSelection(selectionAt(p), options);
  }

  selectAll(): void {
    this.setSelection({ anchor: pos(0, 0), head: this.buffer.end() });
  }

  get selectedText(): string {
    return this.buffer.getText(selectionRange(this.sel));
  }

  // ------------------------------------------------------------------ editing

  /**
   * The single mutation path. Everything that changes the document goes
   * through here so layout invalidation, highlighting, and undo stay in step.
   */
  edit(range: TextRange, text: string, origin: EditOrigin = 'command'): EditResult {
    const selBefore = this.sel;
    const result = this.buffer.replace(range, text);
    if (result.removed === result.inserted) return result;

    const startLine = result.replaced.from.line;
    const removedLines = result.replaced.to.line - startLine + 1;
    const addedLines = result.insertedRange.to.line - startLine + 1;
    this.layout.linesChanged(startLine, removedLines, addedLines);
    this.highlighter.invalidateFrom(startLine);

    const nextSelection = selectionAt(result.insertedRange.to);
    this.sel = nextSelection;

    if (origin !== 'history') {
      this.history.record(result, selBefore, nextSelection, origin);
    }

    this.goalColumn = null;
    this.requestScrollToCaret();
    this.scheduleRender();
    this.emit('change');
    this.emit('selection');
    return result;
  }

  /** Replace the current selection (or insert at the caret). */
  insert(text: string, origin: EditOrigin = 'input'): void {
    this.edit(selectionRange(this.sel), text, origin);
  }

  undo(): void {
    const restored = this.history.undo((range, text) => this.applyHistoryEdit(range, text));
    if (restored) this.setSelection(restored);
  }

  redo(): void {
    const restored = this.history.redo((range, text) => this.applyHistoryEdit(range, text));
    if (restored) this.setSelection(restored);
  }

  private applyHistoryEdit(range: TextRange, text: string): void {
    this.edit(range, text, 'history');
  }

  // -------------------------------------------------------------- composition

  /**
   * IME composition.
   *
   * The composing text is written straight into the buffer and marked with a
   * range, rather than floated in an overlay. That means wrapping, scrolling
   * and caret placement work during composition with no special cases — which
   * matters because on a phone, composing is most of the typing.
   */
  private compositionOrigin: { range: TextRange; removed: string; selBefore: Selection } | null = null;

  beginComposition(): void {
    if (this.compositionOrigin) return;
    const range = selectionRange(this.sel);
    this.compositionOrigin = {
      range,
      removed: this.buffer.getText(range),
      selBefore: this.sel,
    };
    // Start out covering the selection, so the first update replaces it.
    this.composing = range;
  }

  updateComposition(text: string): void {
    if (!this.compositionOrigin) this.beginComposition();
    const target = this.composing ?? selectionRange(this.sel);
    const result = this.edit(target, text, 'history');
    this.composing = result.insertedRange;
    this.scheduleRender();
  }

  endComposition(text: string): void {
    const origin = this.compositionOrigin;
    const target = this.composing ?? selectionRange(this.sel);
    this.composing = null;
    const result = this.edit(target, text, 'history');
    this.compositionOrigin = null;

    if (origin) {
      // Record the whole composition as one undo step: the text that was there
      // before the IME started, replaced by what it produced.
      this.history.record(
        {
          replaced: origin.range,
          removed: origin.removed,
          inserted: text,
          insertedRange: { from: origin.range.from, to: result.insertedRange.to },
        },
        origin.selBefore,
        selectionAt(result.insertedRange.to),
        'command',
      );
    }
    this.scheduleRender();
  }

  cancelComposition(): void {
    if (!this.compositionOrigin) return;
    const target = this.composing;
    const origin = this.compositionOrigin;
    this.composing = null;
    this.compositionOrigin = null;
    if (target) this.edit(target, origin.removed, 'history');
    this.setSelection(origin.selBefore);
  }

  get isComposing(): boolean {
    return this.compositionOrigin !== null;
  }

  // ----------------------------------------------------------------- movement

  /** Move the caret horizontally by one code point, or collapse a selection. */
  moveHorizontal(dir: 1 | -1, extend: boolean): void {
    if (!extend && !selectionIsEmpty(this.sel)) {
      this.setCaret(dir === -1 ? selectionStart(this.sel) : selectionEnd(this.sel));
      return;
    }
    const head = this.buffer.stepPosition(this.sel.head, dir);
    this.setSelection({ anchor: extend ? this.sel.anchor : head, head });
  }

  /**
   * Move by visual row, keeping the goal column so passing through a short line
   * doesn't drag the caret leftwards permanently.
   */
  moveVertical(dir: 1 | -1, extend: boolean): void {
    const head = this.sel.head;
    const currentRow = this.layout.firstRowOfLine(head.line) + this.layout.rowOfIndex(head.line, head.ch);
    const goal = this.goalColumn ?? this.layout.columnInRow(head.line, head.ch);

    const targetRow = currentRow + dir;
    if (targetRow < 0) {
      this.setSelection({ anchor: extend ? this.sel.anchor : pos(0, 0), head: pos(0, 0) });
      this.goalColumn = goal;
      return;
    }
    if (targetRow >= this.layout.totalRows) {
      const end = this.buffer.end();
      this.setSelection({ anchor: extend ? this.sel.anchor : end, head: end });
      this.goalColumn = goal;
      return;
    }

    const { line, rowInLine } = this.layout.lineAtRow(targetRow);
    const next = this.layout.positionInRow(line, rowInLine, goal * this.metrics.charWidth);
    this.setSelection({ anchor: extend ? this.sel.anchor : next, head: next }, { resetGoal: false });
    this.goalColumn = goal;
  }

  /** Start/end of the visual row — the useful meaning of Home/End when wrapped. */
  moveToRowEdge(edge: 'start' | 'end', extend: boolean): void {
    const head = this.sel.head;
    const info = this.layout.lineLayout(head.line);
    const row = this.layout.rowOfIndex(head.line, head.ch);
    const text = this.buffer.line(head.line);
    const rowStart = info.rowStarts[row];
    const rowEnd = row + 1 < info.rowStarts.length ? info.rowStarts[row + 1] : text.length;

    let target: Position;
    if (edge === 'start') {
      const indent = /^[ \t]*/.exec(text.slice(rowStart))?.[0].length ?? 0;
      // Home toggles between the first non-blank column and column zero.
      const smart = rowStart + indent;
      target = head.ch === smart ? pos(head.line, rowStart) : pos(head.line, Math.min(smart, rowEnd));
    } else {
      target = pos(head.line, rowEnd);
    }
    this.setSelection({ anchor: extend ? this.sel.anchor : target, head: target });
  }

  moveToDocumentEdge(edge: 'start' | 'end', extend: boolean): void {
    const target = edge === 'start' ? pos(0, 0) : this.buffer.end();
    this.setSelection({ anchor: extend ? this.sel.anchor : target, head: target });
  }

  /** One viewport of visual rows. */
  movePage(dir: 1 | -1, extend: boolean): void {
    const rows = Math.max(1, Math.floor(this.renderer.scroller.clientHeight / this.metrics.lineHeight) - 1);
    for (let i = 0; i < rows; i++) this.moveVertical(dir, extend);
  }

  // ----------------------------------------------------------------- scrolling

  requestScrollToCaret(): void {
    this.pendingScrollToCaret = true;
    this.scheduleRender();
  }

  private performScrollToCaret(): void {
    const scroller = this.renderer.scroller;
    const { y } = this.layout.coordsAt(this.sel.head);
    const lineHeight = this.metrics.lineHeight;
    const viewHeight = scroller.clientHeight;
    if (viewHeight <= 0) return;

    const margin = Math.min(lineHeight * 2, Math.max(0, (viewHeight - lineHeight) / 2));
    const top = scroller.scrollTop;

    if (y - margin < top) {
      scroller.scrollTop = Math.max(0, y - margin);
    } else if (y + lineHeight + margin > top + viewHeight) {
      scroller.scrollTop = y + lineHeight + margin - viewHeight;
    }

    if (!this.config.wordWrap) {
      const { x } = this.layout.coordsAt(this.sel.head);
      const left = scroller.scrollLeft;
      const width = scroller.clientWidth - this.renderer.gutterWidth(this.buffer.lineCount, this.config.lineNumbers);
      const pad = this.metrics.charWidth * 4;
      if (x - pad < left) scroller.scrollLeft = Math.max(0, x - pad);
      else if (x + pad > left + width) scroller.scrollLeft = x + pad - width;
    }
  }

  /** Content-space coordinates → document position. */
  positionAtClient(clientX: number, clientY: number): Position {
    const { x, y } = this.renderer.clientToContent(clientX, clientY);
    return this.layout.positionAt(x, y);
  }

  /** Client-space rectangle of the caret, for placing handles and popovers. */
  caretClientRect(p: Position = this.sel.head): { x: number; y: number; height: number } {
    const coords = this.layout.coordsAt(p);
    const client = this.renderer.contentToClient(coords);
    return { x: client.x, y: client.y, height: this.metrics.lineHeight };
  }

  // ------------------------------------------------------------------ helpers

  rangeOfLine(line: number): TextRange {
    return { from: pos(line, 0), to: pos(line, this.buffer.lineLength(line)) };
  }

  /** Whether `p` sits inside the current selection — used for touch hit tests. */
  containsPosition(p: Position): boolean {
    if (selectionIsEmpty(this.sel)) return false;
    const from = selectionStart(this.sel);
    const to = selectionEnd(this.sel);
    return comparePositions(from, p) <= 0 && comparePositions(p, to) <= 0;
  }

  isCaretAt(p: Position): boolean {
    return selectionIsEmpty(this.sel) && positionsEqual(this.sel.head, p);
  }
}
