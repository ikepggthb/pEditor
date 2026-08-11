import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  columnAt,
  columnMap,
  indexAtColumn,
  isSimpleAscii,
  isWideCodePoint,
  lineColumns,
  stepIndex,
} from '../src/editor/view/columns.ts';

test('ASCII columns match string indices', () => {
  assert.equal(columnAt('hello', 3, 4), 3);
  assert.equal(lineColumns('hello', 4), 5);
});

test('tabs advance to the next tab stop', () => {
  assert.equal(columnAt('\t', 0, 4), 0);
  assert.equal(columnAt('\t', 1, 4), 4);
  assert.equal(lineColumns('\t', 4), 4);
  assert.equal(lineColumns('ab\t', 4), 4);
  assert.equal(lineColumns('abcd\t', 4), 8);
  assert.equal(lineColumns('abcde\t', 4), 8);
});

test('East Asian characters take two columns', () => {
  assert.ok(isWideCodePoint('あ'.codePointAt(0)!));
  assert.ok(isWideCodePoint('漢'.codePointAt(0)!));
  assert.ok(!isWideCodePoint('a'.codePointAt(0)!));
  assert.ok(!isWideCodePoint('é'.codePointAt(0)!));
  assert.equal(lineColumns('日本語', 4), 6);
  assert.equal(lineColumns('a日b', 4), 4);
});

test('columnMap has an entry per index plus the end', () => {
  const map = columnMap('a日b', 4);
  assert.equal(map.length, 4);
  assert.deepEqual([...map], [0, 1, 3, 4]);
});

test('indexAtColumn snaps to the nearer character edge', () => {
  const text = 'abc';
  assert.equal(indexAtColumn(text, 0, 4), 0);
  assert.equal(indexAtColumn(text, 1, 4), 1);
  assert.equal(indexAtColumn(text, 99, 4), 3);
  // Half-way into a wide glyph rounds forward, before that rounds back.
  assert.equal(indexAtColumn('日', 0, 4), 0);
  assert.equal(indexAtColumn('日', 1, 4), 1);
});

test('indexAtColumn round-trips with columnAt', () => {
  const text = 'ab\tcd日本語ef';
  for (let i = 0; i <= text.length; i++) {
    const column = columnAt(text, i, 4);
    // Indices inside a wide glyph or surrogate have no column of their own.
    if (columnAt(text, i + 1, 4) === column) continue;
    assert.equal(indexAtColumn(text, column, 4), i, `index ${i}`);
  }
});

test('isSimpleAscii allows tabs but not wide characters', () => {
  assert.ok(isSimpleAscii('const x = 1;\t// ok'));
  assert.ok(!isSimpleAscii('const x = "日本";'));
  assert.ok(!isSimpleAscii('café'));
});

// ------------------------------------------------------------------- emoji

const FAMILY = '👨‍👩‍👧‍👦'; // four people joined by ZWJ: 11 code units, one glyph
const THUMB = '👍🏽'; // hand plus skin tone: 4 code units
const FLAG = '🇯🇵'; // two regional indicators
const HEART = '❤️'; // heart plus an emoji presentation selector

test('an emoji is one glyph however many code points it is made of', () => {
  assert.equal(lineColumns(FAMILY, 4), 2);
  assert.equal(lineColumns(THUMB, 4), 2);
  assert.equal(lineColumns(FLAG, 4), 2);
  assert.equal(lineColumns('🚀', 4), 2);
  assert.equal(lineColumns(`a${FAMILY}b`, 4), 4);
});

test('a presentation selector is what makes a symbol an emoji', () => {
  // The bare heart is text, and takes one cell like any other punctuation.
  assert.equal(lineColumns('❤', 4), 1);
  assert.equal(lineColumns(HEART, 4), 2);
});

test('the caret steps over a whole emoji, in both directions', () => {
  const text = `a${FAMILY}b`;
  assert.equal(stepIndex(text, 0, 1), 1);
  assert.equal(stepIndex(text, 1, 1), 1 + FAMILY.length);
  assert.equal(stepIndex(text, 1 + FAMILY.length, -1), 1);
  assert.equal(stepIndex(text, 1, -1), 0);

  // And over the parts that are easiest to leave behind.
  assert.equal(stepIndex(THUMB, 0, 1), THUMB.length);
  assert.equal(stepIndex(FLAG, FLAG.length, -1), 0);
  assert.equal(stepIndex(HEART, HEART.length, -1), 0);
});

test('columnMap gives every code unit of an emoji the column after it', () => {
  const map = columnMap(`a${THUMB}b`, 4);
  assert.equal(map[0], 0);
  assert.equal(map[1], 1);
  // Every index inside the emoji reports the column past it.
  for (let i = 2; i <= 1 + THUMB.length; i++) assert.equal(map[i], 3, `index ${i}`);
  assert.equal(map[map.length - 1], 4);
});

test('tapping an emoji lands on one side of it, never inside', () => {
  const text = `a${FAMILY}b`;
  assert.equal(indexAtColumn(text, 1, 4), 1);
  assert.equal(indexAtColumn(text, 2, 4), 1 + FAMILY.length); // past the midpoint
  assert.equal(indexAtColumn(text, 3, 4), 1 + FAMILY.length);
});

test('combining marks stay with the letter they modify', () => {
  const combined = 'é'; // e + combining acute
  assert.equal(lineColumns(combined, 4), 1);
  assert.equal(stepIndex(combined, 0, 1), 2);
  assert.equal(stepIndex(combined, 2, -1), 0);
});
