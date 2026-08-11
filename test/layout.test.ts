import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBuffer } from '../src/editor/model/textBuffer.ts';
import { Metrics } from '../src/editor/view/metrics.ts';
import { Layout } from '../src/editor/view/layout.ts';
import { pos } from '../src/editor/model/position.ts';

/** A layout wrapping at exactly `columns` cells, with a 10px character cell. */
function makeLayout(text: string, columns: number, wordWrap = true) {
  const buffer = new TextBuffer(text);
  const metrics = new Metrics();
  metrics.charWidth = 10;
  metrics.lineHeight = 20;
  const layout = new Layout(buffer, metrics, { tabSize: 2, wordWrap });
  layout.setViewportWidth(columns * metrics.charWidth);
  return { buffer, layout, metrics };
}

test('short lines occupy one row', () => {
  const { layout } = makeLayout('short', 20);
  assert.equal(layout.rowsInLine(0), 1);
  assert.equal(layout.totalRows, 1);
});

test('a long run with no break opportunity breaks hard at the edge', () => {
  const { layout } = makeLayout('a'.repeat(50), 20);
  assert.deepEqual(layout.lineLayout(0).rowStarts, [0, 20, 40]);
  assert.equal(layout.totalRows, 3);
});

test('wrapping prefers the last break opportunity', () => {
  //           0123456789012345678901
  const text = 'alpha beta gamma delta';
  const { layout } = makeLayout(text, 14);
  const { rowStarts } = layout.lineLayout(0);
  // Breaks after a space, so no word is split.
  assert.deepEqual(rowStarts, [0, 11]);
  assert.equal(text.slice(0, 11), 'alpha beta ');
  assert.equal(text.slice(11), 'gamma delta');
});

test('Japanese wraps between glyphs, two columns each', () => {
  const { layout } = makeLayout('あ'.repeat(30), 20);
  const { rowStarts } = layout.lineLayout(0);
  assert.deepEqual(rowStarts, [0, 10, 20]);
});

test('wrapped rows keep the original indentation', () => {
  const { layout } = makeLayout('    alpha beta gamma delta epsilon', 16);
  const info = layout.lineLayout(0);
  assert.ok(info.rowStarts.length > 1);
  assert.equal(info.rowIndent[0], 0);
  for (let row = 1; row < info.rowIndent.length; row++) assert.equal(info.rowIndent[row], 4);
});

test('wrapping off leaves every line as a single row', () => {
  const { layout } = makeLayout('a'.repeat(200), 20, false);
  assert.equal(layout.rowsInLine(0), 1);
  assert.equal(layout.widestLineColumns, 200);
});

test('row indices accumulate across lines', () => {
  const { layout } = makeLayout(['x', 'a'.repeat(45), 'y'].join('\n'), 20);
  assert.equal(layout.firstRowOfLine(0), 0);
  assert.equal(layout.firstRowOfLine(1), 1);
  assert.equal(layout.firstRowOfLine(2), 4); // 1 + 3 wrapped rows
  assert.equal(layout.totalRows, 5);
  assert.deepEqual(layout.lineAtRow(0), { line: 0, rowInLine: 0 });
  assert.deepEqual(layout.lineAtRow(2), { line: 1, rowInLine: 1 });
  assert.deepEqual(layout.lineAtRow(4), { line: 2, rowInLine: 0 });
});

test('rows past the end clamp to the last row', () => {
  const { layout } = makeLayout('a\nb', 20);
  assert.deepEqual(layout.lineAtRow(99), { line: 1, rowInLine: 0 });
  assert.deepEqual(layout.lineAtRow(-5), { line: 0, rowInLine: 0 });
});

test('an edit re-wraps only the edited line', () => {
  const { buffer, layout } = makeLayout(['a'.repeat(45), 'tail'].join('\n'), 20);
  assert.equal(layout.totalRows, 4);

  const before = layout.lineLayout(1);
  buffer.replace({ from: pos(0, 0), to: pos(0, 45) }, 'short');
  layout.linesChanged(0, 1, 1);

  assert.equal(layout.rowsInLine(0), 1);
  assert.equal(layout.totalRows, 2);
  // The untouched line keeps its cached layout object.
  assert.equal(layout.lineLayout(1), before);
});

test('inserting lines shifts later layouts without recomputing them', () => {
  const { buffer, layout } = makeLayout(['one', 'two', 'three'].join('\n'), 20);
  const third = layout.lineLayout(2);
  buffer.replace({ from: pos(0, 3), to: pos(0, 3) }, '\nextra');
  layout.linesChanged(0, 1, 2);
  assert.equal(layout.totalRows, 4);
  assert.equal(layout.lineLayout(3), third);
});

test('coordinates and hit testing are inverse', () => {
  const { layout } = makeLayout('alpha beta gamma delta', 14);
  for (const p of [pos(0, 0), pos(0, 3), pos(0, 11), pos(0, 14), pos(0, 22)]) {
    const { x, y } = layout.coordsAt(p);
    assert.deepEqual(layout.positionAt(x, y), p, `at ${p.line}:${p.ch}`);
  }
});

test('hit testing wide glyphs lands on a glyph boundary', () => {
  const { layout } = makeLayout('日本語', 20);
  assert.deepEqual(layout.positionAt(0, 0), pos(0, 0));
  assert.deepEqual(layout.positionAt(20, 0), pos(0, 1));
  assert.deepEqual(layout.positionAt(1000, 0), pos(0, 3));
});

test('tapping past the end of a wrapped row stays before the break', () => {
  const { layout } = makeLayout('alpha beta gamma', 12);
  const info = layout.lineLayout(0);
  assert.ok(info.rowStarts.length > 1);
  // Far to the right of the first row: the caret belongs at the end of the
  // visible text, not at the start of the row below.
  const p = layout.positionInRow(0, 0, 10_000);
  assert.equal(p.line, 0);
  assert.ok(p.ch < info.rowStarts[1], `${p.ch} < ${info.rowStarts[1]}`);
});

test('changing the wrap width invalidates and bumps the generation', () => {
  const { layout, metrics } = makeLayout('a'.repeat(45), 20);
  const first = layout.generation;
  assert.equal(layout.totalRows, 3);
  layout.setViewportWidth(45 * metrics.charWidth);
  assert.notEqual(layout.generation, first);
  assert.equal(layout.totalRows, 1);
});

// ------------------------------------------------- re-wrapping vs re-widening

test('a wrap change keeps the widest line, which no viewport ever showed', () => {
  // The long line is well past anything a viewport would paint, so its width
  // can only come from the pass that counts rows for the whole document.
  const lines = ['short', ...Array.from({ length: 50 }, (_, i) => `line ${i}`), 'x'.repeat(300)];
  const { layout } = makeLayout(lines.join('\n'), 20, false);
  assert.equal(layout.totalRows, lines.length);
  assert.equal(layout.widestLineColumns, 300);

  // Zooming changes how many columns fit; it cannot change how wide the text is.
  layout.setViewportWidth(10 * 10);
  assert.equal(layout.widestLineColumns, 300);
  layout.setViewportWidth(60 * 10);
  assert.equal(layout.widestLineColumns, 300);
});

test('row counts follow the wrap column, in both directions', () => {
  const { layout } = makeLayout('a'.repeat(60), 20);
  assert.equal(layout.totalRows, 3);
  layout.setViewportWidth(15 * 10);
  assert.equal(layout.totalRows, 4);
  layout.setViewportWidth(30 * 10);
  assert.equal(layout.totalRows, 2);
  layout.setViewportWidth(20 * 10);
  assert.equal(layout.totalRows, 3);
});

test('an edit still re-widens the line it touched', () => {
  const { buffer, layout } = makeLayout('short\nalso short', 40, false);
  assert.equal(layout.totalRows, 2); // forces the pass that measures widths
  assert.equal(layout.widestLineColumns, 10);
  buffer.replace({ from: pos(0, 0), to: pos(0, 5) }, 'y'.repeat(80));
  layout.linesChanged(0, 1, 1);
  assert.equal(layout.totalRows, 2);
  assert.equal(layout.widestLineColumns, 80);
});

test('counted rows and laid-out rows agree', () => {
  // `totalRows` counts without building layouts; `rowsInLine` builds them.
  // A disagreement puts every line below it at the wrong height.
  const text = [
    '  const wrapped = veryLongFunctionName(argument, another, third) + 12345;',
    '\t\tconst tabbed = "a string that runs on for a while past the wrap column";',
    'これは日本語の行です。折り返しの位置を確かめるために長くしています。',
    'short',
    '',
  ].join('\n');
  for (const columns of [12, 20, 33, 40]) {
    const { layout } = makeLayout(text, columns);
    const counted = layout.totalRows;
    let laidOut = 0;
    for (let i = 0; i < 5; i++) laidOut += layout.rowsInLine(i);
    assert.equal(counted, laidOut, `at ${columns} columns`);
  }
});
