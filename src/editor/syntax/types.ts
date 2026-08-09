/** Token classes. Each maps to one `--tok-*` CSS custom property in the theme. */
export type TokenType =
  | 'keyword'
  | 'control'
  | 'literal'
  | 'string'
  | 'number'
  | 'comment'
  | 'operator'
  | 'punctuation'
  | 'function'
  | 'type'
  | 'property'
  | 'variable'
  | 'regexp'
  | 'tag'
  | 'attribute'
  | 'heading'
  | 'link'
  | 'invalid'
  | 'text';

export interface Token {
  /** Index into the line string, inclusive. */
  readonly start: number;
  /** Index into the line string, exclusive. */
  readonly end: number;
  readonly type: TokenType;
}

/**
 * A language definition.
 *
 * Tokenising is line-at-a-time with an explicit carry state, which is what lets
 * the view re-highlight only the lines it is about to paint: to draw line 900
 * we need the state after line 899, and nothing else.
 */
export interface Language<S = unknown> {
  readonly id: string;
  readonly name: string;
  /** File extensions, without the dot. Used to pick a language for a file. */
  readonly extensions: readonly string[];
  /** Line-comment token, if the language has one. Used by the toggle-comment command. */
  readonly lineComment?: string;
  /** Bracket pairs to auto-close. */
  readonly brackets?: readonly (readonly [string, string])[];

  startState(): S;
  copyState(state: S): S;
  /** Compare two carry states; used to stop re-highlighting once state converges. */
  statesEqual(a: S, b: S): boolean;
  /** Tokenise one line. Must not mutate `state`; return the state for the next line. */
  tokenize(line: string, state: S): { tokens: Token[]; state: S };
}

/** Merge adjacent same-type tokens so the renderer emits fewer spans. */
export function coalesceTokens(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    if (token.end <= token.start) continue;
    const last = out[out.length - 1];
    if (last && last.type === token.type && last.end === token.start) {
      out[out.length - 1] = { start: last.start, end: token.end, type: last.type };
    } else {
      out.push(token);
    }
  }
  return out;
}
