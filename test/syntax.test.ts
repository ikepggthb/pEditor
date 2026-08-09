import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBuffer } from '../src/editor/model/textBuffer.ts';
import { Highlighter, languageById, languageForFilename } from '../src/editor/syntax/highlighter.ts';
import type { Language, TokenType } from '../src/editor/syntax/types.ts';
import { typescript } from '../src/editor/syntax/languages/javascript.ts';
import { json } from '../src/editor/syntax/languages/json.ts';
import { markdown } from '../src/editor/syntax/languages/markdown.ts';
import { html } from '../src/editor/syntax/languages/html.ts';
import { c } from '../src/editor/syntax/languages/c.ts';
import { rust } from '../src/editor/syntax/languages/rust.ts';

/** Tokenise a whole snippet and return `[text, type]` pairs per line. */
function tokenize(language: Language<any>, source: string): [string, TokenType][][] {
  let state = language.startState();
  return source.split('\n').map((line) => {
    const result = language.tokenize(line, state);
    state = result.state;
    return result.tokens.map((token) => [line.slice(token.start, token.end), token.type] as [string, TokenType]);
  });
}

/** The type covering `needle`, or undefined if it isn't its own token. */
function typeOf(rows: [string, TokenType][][], needle: string): TokenType | undefined {
  for (const row of rows) {
    for (const [text, type] of row) if (text === needle) return type;
  }
  return undefined;
}

test('tokens cover every character of a line exactly once', () => {
  const source = "const x = f(1, 'two') // note\n\tif (x) return /re?g/g;";
  let state = typescript.startState();
  for (const line of source.split('\n')) {
    const { tokens, state: next } = typescript.tokenize(line, state);
    state = next;
    let at = 0;
    for (const token of tokens) {
      assert.equal(token.start, at, `gap or overlap in: ${line}`);
      assert.ok(token.end > token.start);
      at = token.end;
    }
    assert.equal(at, line.length, `did not reach end of: ${line}`);
  }
});

test('classifies the basics of TypeScript', () => {
  const rows = tokenize(typescript, "export const n = 42; // tail\nif (n) return 'str';");
  assert.equal(typeOf(rows, 'export'), 'keyword');
  assert.equal(typeOf(rows, 'const'), 'keyword');
  assert.equal(typeOf(rows, '42'), 'number');
  assert.equal(typeOf(rows, '// tail'), 'comment');
  assert.equal(typeOf(rows, 'if'), 'control');
  assert.equal(typeOf(rows, 'return'), 'control');
  assert.equal(typeOf(rows, "'str'"), 'string');
});

test('a name before a paren reads as a call', () => {
  const rows = tokenize(typescript, 'doThing(value)');
  assert.equal(typeOf(rows, 'doThing'), 'function');
  assert.equal(typeOf(rows, 'value'), 'variable');
});

test('block comments carry across lines', () => {
  const rows = tokenize(typescript, 'a /* one\ntwo\nthree */ b');
  assert.equal(rows[1][0][1], 'comment');
  assert.equal(typeOf([rows[2]], 'three */'), 'comment');
  assert.equal(typeOf([rows[2]], 'b'), 'variable');
});

test('template literals carry across lines and re-enter on ${}', () => {
  const rows = tokenize(typescript, 'const t = `line one\nvalue ${x + 1} tail`;\nconst after = 1;');
  assert.equal(rows[1][0][1], 'string');
  assert.equal(typeOf([rows[1]], 'x'), 'variable');
  assert.equal(typeOf([rows[2]], 'const'), 'keyword');
});

test('a slash is division after a value and a regex after a keyword', () => {
  assert.equal(typeOf(tokenize(typescript, 'return /ab+c/gi;'), '/ab+c/gi'), 'regexp');
  const division = tokenize(typescript, 'const r = a / b;');
  assert.equal(typeOf(division, '/'), 'operator');
});

test('an unterminated string is marked invalid', () => {
  assert.equal(typeOf(tokenize(typescript, "const s = 'oops;"), "'oops;"), 'invalid');
});

test('JSON keys and values are distinguished', () => {
  const rows = tokenize(json, '{\n  "name": "value",\n  "count": 3,\n  "ok": true\n}');
  assert.equal(typeOf(rows, '"name"'), 'property');
  assert.equal(typeOf(rows, '"value"'), 'string');
  assert.equal(typeOf(rows, '3'), 'number');
  assert.equal(typeOf(rows, 'true'), 'literal');
});

test('markdown fences suppress inline styling', () => {
  const rows = tokenize(markdown, '# Title\n```\n**not bold**\n```\n**bold**');
  assert.equal(rows[0][0][1], 'heading');
  assert.equal(rows[2][0][1], 'string');
  assert.equal(typeOf([rows[4]], '**bold**'), 'type');
});

test('HTML separates tags, attributes and values', () => {
  const rows = tokenize(html, '<a href="/x" class=y>text</a>');
  assert.equal(typeOf(rows, 'href'), 'attribute');
  assert.equal(typeOf(rows, '"/x"'), 'string');
  assert.equal(typeOf(rows, 'text'), 'text');
});

test('C: preprocessor, types and macros', () => {
  const rows = tokenize(c, '#include <stdio.h>\nstatic int main(void) {\n  return MAX_LEN;\n}');
  assert.equal(typeOf(rows, '#include'), 'keyword');
  assert.equal(typeOf(rows, 'static'), 'keyword');
  assert.equal(typeOf(rows, 'int'), 'type');
  assert.equal(typeOf(rows, 'main'), 'function');
  assert.equal(typeOf(rows, 'return'), 'control');
  assert.equal(typeOf(rows, 'MAX_LEN'), 'literal');
});

test('C: char literals and block comments spanning lines', () => {
  const rows = tokenize(c, "char c = '\\n'; /* start\nstill comment */ int x;");
  assert.equal(typeOf(rows, "'\\n'"), 'string');
  assert.equal(rows[1][0][1], 'comment');
  assert.equal(typeOf([rows[1]], 'int'), 'type');
});

test('C: size_t and friends read as types', () => {
  const rows = tokenize(c, 'size_t n = 0; my_own_t v;');
  assert.equal(typeOf(rows, 'size_t'), 'type');
  assert.equal(typeOf(rows, 'my_own_t'), 'type');
});

test('Rust: keywords, macros, lifetimes and attributes', () => {
  const rows = tokenize(rust, '#[derive(Debug)]\npub fn run<\'a>(v: &\'a mut Vec<u8>) -> Option<u8> {\n  println!("hi");\n}');
  assert.equal(typeOf(rows, '#[derive(Debug)]'), 'attribute');
  assert.equal(typeOf(rows, 'pub'), 'keyword');
  assert.equal(typeOf(rows, 'fn'), 'keyword');
  assert.equal(typeOf(rows, "'a"), 'type');
  assert.equal(typeOf(rows, 'Vec'), 'type');
  assert.equal(typeOf(rows, 'u8'), 'type');
  assert.equal(typeOf(rows, 'println!'), 'function');
  assert.equal(typeOf(rows, '"hi"'), 'string');
});

test('Rust: block comments nest', () => {
  const rows = tokenize(rust, '/* outer /* inner */ still outer */ let x = 1;');
  assert.equal(typeOf(rows, 'let'), 'keyword');
  assert.equal(rows[0][0][1], 'comment');
  assert.equal(rows[0][0][0], '/* outer /* inner */ still outer */');
});

test('Rust: raw strings carry across lines and ignore quotes', () => {
  const rows = tokenize(rust, 'let s = r#"a "quoted" line\nsecond"#;\nlet t = 2;');
  assert.equal(rows[1][0][1], 'string');
  assert.equal(typeOf([rows[2]], 'let'), 'keyword');
});

test("Rust: a lone ' is a lifetime, a quoted one is a char", () => {
  assert.equal(typeOf(tokenize(rust, "let c = 'x';"), "'x'"), 'string');
  assert.equal(typeOf(tokenize(rust, "struct S<'life>;"), "'life"), 'type');
});

test('languages are picked by file extension', () => {
  assert.equal(languageForFilename('a/b/main.ts').id, 'typescript');
  assert.equal(languageForFilename('style.css').id, 'css');
  assert.equal(languageForFilename('README.md').id, 'markdown');
  assert.equal(languageForFilename('package.json').id, 'json');
  assert.equal(languageForFilename('main.rs').id, 'rust');
  assert.equal(languageForFilename('main.c').id, 'c');
  assert.equal(languageForFilename('util.h').id, 'c');
  assert.equal(languageForFilename('notes').id, 'plain');
  assert.equal(languageForFilename('mystery.xyz').id, 'plain');
  assert.equal(languageById('nope').id, 'plain');
});

test('the highlighter caches lines and re-tokenises after an edit', () => {
  const buffer = new TextBuffer('const a = 1;\nconst b = 2;\nconst c = 3;');
  const highlighter = new Highlighter(typescript);

  const first = highlighter.tokensFor(buffer, 2);
  assert.equal(highlighter.tokensFor(buffer, 2), first, 'cached instance reused');

  // Open a block comment on line 0; everything below becomes comment.
  buffer.replace({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }, '/*');
  highlighter.invalidateFrom(0);
  assert.equal(highlighter.tokensFor(buffer, 2)[0].type, 'comment');
});

test('very long lines are left unstyled rather than tokenised', () => {
  const buffer = new TextBuffer(`const x = '${'a'.repeat(20000)}';`);
  const highlighter = new Highlighter(typescript);
  const tokens = highlighter.tokensFor(buffer, 0);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].type, 'text');
});
