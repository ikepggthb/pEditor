import { StringStream } from '../stream.ts';
import { coalesceTokens, type Language, type Token, type TokenType } from '../types.ts';

const CONTROL = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break',
  'continue', 'return', 'goto',
]);

const KEYWORDS = new Set([
  'auto', 'const', 'extern', 'inline', 'register', 'restrict', 'sizeof',
  'static', 'struct', 'typedef', 'union', 'volatile', 'enum', '_Alignas',
  '_Alignof', '_Atomic', '_Generic', '_Noreturn', '_Static_assert',
  '_Thread_local', 'typeof',
]);

const TYPES = new Set([
  'void', 'char', 'short', 'int', 'long', 'float', 'double', 'signed',
  'unsigned', '_Bool', '_Complex', 'bool', 'size_t', 'ssize_t', 'ptrdiff_t',
  'wchar_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t',
  'uint32_t', 'uint64_t', 'intptr_t', 'uintptr_t', 'FILE', 'va_list',
]);

const LITERALS = new Set(['NULL', 'true', 'false', 'EOF']);

interface CState {
  blockComment: boolean;
  /** A preprocessor line continues while it ends in a backslash. */
  preprocessor: boolean;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

function tokenize(line: string, incoming: CState): { tokens: Token[]; state: CState } {
  const state: CState = { ...incoming };
  const stream = new StringStream(line);
  const tokens: Token[] = [];
  const push = (type: TokenType) => {
    if (stream.pos > stream.start) tokens.push({ start: stream.start, end: stream.pos, type });
  };

  const wasPreprocessor = state.preprocessor;
  state.preprocessor = /\\$/.test(line) && (wasPreprocessor || /^\s*#/.test(line));

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

    if (ch === '/' && stream.peek(1) === '/') {
      stream.skipToEnd();
      push('comment');
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

    // `#include`, `#define` and friends, plus any line continuing one.
    if ((ch === '#' && stream.atLineStart()) || (wasPreprocessor && stream.pos === 0)) {
      stream.eat('#');
      stream.eatWhile(IDENT_PART);
      push('keyword');
      continue;
    }

    if (ch === '"' || ch === "'") {
      stream.next();
      let closed = false;
      while (!stream.eol) {
        const c = stream.next();
        if (c === '\\') {
          stream.next();
          continue;
        }
        if (c === ch) {
          closed = true;
          break;
        }
      }
      push(closed ? 'string' : 'invalid');
      continue;
    }

    if (ch === '<' && wasPreprocessor && /^\s*#\s*include/.test(line)) {
      stream.next();
      if (stream.skipTo('>')) stream.pos += 1;
      else stream.skipToEnd();
      push('string');
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(stream.peek(1)))) {
      stream.match(/0[xX][0-9a-fA-F']+[uUlL]*|0[bB][01']+[uUlL]*|[0-9][0-9.']*([eE][+-]?[0-9]+)?[uUlLfF]*|\.[0-9]+([eE][+-]?[0-9]+)?[fF]?/);
      push('number');
      continue;
    }

    if (IDENT_START.test(ch)) {
      stream.eatWhile(IDENT_PART);
      const word = stream.current();
      if (CONTROL.has(word)) push('control');
      else if (KEYWORDS.has(word)) push('keyword');
      else if (TYPES.has(word)) push('type');
      else if (LITERALS.has(word)) push('literal');
      else if (/^[A-Z0-9_]+$/.test(word)) push('literal'); // SCREAMING_CASE reads as a macro
      else {
        let ahead = stream.pos;
        while (ahead < line.length && /[ \t]/.test(line[ahead])) ahead++;
        push(line[ahead] === '(' ? 'function' : /_t$/.test(word) ? 'type' : 'variable');
      }
      continue;
    }

    if (/[{}[\]();,]/.test(ch)) {
      stream.next();
      push('punctuation');
      continue;
    }

    if (stream.eatWhile(/[+\-*/%=<>!&|^~?:.#]/)) {
      push('operator');
      continue;
    }

    stream.next();
    push('text');
  }

  return { tokens: coalesceTokens(tokens), state };
}

export const c: Language<CState> = {
  id: 'c',
  name: 'C',
  extensions: ['c', 'h'],
  lineComment: '//',
  brackets: [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['"', '"'],
    ["'", "'"],
  ],
  startState: () => ({ blockComment: false, preprocessor: false }),
  copyState: (s) => ({ ...s }),
  statesEqual: (a, b) => a.blockComment === b.blockComment && a.preprocessor === b.preprocessor,
  tokenize,
};
