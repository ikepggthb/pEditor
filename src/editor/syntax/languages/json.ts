import { StringStream } from '../stream.ts';
import { coalesceTokens, type Language, type Token, type TokenType } from '../types.ts';

/** JSON is context-free per line except that we want keys coloured as keys. */
interface JsonState {
  /** Depth of `{`, so we know whether a string could be a key. */
  objectDepth: number;
  /** True once a `:` has been seen for the current key. */
  afterColon: boolean;
}

function tokenize(line: string, incoming: JsonState): { tokens: Token[]; state: JsonState } {
  const state: JsonState = { ...incoming };
  const stream = new StringStream(line);
  const tokens: Token[] = [];
  const push = (type: TokenType) => {
    if (stream.pos > stream.start) tokens.push({ start: stream.start, end: stream.pos, type });
  };

  while (!stream.eol) {
    stream.markTokenStart();
    const ch = stream.peek();

    if (/\s/.test(ch)) {
      stream.eatWhile(/\s/);
      push('text');
      continue;
    }

    if (ch === '"') {
      stream.next();
      let closed = false;
      while (!stream.eol) {
        const c = stream.next();
        if (c === '\\') {
          stream.next();
          continue;
        }
        if (c === '"') {
          closed = true;
          break;
        }
      }
      const isKey = state.objectDepth > 0 && !state.afterColon;
      push(!closed ? 'invalid' : isKey ? 'property' : 'string');
      continue;
    }

    if (ch === '{') {
      stream.next();
      state.objectDepth++;
      state.afterColon = false;
      push('punctuation');
      continue;
    }

    if (ch === '}') {
      stream.next();
      state.objectDepth = Math.max(0, state.objectDepth - 1);
      push('punctuation');
      continue;
    }

    if (ch === ':') {
      stream.next();
      state.afterColon = true;
      push('operator');
      continue;
    }

    if (ch === ',') {
      stream.next();
      state.afterColon = false;
      push('punctuation');
      continue;
    }

    if (ch === '[' || ch === ']') {
      stream.next();
      push('punctuation');
      continue;
    }

    if (stream.match(/-?\d+(\.\d+)?([eE][+-]?\d+)?/)) {
      push('number');
      continue;
    }

    if (stream.match(/true|false|null/)) {
      push('literal');
      continue;
    }

    stream.next();
    push('invalid');
  }

  return { tokens: coalesceTokens(tokens), state };
}

export const json: Language<JsonState> = {
  id: 'json',
  name: 'JSON',
  extensions: ['json', 'jsonc', 'webmanifest'],
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['"', '"'],
  ],
  startState: () => ({ objectDepth: 0, afterColon: false }),
  copyState: (s) => ({ ...s }),
  statesEqual: (a, b) => a.objectDepth === b.objectDepth && a.afterColon === b.afterColon,
  tokenize,
};
