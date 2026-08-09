import type { TextBuffer } from '../model/textBuffer.ts';
import { javascript, typescript } from './languages/javascript.ts';
import { json } from './languages/json.ts';
import { css } from './languages/css.ts';
import { html } from './languages/html.ts';
import { markdown } from './languages/markdown.ts';
import { c } from './languages/c.ts';
import { rust } from './languages/rust.ts';
import { plain } from './languages/plain.ts';
import type { Language, Token } from './types.ts';

export const LANGUAGES: Language<any>[] = [
  typescript,
  javascript,
  rust,
  c,
  json,
  css,
  html,
  markdown,
  plain,
];

export function languageById(id: string): Language<any> {
  return LANGUAGES.find((l) => l.id === id) ?? plain;
}

export function languageForFilename(name: string): Language<any> {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  return LANGUAGES.find((l) => l.extensions.includes(ext)) ?? plain;
}

/** Lines longer than this are shown unstyled — a minified bundle should not
 *  be able to freeze the tokenizer on a phone CPU. */
const MAX_HIGHLIGHT_LENGTH = 10_000;

/**
 * Caches per-line tokens and the carry state between lines.
 *
 * `states[i]` is the tokenizer state *before* line `i`, so any line can be
 * highlighted as soon as every line above it has been. Work is done lazily on
 * demand — scrolling to line 5000 tokenises up to there once, then stays cached
 * until an edit invalidates it.
 */
export class Highlighter {
  private language: Language<any>;
  private states: unknown[] = [];
  private tokens: (Token[] | undefined)[] = [];

  constructor(language: Language<any>) {
    this.language = language;
    this.states = [language.startState()];
  }

  get lang(): Language<any> {
    return this.language;
  }

  setLanguage(language: Language<any>): void {
    this.language = language;
    this.reset();
  }

  reset(): void {
    this.states = [this.language.startState()];
    this.tokens = [];
  }

  /** Drop cached work from `line` down. Called after every edit. */
  invalidateFrom(line: number): void {
    const keep = Math.max(0, line);
    if (this.states.length > keep + 1) this.states.length = keep + 1;
    if (this.tokens.length > keep) this.tokens.length = keep;
  }

  tokensFor(buffer: TextBuffer, line: number): Token[] {
    if (line < 0 || line >= buffer.lineCount) return [];
    const cached = this.tokens[line];
    if (cached) return cached;

    this.ensureStateAt(buffer, line);
    return this.tokens[line] ?? [];
  }

  /** Tokenise forward from the last cached line until `line` has tokens. */
  private ensureStateAt(buffer: TextBuffer, line: number): void {
    let at = Math.max(0, this.states.length - 1);
    while (at <= line && at < buffer.lineCount) {
      const text = buffer.line(at);
      const incoming = this.states[at] ?? this.language.startState();

      if (text.length > MAX_HIGHLIGHT_LENGTH) {
        this.tokens[at] = [{ start: 0, end: text.length, type: 'text' }];
        this.states[at + 1] = incoming;
      } else {
        const { tokens, state } = this.language.tokenize(text, incoming);
        this.tokens[at] = tokens;
        this.states[at + 1] = state;
      }
      at++;
    }
  }
}
