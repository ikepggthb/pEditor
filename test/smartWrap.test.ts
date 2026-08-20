import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartWrap } from '../src/editor/view/smartWrap.ts';
import { columnMap } from '../src/editor/view/columns.ts';

interface Row {
  /** Columns of hanging indent the renderer would add. */
  indent: number;
  /** The slice of the line this row shows, unmodified. */
  text: string;
}

/** Lay a line out at `width` columns and return its rows. */
function layout(text: string, width: number, tabSize = 2): Row[] {
  const columns = columnMap(text, tabSize);
  const { rowStarts, rowIndent } = smartWrap(text, columns, width, tabSize, null);
  return rowStarts.map((start, i) => ({
    indent: rowIndent[i],
    text: text.slice(start, i + 1 < rowStarts.length ? rowStarts[i + 1] : text.length),
  }));
}

/** How a row reads on screen: its indent, then its text. */
function rows(text: string, width: number, tabSize = 2): string[] {
  return layout(text, width, tabSize).map((row) => ' '.repeat(row.indent) + row.text);
}

/** Every row must fit, and nothing may be lost or duplicated. */
function assertSound(text: string, width: number, tabSize = 2): string[] {
  const out = layout(text, width, tabSize);
  assert.equal(out.map((row) => row.text).join(''), text, 'rows must rejoin into the line');
  for (const row of out) {
    const columns = columnMap(row.text, tabSize)[row.text.length] + row.indent;
    assert.ok(columns <= width, `row of ${columns} columns exceeds ${width}: ${JSON.stringify(row)}`);
  }
  return out.map((row) => ' '.repeat(row.indent) + row.text);
}

test('a line that fits is left alone', () => {
  assert.deepEqual(rows('const a = 1;', 40), ['const a = 1;']);
});

test('an argument list comes apart at its commas', () => {
  const out = assertSound('const result = compute(alpha, beta, gamma, delta);', 28);
  // Each argument starts a row, rather than the text being cut mid-identifier.
  assert.ok(out.some((r) => r.trimStart().startsWith('alpha,')), out.join('\n'));
  assert.ok(out.some((r) => r.trimStart().startsWith('beta,')), out.join('\n'));
  assert.ok(out.some((r) => r.trimStart().startsWith('gamma,')), out.join('\n'));
});

test('continuations are indented past the bracket they are inside', () => {
  const out = assertSound('  call(first, second, third, fourth);', 22);
  const indentOf = (row: string) => row.length - row.trimStart().length;
  // The arguments sit inside the call; the closing bracket comes back out to
  // the line's own indentation, where the statement started.
  const args = out.filter((r) => /^\s*(first|second|third|fourth)/.test(r));
  assert.equal(args.length, 4, out.join('\n'));
  assert.ok(args.every((r) => indentOf(r) > 2), out.join('\n'));
  assert.equal(indentOf(out[out.length - 1]), 2, out.join('\n'));
});

test('operators start the row they belong to', () => {
  // Reading down a column of `&&` tells you the shape of the condition; the
  // same operators stranded at the ends of rows do not.
  const out = assertSound('if (alpha === beta && gamma !== delta && epsilon) {', 24);
  assert.ok(out.filter((r) => /^\s*&&/.test(r)).length >= 1, out.join('\n'));
});

test('a method chain breaks before the dots', () => {
  const out = assertSound('const names = people.filter(isActive).map(toName).sort();', 26);
  assert.ok(out.filter((r) => /^\s*\./.test(r)).length >= 1, out.join('\n'));
});

test('a long unbreakable run is cut rather than left overflowing', () => {
  // A base64 blob or a minified line has no structure to respect. Overflowing
  // would put it off the side of a screen that cannot scroll sideways.
  const out = assertSound('x'.repeat(200), 30);
  assert.ok(out.length >= 6, `expected several rows, got ${out.length}`);
});

test('structure inside a string is ignored', () => {
  // Commas and brackets in a message are punctuation, not syntax. Breaking at
  // them would cut a sentence into fragments that look like arguments — so the
  // string is broken only where it runs out of room.
  const out = assertSound('const message = "one,two,three,four,five,six";', 26);
  assert.equal(out.filter((r) => /^\s*(two|three|four|five|six)/.test(r)).length, 0, out.join('\n'));

  // And a bracket inside a string never opens a group, however unbalanced.
  assertSound('log("a ( b [ c { d", value, other);', 20);
});

test('a call that fits is left on one row, however long the line is', () => {
  // All-or-nothing cuts both ways: a group only comes apart when it has to.
  const out = assertSound('const x = f(a, b) + someOtherThing + yetAnotherThing;', 30);
  assert.ok(out.some((r) => r.includes('f(a, b)')), out.join('\n'));
});

test('tabs count as the tab stop, not as one column', () => {
  const out = assertSound('\t\tcall(alpha, beta, gamma, delta, epsilon);', 30, 4);
  assert.ok(out.length > 1);
});

test('rows never start inside an emoji', () => {
  const text = `const emoji = "${'\u{1F468}‍\u{1F469}‍\u{1F467} '.repeat(12)}";`;
  const columns = columnMap(text, 2);
  const { rowStarts } = smartWrap(text, columns, 24, 2, null);
  for (const start of rowStarts) {
    const code = text.charCodeAt(start);
    assert.ok(!(code >= 0xdc00 && code <= 0xdfff), `row starts on a low surrogate at ${start}`);
    assert.notEqual(text.charCodeAt(start - 1), 0x200d, `row starts after a joiner at ${start}`);
  }
});

test('every row of a realistic file fits its width', () => {
  const lines = [
    'export function summarise(list: readonly Task[], options: Options = {}): string {',
    '  const remaining = list.filter((task) => !task.done && task.owner === options.owner);',
    '    return `${remaining.length} of ${list.length} remaining, oldest ${oldest(remaining)}`;',
    '// a comment that runs on for a while without any punctuation to break at all',
    '\tif (a && b || c) { return doSomething(withThis, andThis); }',
  ];
  for (const width of [18, 24, 32, 48]) {
    for (const line of lines) assertSound(line, width);
  }
});
