import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  columnAt,
  columnMap,
  indexAtColumn,
  isSimpleAscii,
  isWideCodePoint,
  lineColumns,
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
