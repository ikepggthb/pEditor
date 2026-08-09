/**
 * A cursor over one line of text, with the small matching helpers a hand-written
 * tokenizer keeps wanting. Languages consume the stream and emit tokens; the
 * stream tracks where each token started so they don't have to.
 */
export class StringStream {
  pos = 0;
  start = 0;

  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  get eol(): boolean {
    return this.pos >= this.text.length;
  }

  /** The character at the cursor, without consuming it. */
  peek(offset = 0): string {
    return this.text.charAt(this.pos + offset);
  }

  /** Consume and return one character, or '' at end of line. */
  next(): string {
    return this.text.charAt(this.pos++);
  }

  /** Consume one character if it matches; report whether it did. */
  eat(match: string | RegExp): boolean {
    const ch = this.peek();
    if (ch === '') return false;
    const ok = typeof match === 'string' ? ch === match : match.test(ch);
    if (ok) this.pos++;
    return ok;
  }

  /** Consume as many matching characters as possible. */
  eatWhile(match: string | RegExp): boolean {
    const from = this.pos;
    while (this.eat(match)) {
      /* keep going */
    }
    return this.pos > from;
  }

  eatSpace(): boolean {
    return this.eatWhile(/[ \t]/);
  }

  skipToEnd(): void {
    this.pos = this.text.length;
  }

  /** Move to just before `str`; false (and no move) if it isn't ahead. */
  skipTo(str: string): boolean {
    const index = this.text.indexOf(str, this.pos);
    if (index < 0) return false;
    this.pos = index;
    return true;
  }

  /** Test (and optionally consume) a literal or pattern at the cursor. */
  match(pattern: string | RegExp, consume = true, caseInsensitive = false): RegExpMatchArray | boolean | null {
    if (typeof pattern === 'string') {
      const slice = this.text.substr(this.pos, pattern.length);
      const a = caseInsensitive ? slice.toLowerCase() : slice;
      const b = caseInsensitive ? pattern.toLowerCase() : pattern;
      if (a !== b) return false;
      if (consume) this.pos += pattern.length;
      return true;
    }
    const anchored = new RegExp(pattern.source, pattern.flags.includes('y') ? pattern.flags : pattern.flags + 'y');
    anchored.lastIndex = this.pos;
    const found = anchored.exec(this.text);
    if (!found) return null;
    if (consume) this.pos = anchored.lastIndex;
    return found;
  }

  /** The text consumed since the last `markTokenStart`. */
  current(): string {
    return this.text.slice(this.start, this.pos);
  }

  markTokenStart(): void {
    this.start = this.pos;
  }

  /** True when the cursor is at the first non-blank column. */
  atLineStart(): boolean {
    return /^[ \t]*$/.test(this.text.slice(0, this.pos));
  }
}
