import { StringStream } from '../stream.ts';
import { coalesceTokens, type Language, type Token, type TokenType } from '../types.ts';

interface MdState {
  /** Inside a ``` fenced block, where nothing else should be styled. */
  inFence: boolean;
}

function tokenize(line: string, incoming: MdState): { tokens: Token[]; state: MdState } {
  const state: MdState = { ...incoming };
  const tokens: Token[] = [];
  const push = (start: number, end: number, type: TokenType) => {
    if (end > start) tokens.push({ start, end, type });
  };

  if (/^\s*(```|~~~)/.test(line)) {
    state.inFence = !state.inFence;
    push(0, line.length, 'comment');
    return { tokens, state };
  }

  if (state.inFence) {
    push(0, line.length, 'string');
    return { tokens, state };
  }

  if (/^\s{0,3}#{1,6}\s/.test(line)) {
    push(0, line.length, 'heading');
    return { tokens, state };
  }

  if (/^\s*>/.test(line)) {
    push(0, line.length, 'comment');
    return { tokens, state };
  }

  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
    push(0, line.length, 'operator');
    return { tokens, state };
  }

  const stream = new StringStream(line);

  // List markers and blockquote arrows are structure, not prose.
  const bullet = stream.match(/^\s*([-*+]|\d+[.)])\s+/) as RegExpMatchArray | null;
  if (bullet) push(0, stream.pos, 'keyword');

  while (!stream.eol) {
    const start = stream.pos;
    const ch = stream.peek();

    if (ch === '`') {
      stream.next();
      const close = line.indexOf('`', stream.pos);
      stream.pos = close < 0 ? line.length : close + 1;
      push(start, stream.pos, 'string');
      continue;
    }

    if ((ch === '*' || ch === '_') && stream.match(/(\*\*|__)(?=\S)/)) {
      const close = line.slice(stream.pos).search(/\*\*|__/);
      stream.pos = close < 0 ? line.length : stream.pos + close + 2;
      push(start, stream.pos, 'type');
      continue;
    }

    if ((ch === '*' || ch === '_') && stream.match(/[*_](?=\S)/)) {
      const close = line.slice(stream.pos).search(/[*_]/);
      stream.pos = close < 0 ? line.length : stream.pos + close + 1;
      push(start, stream.pos, 'property');
      continue;
    }

    if (ch === '[' || (ch === '!' && stream.peek(1) === '[')) {
      const link = stream.match(/!?\[[^\]]*\]\([^)]*\)/) as RegExpMatchArray | null;
      if (link) {
        push(start, stream.pos, 'link');
        continue;
      }
    }

    if (stream.match(/https?:\/\/\S+/)) {
      push(start, stream.pos, 'link');
      continue;
    }

    stream.next();
    push(start, stream.pos, 'text');
  }

  return { tokens: coalesceTokens(tokens), state };
}

export const markdown: Language<MdState> = {
  id: 'markdown',
  name: 'Markdown',
  extensions: ['md', 'markdown', 'mdx'],
  brackets: [
    ['(', ')'],
    ['[', ']'],
    ['`', '`'],
  ],
  startState: () => ({ inFence: false }),
  copyState: (s) => ({ ...s }),
  statesEqual: (a, b) => a.inFence === b.inFence,
  tokenize,
};
