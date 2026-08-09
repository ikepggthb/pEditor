import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBuffer } from '../src/editor/model/textBuffer.ts';
import { pos } from '../src/editor/model/position.ts';

test('splits and rejoins a document', () => {
  const buffer = new TextBuffer('one\ntwo\nthree');
  assert.equal(buffer.lineCount, 3);
  assert.equal(buffer.line(1), 'two');
  assert.equal(buffer.getText(), 'one\ntwo\nthree');
});

test('an empty document still has one line', () => {
  const buffer = new TextBuffer('');
  assert.equal(buffer.lineCount, 1);
  assert.deepEqual(buffer.end(), pos(0, 0));
});

test('preserves CRLF line endings when serialising', () => {
  const buffer = new TextBuffer('a\r\nb');
  assert.equal(buffer.eol, '\r\n');
  assert.equal(buffer.getText(), 'a\r\nb');
});

test('inserts within a line', () => {
  const buffer = new TextBuffer('hello world');
  const result = buffer.replace({ from: pos(0, 5), to: pos(0, 5) }, ',');
  assert.equal(buffer.getText(), 'hello, world');
  assert.deepEqual(result.insertedRange.to, pos(0, 6));
});

test('inserting a newline splits the line', () => {
  const buffer = new TextBuffer('abcd');
  buffer.replace({ from: pos(0, 2), to: pos(0, 2) }, '\n');
  assert.deepEqual([buffer.line(0), buffer.line(1)], ['ab', 'cd']);
});

test('deleting across lines joins them', () => {
  const buffer = new TextBuffer('one\ntwo\nthree');
  buffer.replace({ from: pos(0, 2), to: pos(2, 2) }, '');
  assert.equal(buffer.getText(), 'onree');
  assert.equal(buffer.lineCount, 1);
});

test('replacing a multi-line range with multi-line text', () => {
  const buffer = new TextBuffer('a\nb\nc');
  const result = buffer.replace({ from: pos(0, 1), to: pos(2, 0) }, 'X\nY\nZ');
  assert.equal(buffer.getText(), 'aX\nY\nZc');
  assert.deepEqual(result.insertedRange.to, pos(2, 1));
  assert.equal(result.removed, '\nb\n');
});

test('reversed ranges are normalised', () => {
  const buffer = new TextBuffer('abcdef');
  buffer.replace({ from: pos(0, 4), to: pos(0, 1) }, '-');
  assert.equal(buffer.getText(), 'a-ef');
});

test('positions are clamped into the document', () => {
  const buffer = new TextBuffer('ab\ncd');
  assert.deepEqual(buffer.clamp(pos(-3, -3)), pos(0, 0));
  assert.deepEqual(buffer.clamp(pos(9, 9)), pos(1, 2));
  assert.deepEqual(buffer.clamp(pos(0, 9)), pos(0, 2));
});

test('a replace that changes nothing does not bump the version', () => {
  const buffer = new TextBuffer('abc');
  const before = buffer.version;
  buffer.replace({ from: pos(0, 1), to: pos(0, 2) }, 'b');
  assert.equal(buffer.version, before);
});

test('stepPosition crosses line boundaries', () => {
  const buffer = new TextBuffer('ab\ncd');
  assert.deepEqual(buffer.stepPosition(pos(0, 2), 1), pos(1, 0));
  assert.deepEqual(buffer.stepPosition(pos(1, 0), -1), pos(0, 2));
  assert.deepEqual(buffer.stepPosition(pos(0, 0), -1), pos(0, 0));
  assert.deepEqual(buffer.stepPosition(pos(1, 2), 1), pos(1, 2));
});

test('stepPosition never lands inside a surrogate pair', () => {
  const buffer = new TextBuffer('a🎉b');
  assert.deepEqual(buffer.stepPosition(pos(0, 1), 1), pos(0, 3));
  assert.deepEqual(buffer.stepPosition(pos(0, 3), -1), pos(0, 1));
});

test('byteLength matches UTF-8 encoding', () => {
  for (const text of ['', 'abc', 'a\nb', '日本語', 'a🎉b', 'ß\nüñ\n漢字']) {
    const buffer = new TextBuffer(text);
    assert.equal(buffer.byteLength(), Buffer.byteLength(text, 'utf8'), text);
  }
});
