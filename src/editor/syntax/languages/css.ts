import { StringStream } from '../stream.ts';
import { coalesceTokens, type Language, type Token, type TokenType } from '../types.ts';

interface CssState {
  blockComment: boolean;
  /** Inside `{ … }`, where names are properties rather than selectors. */
  inBlock: boolean;
  afterColon: boolean;
}

function tokenize(line: string, incoming: CssState): { tokens: Token[]; state: CssState } {
  const state: CssState = { ...incoming };
  const stream = new StringStream(line);
  const tokens: Token[] = [];
  const push = (type: TokenType) => {
    if (stream.pos > stream.start) tokens.push({ start: stream.start, end: stream.pos, type });
  };

  while (!stream.eol) {
    stream.markTokenStart();

    if (state.blockComment) {
      if (stream.skipTo('*/')) {
        stream.pos += 2;
        state.blockComment = false;
      } else stream.skipToEnd();
      push('comment');
      continue;
    }

    const ch = stream.peek();

    if (/\s/.test(ch)) {
      stream.eatWhile(/\s/);
      push('text');
      continue;
    }

    if (ch === '/' && stream.peek(1) === '*') {
      stream.pos += 2;
      if (stream.skipTo('*/')) stream.pos += 2;
      else {
        stream.skipToEnd();
        state.blockComment = true;
      }
      push('comment');
      continue;
    }

    if (ch === '"' || ch === "'") {
      stream.next();
      while (!stream.eol) {
        const c = stream.next();
        if (c === '\\') stream.next();
        else if (c === ch) break;
      }
      push('string');
      continue;
    }

    if (ch === '{') {
      stream.next();
      state.inBlock = true;
      state.afterColon = false;
      push('punctuation');
      continue;
    }

    if (ch === '}') {
      stream.next();
      state.inBlock = false;
      state.afterColon = false;
      push('punctuation');
      continue;
    }

    if (ch === ':') {
      stream.next();
      state.afterColon = true;
      push('operator');
      continue;
    }

    if (ch === ';') {
      stream.next();
      state.afterColon = false;
      push('punctuation');
      continue;
    }

    if (ch === '@') {
      stream.next();
      stream.eatWhile(/[\w-]/);
      push('keyword');
      continue;
    }

    if (ch === '#' && stream.match(/#[0-9a-fA-F]{3,8}\b/)) {
      push('number');
      continue;
    }

    if (stream.match(/-?\d*\.?\d+(px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr|ch|ex|pt|dvh|svh)?/)) {
      push('number');
      continue;
    }

    if (stream.match(/[\w-]+/)) {
      if (state.inBlock && !state.afterColon) push('property');
      else if (state.inBlock) push('literal');
      else push('tag');
      continue;
    }

    if (stream.match(/[.#][\w-]+/)) {
      push('type');
      continue;
    }

    stream.next();
    push(/[(),>+~*[\]]/.test(ch) ? 'punctuation' : 'operator');
  }

  return { tokens: coalesceTokens(tokens), state };
}

export const css: Language<CssState> = {
  id: 'css',
  name: 'CSS',
  extensions: ['css', 'scss', 'less'],
  lineComment: '/*',
  brackets: [
    ['{', '}'],
    ['(', ')'],
    ['[', ']'],
    ['"', '"'],
    ["'", "'"],
  ],
  startState: () => ({ blockComment: false, inBlock: false, afterColon: false }),
  copyState: (s) => ({ ...s }),
  statesEqual: (a, b) =>
    a.blockComment === b.blockComment && a.inBlock === b.inBlock && a.afterColon === b.afterColon,
  tokenize,
};
