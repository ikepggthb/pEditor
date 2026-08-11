import type { TextBuffer } from '../model/textBuffer.ts';
import type { Highlighter } from '../syntax/highlighter.ts';
import type { Token } from '../syntax/types.ts';
import type { Selection } from '../model/selection.ts';
import { selectionEnd, selectionIsEmpty, selectionStart } from '../model/selection.ts';
import type { TextRange } from '../model/position.ts';
import type { Layout, LineLayout } from './layout.ts';
import type { Metrics } from './metrics.ts';
import { isWideCodePoint } from './columns.ts';

export interface RenderInput {
  buffer: TextBuffer;
  layout: Layout;
  highlighter: Highlighter;
  selection: Selection;
  /** Range currently being composed by the IME, underlined while it exists. */
  composition: TextRange | null;
  scrollTop: number;
  viewportHeight: number;
  focused: boolean;
  showLineNumbers: boolean;
}

/** Rows that must be painted beyond the viewport before a repaint is forced. */
const VIEW_MARGIN = 2;
/** Rows painted beyond that, giving a flick room to run without touching DOM. */
const OVERSCAN = 24;

function escapeHtml(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else out += ch;
  }
  return out;
}

/**
 * Paints the document.
 *
 * Two invariants hold everything together, and `layout.ts` depends on both:
 * every character occupies a whole number of `charWidth` cells, and every visual
 * row is exactly `lineHeight` tall. Tabs get explicit padding and wide (CJK)
 * runs get an explicit pixel width, so the browser can never disagree with the
 * layout's arithmetic about where column 37 is.
 */
export class Renderer {
  readonly editor: HTMLDivElement;
  readonly scroller: HTMLDivElement;
  readonly sizer: HTMLDivElement;
  readonly gutter: HTMLDivElement;
  readonly content: HTMLDivElement;
  readonly selectionLayer: HTMLDivElement;
  readonly linesLayer: HTMLDivElement;
  readonly caret: HTMLDivElement;
  readonly measureProbe: HTMLDivElement;

  /** Live line elements, keyed by document line. */
  private lineElements = new Map<number, HTMLDivElement>();
  private gutterElements = new Map<number, HTMLDivElement>();
  private pool: HTMLDivElement[] = [];
  private gutterPool: HTMLDivElement[] = [];
  private lastGutterWidth = -1;
  /** Last written value per element+property, to skip no-op style writes. */
  private styleCache = new WeakMap<HTMLElement, Map<string, string>>();
  /** The band of lines currently in the DOM. */
  private painted = { first: 0, last: -1, state: '' };
  private activeLine = -1;
  private lastCaretTransform = '';
  private lastScrollLeft = 0;

  private readonly metrics: Metrics;

  constructor(metrics: Metrics) {
    this.metrics = metrics;
    this.editor = el('div', 'pe-editor');
    this.gutter = el('div', 'pe-gutter');
    this.scroller = el('div', 'pe-scroller');
    this.sizer = el('div', 'pe-sizer');
    this.content = el('div', 'pe-content');
    this.selectionLayer = el('div', 'pe-selection-layer');
    this.linesLayer = el('div', 'pe-lines');
    this.caret = el('div', 'pe-caret');
    this.measureProbe = el('div', 'pe-measure');

    this.content.append(this.selectionLayer, this.linesLayer, this.caret);
    this.sizer.append(this.gutter, this.content);
    this.scroller.append(this.sizer);
    this.editor.append(this.scroller, this.measureProbe);
  }

  /**
   * Whether scrolling to this offset would change anything on screen.
   *
   * When it would not — the common case mid-flick, because the painted band
   * extends well past the viewport — the caller can skip the render entirely
   * and leave the frame to the compositor.
   */
  scrollNeedsRepaint(input: Omit<RenderInput, 'selection' | 'composition' | 'focused'>): boolean {
    if (this.scroller.scrollLeft !== this.lastScrollLeft) return true;

    const lineHeight = this.metrics.lineHeight;
    const topRow = Math.floor(input.scrollTop / lineHeight);
    const bottomRow = Math.ceil((input.scrollTop + input.viewportHeight) / lineHeight);
    const totalRows = input.layout.totalRows;
    const first = input.layout.lineAtRow(Math.max(0, topRow - VIEW_MARGIN)).line;
    const last = input.layout.lineAtRow(Math.min(totalRows, bottomRow + VIEW_MARGIN)).line;
    return !(
      this.paintedState(input) === this.painted.state &&
      first >= this.painted.first &&
      last <= this.painted.last
    );
  }

  private paintedState(input: { layout: Layout; buffer: TextBuffer; showLineNumbers: boolean }): string {
    return `${input.layout.generation}:${input.buffer.version}:${input.showLineNumbers}`;
  }

  /** Width reserved for the line-number gutter, in pixels. */
  gutterWidth(lineCount: number, show: boolean): number {
    if (!show) return Math.round(this.metrics.charWidth);
    const digits = Math.max(2, String(lineCount).length);
    return Math.round((digits + 2) * this.metrics.charWidth);
  }

  /**
   * Drop one cached style value, for when something outside the renderer has
   * written that property directly (the pinch gesture does, on the gutter).
   */
  forgetStyle(node: HTMLElement, property: string): void {
    this.styleCache.get(node)?.delete(property);
  }

  /** Write a style only when it changed; every write costs a style recalc. */
  private setStyle(node: HTMLElement, property: string, value: string): void {
    if (this.styleCache.get(node)?.get(property) === value) return;
    let forNode = this.styleCache.get(node);
    if (!forNode) {
      forNode = new Map();
      this.styleCache.set(node, forNode);
    }
    forNode.set(property, value);
    if (property.startsWith('--')) node.style.setProperty(property, value);
    else node.style.setProperty(property, value);
  }

  render(input: RenderInput): void {
    const { buffer, layout } = input;
    const metrics = this.metrics;
    const lineHeight = metrics.lineHeight;
    const totalRows = layout.totalRows;

    // Read scroll geometry before writing any style, so the read cannot force
    // a synchronous layout to resolve pending writes.
    const scrollLeft = this.scroller.scrollLeft;
    this.lastScrollLeft = scrollLeft;

    const gutterW = this.gutterWidth(buffer.lineCount, input.showLineNumbers);
    if (gutterW !== this.lastGutterWidth) {
      this.editor.style.setProperty('--pe-gutter-w', `${gutterW}px`);
      this.lastGutterWidth = gutterW;
    }
    // Custom properties inherit, so re-setting one invalidates style for the
    // whole subtree — not something to do on every scroll frame.
    this.setStyle(this.editor, '--pe-line-h', `${lineHeight}px`);
    this.setStyle(this.editor, '--pe-char-w', `${metrics.charWidth}px`);

    // The gutter lives inside the scrolled content, so vertical scrolling is
    // free; only the horizontal offset (no-wrap mode) has to be cancelled out.
    this.setStyle(this.gutter, 'transform', scrollLeft ? `translateX(${scrollLeft}px)` : 'none');

    // Leave a screen of slack under the last line so the final lines can be
    // scrolled clear of the on-screen keyboard.
    const slack = Math.max(lineHeight * 3, input.viewportHeight * 0.5);
    this.setStyle(this.sizer, 'height', `${totalRows * lineHeight + slack}px`);
    this.setStyle(
      this.sizer,
      'width',
      layout.options.wordWrap ? '100%' : `${gutterW + (layout.widestLineColumns + 4) * metrics.charWidth}px`,
    );

    // Two ranges: what must be on screen, and the wider band actually painted.
    // Scrolling within the painted band touches no DOM at all, so a flick runs
    // entirely on the compositor until it leaves the band.
    const topRow = Math.floor(input.scrollTop / lineHeight);
    const bottomRow = Math.ceil((input.scrollTop + input.viewportHeight) / lineHeight);
    const neededFirst = layout.lineAtRow(Math.max(0, topRow - VIEW_MARGIN)).line;
    const neededLast = layout.lineAtRow(Math.min(totalRows, bottomRow + VIEW_MARGIN)).line;

    const state = this.paintedState(input);
    const covered =
      state === this.painted.state && neededFirst >= this.painted.first && neededLast <= this.painted.last;

    let firstLine = this.painted.first;
    let lastLine = this.painted.last;
    if (!covered) {
      firstLine = layout.lineAtRow(Math.max(0, topRow - OVERSCAN)).line;
      lastLine = layout.lineAtRow(Math.min(totalRows, bottomRow + OVERSCAN)).line;
      this.renderLines(input, firstLine, lastLine);
      this.renderGutter(input, firstLine, lastLine, gutterW);
      this.painted = { first: firstLine, last: lastLine, state };
    }

    // These depend on the caret, not on the scroll position, and are cheap.
    this.updateActiveLine(input);
    this.renderSelection(input, firstLine, lastLine);
    this.renderCaret(input);
  }

  private renderLines(input: RenderInput, firstLine: number, lastLine: number): void {
    const { buffer, layout, highlighter } = input;
    const lineHeight = this.metrics.lineHeight;

    for (const [line, node] of this.lineElements) {
      if (line < firstLine || line > lastLine) {
        node.remove();
        this.lineElements.delete(line);
        this.styleCache.delete(node);
        if (this.pool.length < 80) this.pool.push(node);
      }
    }

    for (let line = firstLine; line <= lastLine; line++) {
      let node = this.lineElements.get(line);
      const layoutInfo = layout.lineLayout(line);
      const top = layout.firstRowOfLine(line) * lineHeight;
      const height = layoutInfo.rowStarts.length * lineHeight;

      // The key covers everything the painted rows depend on: the text, the
      // wrap points, and the tokens (which an edit can change several lines
      // further down, when a block comment opens or a string closes).
      const key = `${layout.generation}:${buffer.version}:${line}`;
      if (!node) {
        node = this.pool.pop() ?? el('div', 'pe-line');
        this.styleCache.delete(node);
        node.classList.remove('pe-line-active');
        this.linesLayer.appendChild(node);
        this.lineElements.set(line, node);
      }
      if (node.dataset.key !== key) {
        node.innerHTML = this.lineHtml(buffer.line(line), layoutInfo, highlighter.tokensFor(buffer, line));
        node.dataset.line = String(line);
        node.dataset.key = key;
      }

      this.setStyle(node, 'top', `${top}px`);
      this.setStyle(node, 'height', `${height}px`);
    }
    // Same as the gutter: a line element created just now still needs the
    // active-line class that `updateActiveLine` would otherwise have set.
    this.lineElements.get(this.activeLine)?.classList.add('pe-line-active');
  }

  /** Move the current-line highlight without repainting any line content. */
  private updateActiveLine(input: RenderInput): void {
    const line = selectionIsEmpty(input.selection) ? input.selection.head.line : -1;
    if (line === this.activeLine) return;

    this.lineElements.get(this.activeLine)?.classList.remove('pe-line-active');
    this.lineElements.get(line)?.classList.add('pe-line-active');
    this.gutterElements.get(this.activeLine)?.classList.remove('pe-gutter-current');
    this.gutterElements.get(line)?.classList.add('pe-gutter-current');
    this.activeLine = line;
  }

  private lineHtml(text: string, layout: LineLayout, tokens: Token[]): string {
    if (text.length === 0) return '<div class="pe-row"><br></div>';

    const charWidth = this.metrics.charWidth;
    let html = '';
    for (let row = 0; row < layout.rowStarts.length; row++) {
      const start = layout.rowStarts[row];
      const end = row + 1 < layout.rowStarts.length ? layout.rowStarts[row + 1] : text.length;
      const indent = layout.rowIndent[row] * charWidth;
      html += indent > 0 ? `<div class="pe-row" style="padding-left:${indent}px">` : '<div class="pe-row">';
      html += this.rowHtml(text, layout, tokens, start, end);
      html += '</div>';
    }
    return html;
  }

  private rowHtml(text: string, layout: LineLayout, tokens: Token[], start: number, end: number): string {
    if (end <= start) return '<br>';

    let html = '';
    let i = start;
    let ti = 0;
    while (ti < tokens.length && tokens[ti].end <= start) ti++;

    while (i < end) {
      while (ti < tokens.length && tokens[ti].end <= i) ti++;
      const token = tokens[ti];
      const inside = token && token.start <= i;
      const stop = inside ? Math.min(token.end, end) : Math.min(token ? token.start : end, end);
      const segmentEnd = Math.max(stop, i + 1);
      html += this.segmentHtml(text, layout, i, Math.min(segmentEnd, end), inside ? token.type : 'text');
      i = Math.min(segmentEnd, end);
    }
    return html;
  }

  /**
   * One run of same-coloured text, sliced further so tabs and wide characters
   * get the explicit widths the layout arithmetic assumes.
   */
  private segmentHtml(text: string, layout: LineLayout, from: number, to: number, type: string): string {
    const charWidth = this.metrics.charWidth;
    let out = '';
    let i = from;

    while (i < to) {
      const code = text.charCodeAt(i);

      if (code === 9) {
        const width = (layout.columns[i + 1] - layout.columns[i]) * charWidth;
        out += `<span class="pe-tab" style="padding-left:${width.toFixed(3)}px"></span>`;
        i++;
        continue;
      }

      const cp = text.codePointAt(i) as number;
      if (isWideCodePoint(cp)) {
        // One box per character, not one per run.
        //
        // A run-sized box has the right total width, but the glyphs inside it
        // are laid out at the font's own advance — and a Japanese fallback face
        // advances one em per glyph while the layout reckons two cells, which
        // for a monospace face is about 1.2em. The error is invisible for a
        // word of kana in an English comment and ruinous for a line of
        // Japanese: by column 48 the caret sits a character and a half past the
        // text it belongs to, which is what put the view in the wrong place
        // when scrolling to reveal it. Boxing each character forces every one
        // of them back onto its own cell.
        const units = cp > 0xffff ? 2 : 1;
        out += `<span class="pe-w">${escapeHtml(text.slice(i, i + units))}</span>`;
        i += units;
        continue;
      }

      let j = i;
      while (j < to) {
        const next = text.codePointAt(j) as number;
        if (next === 9 || isWideCodePoint(next)) break;
        j += next > 0xffff ? 2 : 1;
      }
      out += escapeHtml(text.slice(i, j));
      i = j;
    }

    // Unstyled runs — whitespace, punctuation the language did not classify —
    // need no element of their own. Skipping them takes a visible bite out of
    // the node count, and nodes are what scrolling has to paint.
    return type === 'text' ? out : `<span class="tk-${type}">${out}</span>`;
  }

  private renderGutter(input: RenderInput, firstLine: number, lastLine: number, width: number): void {
    this.setStyle(this.gutter, 'width', `${width}px`);
    this.gutter.classList.toggle('pe-gutter-hidden', !input.showLineNumbers);

    for (const [line, node] of this.gutterElements) {
      if (line < firstLine || line > lastLine) {
        node.remove();
        this.gutterElements.delete(line);
        this.styleCache.delete(node);
        if (this.gutterPool.length < 80) this.gutterPool.push(node);
      }
    }

    if (!input.showLineNumbers) return;

    const lineHeight = this.metrics.lineHeight;
    for (let line = firstLine; line <= lastLine; line++) {
      let node = this.gutterElements.get(line);
      if (!node) {
        node = this.gutterPool.pop() ?? el('div', 'pe-gutter-line');
        this.styleCache.delete(node);
        node.classList.remove('pe-gutter-current');
        this.gutter.appendChild(node);
        this.gutterElements.set(line, node);
      }
      const label = String(line + 1);
      if (node.textContent !== label) node.textContent = label;
      this.setStyle(node, 'top', `${input.layout.firstRowOfLine(line) * lineHeight}px`);
    }
    // The active-line class is owned by `updateActiveLine`; re-apply it here
    // because the element for that line may have just been created.
    this.gutterElements.get(this.activeLine)?.classList.add('pe-gutter-current');
  }

  private renderSelection(input: RenderInput, firstLine: number, lastLine: number): void {
    const rects: string[] = [];
    const { layout, buffer } = input;
    const { charWidth, lineHeight } = this.metrics;

    const paint = (range: TextRange, className: string) => {
      const from = range.from;
      const to = range.to;
      for (let line = Math.max(from.line, firstLine); line <= Math.min(to.line, lastLine); line++) {
        const info = layout.lineLayout(line);
        const text = buffer.line(line);
        const lineTop = layout.firstRowOfLine(line) * lineHeight;
        const startCh = line === from.line ? from.ch : 0;
        const endCh = line === to.line ? to.ch : text.length;

        for (let row = 0; row < info.rowStarts.length; row++) {
          const rowStart = info.rowStarts[row];
          const rowEnd = row + 1 < info.rowStarts.length ? info.rowStarts[row + 1] : text.length;
          const a = Math.max(startCh, rowStart);
          const b = Math.min(endCh, rowEnd);
          if (b < a) continue;
          if (b === a && !(line !== to.line && rowEnd === text.length)) continue;

          const base = info.columns[rowStart] - info.rowIndent[row];
          const left = (info.columns[a] - base) * charWidth;
          let right = (info.columns[b] - base) * charWidth;
          // A selection that swallows a line break shows a sliver past the end,
          // which is how you can tell the newline is included.
          if (line !== to.line && b === text.length && row === info.rowStarts.length - 1) {
            right += charWidth * 0.6;
          }
          rects.push(
            `<div class="${className}" style="left:${left.toFixed(2)}px;top:${(lineTop + row * lineHeight).toFixed(2)}px;width:${Math.max(right - left, 1).toFixed(2)}px"></div>`,
          );
        }
      }
    };

    if (!selectionIsEmpty(input.selection)) {
      paint({ from: selectionStart(input.selection), to: selectionEnd(input.selection) }, 'pe-sel');
    }
    if (input.composition) paint(input.composition, 'pe-composition');

    const html = rects.join('');
    if (this.selectionLayer.innerHTML !== html) this.selectionLayer.innerHTML = html;
  }

  private renderCaret(input: RenderInput): void {
    const visible = input.focused && selectionIsEmpty(input.selection);
    this.caret.classList.toggle('pe-caret-visible', visible);
    this.setStyle(this.caret, 'height', `${this.metrics.lineHeight}px`);

    const coords = input.layout.coordsAt(input.selection.head);
    const transform = `translate(${coords.x.toFixed(2)}px, ${coords.y.toFixed(2)}px)`;
    if (transform === this.lastCaretTransform) return;
    this.lastCaretTransform = transform;
    this.caret.style.transform = transform;

    // Restart the blink so the caret is solid right after it moves. This reads
    // `offsetWidth` to flush the class removal, which forces a synchronous
    // layout — fine when the caret actually moved, ruinous if it ran on every
    // scroll frame, which is why it sits behind the check above.
    this.caret.classList.remove('pe-caret-blink');
    void this.caret.offsetWidth;
    this.caret.classList.add('pe-caret-blink');
  }

  /** Force a full repaint of line content, e.g. after a font or theme change. */
  invalidateAll(): void {
    for (const [, node] of this.lineElements) {
      node.remove();
      this.styleCache.delete(node);
      if (this.pool.length < 80) this.pool.push(node);
    }
    this.lineElements.clear();
    this.painted = { first: 0, last: -1, state: '' };
    this.activeLine = -1;
    this.lastCaretTransform = '';
  }

  /** Content-space coordinates for a client point (accounts for scroll + gutter). */
  clientToContent(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.content.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  /** Client coordinates for a caret position, for placing overlays. */
  contentToClient(p: { x: number; y: number }): { x: number; y: number } {
    const rect = this.content.getBoundingClientRect();
    return { x: rect.left + p.x, y: rect.top + p.y };
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
