import { StringStream } from '../stream.ts';
import { coalesceTokens, type Language, type Token, type TokenType } from '../types.ts';

interface HtmlState {
  inComment: boolean;
  /** Inside `< … >`, where words are attribute names. */
  inTag: boolean;
  afterEquals: boolean;
  /** Set while inside <script>/<style> so their bodies aren't read as markup. */
  rawUntil: string | null;
}

function tokenize(line: string, incoming: HtmlState): { tokens: Token[]; state: HtmlState } {
  const state: HtmlState = { ...incoming };
  const stream = new StringStream(line);
  const tokens: Token[] = [];
  const push = (type: TokenType) => {
    if (stream.pos > stream.start) tokens.push({ start: stream.start, end: stream.pos, type });
  };

  while (!stream.eol) {
    stream.markTokenStart();

    if (state.inComment) {
      if (stream.skipTo('-->')) {
        stream.pos += 3;
        state.inComment = false;
      } else stream.skipToEnd();
      push('comment');
      continue;
    }

    if (state.rawUntil) {
      const close = `</${state.rawUntil}`;
      const index = stream.text.toLowerCase().indexOf(close, stream.pos);
      if (index < 0) {
        stream.skipToEnd();
        push('text');
      } else {
        stream.pos = index;
        push('text');
        state.rawUntil = null;
      }
      continue;
    }

    const ch = stream.peek();

    if (!state.inTag) {
      if (stream.match('<!--')) {
        if (stream.skipTo('-->')) stream.pos += 3;
        else {
          stream.skipToEnd();
          state.inComment = true;
        }
        push('comment');
        continue;
      }

      if (ch === '<') {
        stream.next();
        stream.eat('/');
        const name = stream.match(/[A-Za-z][\w:-]*/) as RegExpMatchArray | null;
        state.inTag = true;
        state.afterEquals = false;
        if (name) {
          const tag = name[0].toLowerCase();
          if ((tag === 'script' || tag === 'style') && stream.text[stream.start + 1] !== '/') {
            state.rawUntil = tag;
          }
        }
        push('tag');
        continue;
      }

      if (stream.match(/&[a-zA-Z#0-9]+;/)) {
        push('literal');
        continue;
      }

      // Ordinary text: run to the next markup character.
      stream.next();
      while (!stream.eol && stream.peek() !== '<' && stream.peek() !== '&') stream.next();
      push('text');
      continue;
    }

    // Inside a tag.
    if (/\s/.test(ch)) {
      stream.eatWhile(/\s/);
      push('text');
      continue;
    }

    if (ch === '>' || stream.match('/>')) {
      if (stream.peek() === '>') stream.next();
      state.inTag = false;
      state.afterEquals = false;
      push('tag');
      continue;
    }

    if (ch === '=') {
      stream.next();
      state.afterEquals = true;
      push('operator');
      continue;
    }

    if (ch === '"' || ch === "'") {
      stream.next();
      while (!stream.eol && stream.next() !== ch) {
        /* consume */
      }
      state.afterEquals = false;
      push('string');
      continue;
    }

    if (stream.match(/[^\s=>/"']+/)) {
      push(state.afterEquals ? 'string' : 'attribute');
      state.afterEquals = false;
      continue;
    }

    stream.next();
    push('text');
  }

  return { tokens: coalesceTokens(tokens), state };
}

export const html: Language<HtmlState> = {
  id: 'html',
  name: 'HTML',
  extensions: ['html', 'htm', 'xhtml', 'vue', 'svg', 'xml'],
  brackets: [
    ['<', '>'],
    ['(', ')'],
    ['"', '"'],
    ["'", "'"],
  ],
  startState: () => ({ inComment: false, inTag: false, afterEquals: false, rawUntil: null }),
  copyState: (s) => ({ ...s }),
  statesEqual: (a, b) =>
    a.inComment === b.inComment &&
    a.inTag === b.inTag &&
    a.afterEquals === b.afterEquals &&
    a.rawUntil === b.rawUntil,
  tokenize,
};
