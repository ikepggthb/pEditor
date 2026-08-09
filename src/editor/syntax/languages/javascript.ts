import { StringStream } from '../stream.ts';
import { coalesceTokens, type Language, type Token, type TokenType } from '../types.ts';

const CONTROL = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break',
  'continue', 'return', 'throw', 'try', 'catch', 'finally', 'yield', 'await',
]);

const KEYWORDS = new Set([
  'var', 'let', 'const', 'function', 'class', 'extends', 'new', 'delete',
  'typeof', 'instanceof', 'in', 'of', 'this', 'super', 'import', 'export',
  'from', 'as', 'async', 'static', 'get', 'set', 'void', 'with', 'debugger',
  // TypeScript
  'interface', 'type', 'enum', 'namespace', 'declare', 'abstract', 'implements',
  'private', 'protected', 'public', 'readonly', 'satisfies', 'keyof', 'infer',
  'asserts', 'override', 'module', 'unique',
]);

const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);

const BUILTIN_TYPES = new Set([
  'string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'symbol',
  'bigint', 'Array', 'Promise', 'Record', 'Partial', 'Readonly', 'Map', 'Set',
  'Object', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'JSON',
  'Math', 'console', 'window', 'document', 'globalThis',
]);

type Context = 'template' | 'brace';

interface JsState {
  blockComment: boolean;
  /** Nesting of `${ }` inside template literals, so `}` can resume the string. */
  stack: Context[];
  /** Whether a `/` here would start a regex rather than divide. */
  regexAllowed: boolean;
}

const IDENT_START = /[A-Za-z_$¡-￿]/;
const IDENT_PART = /[A-Za-z0-9_$¡-￿]/;

function classifyWord(word: string, stream: StringStream): TokenType {
  if (CONTROL.has(word)) return 'control';
  if (KEYWORDS.has(word)) return 'keyword';
  if (LITERALS.has(word)) return 'literal';
  if (BUILTIN_TYPES.has(word)) return 'type';

  // A name immediately followed by `(` reads as a call; good enough, and it is
  // the distinction that actually helps when scanning code on a small screen.
  let ahead = stream.pos;
  while (ahead < stream.text.length && /[ \t]/.test(stream.text[ahead])) ahead++;
  if (stream.text[ahead] === '(') return 'function';

  if (/^[A-Z]/.test(word)) return 'type';
  return 'variable';
}

/** Consume a string body; returns false when the line ended before the quote. */
function readString(stream: StringStream, quote: string): boolean {
  while (!stream.eol) {
    const ch = stream.next();
    if (ch === '\\') {
      stream.next();
      continue;
    }
    if (ch === quote) return true;
  }
  return false;
}

function readRegex(stream: StringStream): boolean {
  let inClass = false;
  while (!stream.eol) {
    const ch = stream.next();
    if (ch === '\\') {
      stream.next();
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      stream.eatWhile(/[gimsuyvd]/);
      return true;
    }
  }
  return false;
}

/** Scan a template literal until the backtick or a `${`, whichever comes first. */
function readTemplate(stream: StringStream, state: JsState): TokenType {
  while (!stream.eol) {
    const ch = stream.next();
    if (ch === '\\') {
      stream.next();
      continue;
    }
    if (ch === '`') {
      state.stack.pop();
      return 'string';
    }
    if (ch === '$' && stream.peek() === '{') {
      stream.next();
      state.stack.push('brace');
      return 'string';
    }
  }
  return 'string';
}

function tokenizeLine(line: string, incoming: JsState): { tokens: Token[]; state: JsState } {
  const state: JsState = {
    blockComment: incoming.blockComment,
    stack: incoming.stack.slice(),
    regexAllowed: incoming.regexAllowed,
  };
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
      } else {
        stream.skipToEnd();
      }
      push('comment');
      continue;
    }

    if (state.stack[state.stack.length - 1] === 'template') {
      push(readTemplate(stream, state));
      state.regexAllowed = true;
      continue;
    }

    const ch = stream.peek();

    if (/[ \t]/.test(ch)) {
      stream.eatSpace();
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

    if (ch === '"' || ch === "'") {
      stream.next();
      const closed = readString(stream, ch);
      push(closed ? 'string' : 'invalid');
      state.regexAllowed = false;
      continue;
    }

    if (ch === '`') {
      stream.next();
      state.stack.push('template');
      push(readTemplate(stream, state));
      state.regexAllowed = true;
      continue;
    }

    if (ch === '/' && state.regexAllowed) {
      stream.next();
      const closed = readRegex(stream);
      push(closed ? 'regexp' : 'invalid');
      state.regexAllowed = false;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(stream.peek(1)))) {
      if (stream.match(/0[xX][0-9a-fA-F_]+n?/) || stream.match(/0[bB][01_]+n?/) || stream.match(/0[oO][0-7_]+n?/)) {
        push('number');
      } else {
        stream.match(/[0-9][0-9_]*(\.[0-9_]*)?([eE][+-]?[0-9_]+)?n?|\.[0-9][0-9_]*([eE][+-]?[0-9_]+)?/);
        push('number');
      }
      state.regexAllowed = false;
      continue;
    }

    if (IDENT_START.test(ch)) {
      stream.eatWhile(IDENT_PART);
      const word = stream.current();
      const type = classifyWord(word, stream);
      push(type);
      // After a value, `/` divides. After a keyword like `return`, it starts a regex.
      state.regexAllowed = type === 'keyword' || type === 'control';
      continue;
    }

    if (ch === '{') {
      stream.next();
      state.stack.push('brace');
      push('punctuation');
      state.regexAllowed = true;
      continue;
    }

    if (ch === '}') {
      stream.next();
      const top = state.stack.pop();
      if (top === 'brace' && state.stack[state.stack.length - 1] === 'template') {
        // Closing a `${…}` hole — the rest of the line is string again.
        push('string');
      } else {
        push('punctuation');
      }
      state.regexAllowed = true;
      continue;
    }

    if (/[[\]();,]/.test(ch)) {
      stream.next();
      push('punctuation');
      state.regexAllowed = ch !== ')' && ch !== ']';
      continue;
    }

    if (stream.eatWhile(/[+\-*/%=<>!&|^~?:.@#]/)) {
      push('operator');
      state.regexAllowed = true;
      continue;
    }

    stream.next();
    push('text');
    state.regexAllowed = true;
  }

  return { tokens: coalesceTokens(tokens), state };
}

function make(id: string, name: string, extensions: string[]): Language<JsState> {
  return {
    id,
    name,
    extensions,
    lineComment: '//',
    brackets: [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
      ['"', '"'],
      ["'", "'"],
      ['`', '`'],
    ],
    startState: () => ({ blockComment: false, stack: [], regexAllowed: true }),
    copyState: (s) => ({ blockComment: s.blockComment, stack: s.stack.slice(), regexAllowed: s.regexAllowed }),
    statesEqual: (a, b) =>
      a.blockComment === b.blockComment &&
      a.regexAllowed === b.regexAllowed &&
      a.stack.length === b.stack.length &&
      a.stack.every((v, i) => v === b.stack[i]),
    tokenize: tokenizeLine,
  };
}

export const javascript = make('javascript', 'JavaScript', ['js', 'mjs', 'cjs', 'jsx']);
export const typescript = make('typescript', 'TypeScript', ['ts', 'mts', 'cts', 'tsx']);
