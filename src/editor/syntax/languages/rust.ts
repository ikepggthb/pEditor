import { StringStream } from '../stream.ts';
import { coalesceTokens, type Language, type Token, type TokenType } from '../types.ts';

const CONTROL = new Set([
  'if', 'else', 'match', 'loop', 'while', 'for', 'break', 'continue', 'return',
  'await', 'yield',
]);

const KEYWORDS = new Set([
  'as', 'async', 'const', 'crate', 'dyn', 'enum', 'extern', 'fn', 'impl', 'in',
  'let', 'mod', 'move', 'mut', 'pub', 'ref', 'static', 'struct', 'super',
  'trait', 'type', 'union', 'unsafe', 'use', 'where', 'self', 'Self', 'box',
]);

const TYPES = new Set([
  'i8', 'i16', 'i32', 'i64', 'i128', 'isize',
  'u8', 'u16', 'u32', 'u64', 'u128', 'usize',
  'f32', 'f64', 'bool', 'char', 'str', 'String', 'Vec', 'Option', 'Result',
  'Box', 'Rc', 'Arc', 'RefCell', 'Cell', 'HashMap', 'HashSet', 'BTreeMap',
  'BTreeSet', 'VecDeque', 'Cow', 'Path', 'PathBuf', 'Mutex', 'RwLock',
]);

const LITERALS = new Set(['true', 'false', 'None', 'Some', 'Ok', 'Err']);

interface RustState {
  /** Block comments nest in Rust, so this is a depth rather than a flag. */
  commentDepth: number;
  /** Hash count of the raw string in progress, or -1 when not in one. */
  rawHashes: number;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;

/** Consume a raw string body; returns the hash count still open, or -1. */
function readRawString(stream: StringStream, hashes: number): number {
  const terminator = '"' + '#'.repeat(hashes);
  const index = stream.text.indexOf(terminator, stream.pos);
  if (index < 0) {
    stream.skipToEnd();
    return hashes;
  }
  stream.pos = index + terminator.length;
  return -1;
}

function tokenize(line: string, incoming: RustState): { tokens: Token[]; state: RustState } {
  const state: RustState = { ...incoming };
  const stream = new StringStream(line);
  const tokens: Token[] = [];
  const push = (type: TokenType) => {
    if (stream.pos > stream.start) tokens.push({ start: stream.start, end: stream.pos, type });
  };

  while (!stream.eol) {
    stream.markTokenStart();

    if (state.rawHashes >= 0) {
      state.rawHashes = readRawString(stream, state.rawHashes);
      push('string');
      continue;
    }

    if (state.commentDepth > 0) {
      // Track both delimiters: `/* /* */ */` closes once, not twice.
      while (!stream.eol && state.commentDepth > 0) {
        if (stream.match('/*')) state.commentDepth++;
        else if (stream.match('*/')) state.commentDepth--;
        else stream.next();
      }
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

    if (stream.match('/*')) {
      state.commentDepth = 1;
      while (!stream.eol && state.commentDepth > 0) {
        if (stream.match('/*')) state.commentDepth++;
        else if (stream.match('*/')) state.commentDepth--;
        else stream.next();
      }
      push('comment');
      continue;
    }

    // Attributes: #[derive(Debug)], #![allow(dead_code)]
    if (ch === '#' && (stream.peek(1) === '[' || (stream.peek(1) === '!' && stream.peek(2) === '['))) {
      stream.next();
      stream.eat('!');
      let depth = 0;
      while (!stream.eol) {
        const c = stream.next();
        if (c === '[') depth++;
        else if (c === ']') {
          depth--;
          if (depth === 0) break;
        }
      }
      push('attribute');
      continue;
    }

    // Raw strings: r"...", r#"..."#, br#"..."#
    const raw = stream.match(/b?r(#*)"/) as RegExpMatchArray | null;
    if (raw) {
      state.rawHashes = readRawString(stream, raw[1].length);
      push('string');
      continue;
    }

    if (ch === '"' || (ch === 'b' && stream.peek(1) === '"')) {
      stream.eat('b');
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
      push(closed ? 'string' : 'invalid');
      continue;
    }

    // A `'` is either a lifetime or a char literal — the shape decides.
    if (ch === "'") {
      if (stream.match(/'(\\.|[^\\'])'/)) {
        push('string');
        continue;
      }
      if (stream.match(/'[A-Za-z_][A-Za-z0-9_]*/)) {
        push('type');
        continue;
      }
      stream.next();
      push('invalid');
      continue;
    }

    if (/[0-9]/.test(ch)) {
      stream.match(/0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9_]+)?/);
      stream.match(/(i|u|f)(8|16|32|64|128|size)/);
      push('number');
      continue;
    }

    if (IDENT_START.test(ch)) {
      stream.eatWhile(IDENT_PART);
      const word = stream.current();

      // Macro invocation: `println!`, `vec!`
      if (stream.peek() === '!' && stream.peek(1) !== '=') {
        stream.next();
        push('function');
        continue;
      }
      if (CONTROL.has(word)) push('control');
      else if (KEYWORDS.has(word)) push('keyword');
      else if (LITERALS.has(word)) push('literal');
      else if (TYPES.has(word)) push('type');
      else if (/^[A-Z]/.test(word)) push('type');
      else if (/^[A-Z0-9_]+$/.test(word)) push('literal');
      else {
        let ahead = stream.pos;
        while (ahead < line.length && /[ \t]/.test(line[ahead])) ahead++;
        push(line[ahead] === '(' ? 'function' : 'variable');
      }
      continue;
    }

    if (/[{}[\]();,]/.test(ch)) {
      stream.next();
      push('punctuation');
      continue;
    }

    if (stream.eatWhile(/[+\-*/%=<>!&|^~?:.@$]/)) {
      push('operator');
      continue;
    }

    stream.next();
    push('text');
  }

  return { tokens: coalesceTokens(tokens), state };
}

export const rust: Language<RustState> = {
  id: 'rust',
  name: 'Rust',
  extensions: ['rs'],
  lineComment: '//',
  brackets: [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['"', '"'],
  ],
  startState: () => ({ commentDepth: 0, rawHashes: -1 }),
  copyState: (s) => ({ ...s }),
  statesEqual: (a, b) => a.commentDepth === b.commentDepth && a.rawHashes === b.rawHashes,
  tokenize,
};
