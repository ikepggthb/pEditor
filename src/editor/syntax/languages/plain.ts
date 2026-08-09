import type { Language, Token } from '../types.ts';

/** The fallback: one token per line, no styling. */
export const plain: Language<null> = {
  id: 'plain',
  name: 'Plain Text',
  extensions: ['txt', 'log', 'text'],
  startState: () => null,
  copyState: () => null,
  statesEqual: () => true,
  tokenize(line: string): { tokens: Token[]; state: null } {
    return {
      tokens: line.length ? [{ start: 0, end: line.length, type: 'text' }] : [],
      state: null,
    };
  },
};
