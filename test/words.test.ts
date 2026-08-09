import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryOf,
  firstNonWhitespace,
  nextWordBoundary,
  wordBoundsAt,
} from '../src/editor/model/words.ts';

test('classifies characters into the categories selection cares about', () => {
  assert.equal(categoryOf('a'), 'word');
  assert.equal(categoryOf('_'), 'word');
  assert.equal(categoryOf('7'), 'word');
  assert.equal(categoryOf(' '), 'space');
  assert.equal(categoryOf('('), 'punct');
  assert.equal(categoryOf('あ'), 'cjk');
  assert.equal(categoryOf('漢'), 'cjk');
});

test('double-tap bounds cover the word under the caret', () => {
  const text = 'const value = 42;';
  assert.deepEqual(wordBoundsAt(text, 0), { start: 0, end: 5 });
  assert.deepEqual(wordBoundsAt(text, 3), { start: 0, end: 5 });
  assert.deepEqual(wordBoundsAt(text, 8), { start: 6, end: 11 });
  assert.deepEqual(wordBoundsAt(text, 14), { start: 14, end: 16 });
});

test('tapping just past a word selects that word, not the space', () => {
  const text = 'alpha beta';
  assert.deepEqual(wordBoundsAt(text, 5), { start: 0, end: 5 });
});

test('Japanese runs select as their own words', () => {
  const text = 'const 日本語 = 1;';
  assert.deepEqual(wordBoundsAt(text, 7), { start: 6, end: 9 });
});

test('empty lines produce an empty range', () => {
  assert.deepEqual(wordBoundsAt('', 0), { start: 0, end: 0 });
});

test('word jumps skip whitespace then consume one run', () => {
  const text = 'const  value = 42;';
  assert.equal(nextWordBoundary(text, 0, 1), 5);
  assert.equal(nextWordBoundary(text, 5, 1), 12);
  assert.equal(nextWordBoundary(text, 12, -1), 7);
  assert.equal(nextWordBoundary(text, 0, -1), 0);
  assert.equal(nextWordBoundary(text, text.length, 1), text.length);
});

test('firstNonWhitespace finds the indent width', () => {
  assert.equal(firstNonWhitespace('    x'), 4);
  assert.equal(firstNonWhitespace('\t\tx'), 2);
  assert.equal(firstNonWhitespace('x'), 0);
  assert.equal(firstNonWhitespace('   '), 3);
});
