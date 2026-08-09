import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBuffer } from '../src/editor/model/textBuffer.ts';
import { History, type EditOrigin } from '../src/editor/core/history.ts';
import { pos, type TextRange } from '../src/editor/model/position.ts';
import { selectionAt, type Selection } from '../src/editor/model/selection.ts';

/** A stand-in for the editor: applies edits and records them, like `Editor.edit`. */
function makeSession(text: string) {
  const buffer = new TextBuffer(text);
  const history = new History();
  let selection: Selection = selectionAt(pos(0, 0));

  const edit = (range: TextRange, replacement: string, origin: EditOrigin = 'input') => {
    const before = selection;
    const result = buffer.replace(range, replacement);
    selection = selectionAt(result.insertedRange.to);
    history.record(result, before, selection, origin);
  };

  const apply = (range: TextRange, replacement: string) => {
    buffer.replace(range, replacement);
  };

  return {
    buffer,
    history,
    edit,
    get selection() {
      return selection;
    },
    undo: () => {
      const restored = history.undo(apply);
      if (restored) selection = restored;
      return restored;
    },
    redo: () => {
      const restored = history.redo(apply);
      if (restored) selection = restored;
      return restored;
    },
  };
}

test('undo reverses an insertion and redo replays it', () => {
  const s = makeSession('hello');
  s.edit({ from: pos(0, 5), to: pos(0, 5) }, ' world', 'paste');
  assert.equal(s.buffer.getText(), 'hello world');

  s.undo();
  assert.equal(s.buffer.getText(), 'hello');
  s.redo();
  assert.equal(s.buffer.getText(), 'hello world');
});

test('undo reverses a deletion', () => {
  const s = makeSession('one\ntwo\nthree');
  s.edit({ from: pos(0, 3), to: pos(2, 0) }, '', 'delete');
  assert.equal(s.buffer.getText(), 'onethree');
  s.undo();
  assert.equal(s.buffer.getText(), 'one\ntwo\nthree');
});

test('consecutive typing collapses into one undo step', () => {
  const s = makeSession('');
  for (const [i, ch] of [...'abcd'].entries()) {
    s.edit({ from: pos(0, i), to: pos(0, i) }, ch, 'input');
  }
  assert.equal(s.buffer.getText(), 'abcd');
  s.undo();
  assert.equal(s.buffer.getText(), '');
  assert.equal(s.history.canUndo, false);
});

test('a newline starts a new undo step', () => {
  const s = makeSession('');
  s.edit({ from: pos(0, 0), to: pos(0, 0) }, 'ab', 'input');
  s.edit({ from: pos(0, 2), to: pos(0, 2) }, '\n', 'input');
  s.edit({ from: pos(1, 0), to: pos(1, 0) }, 'cd', 'input');

  s.undo();
  assert.equal(s.buffer.getText(), 'ab\n');
  s.undo();
  assert.equal(s.buffer.getText(), 'ab');
});

test('typing away from the last edit starts a new step', () => {
  const s = makeSession('xy');
  s.edit({ from: pos(0, 0), to: pos(0, 0) }, 'a', 'input');
  s.edit({ from: pos(0, 3), to: pos(0, 3) }, 'b', 'input');
  s.undo();
  assert.equal(s.buffer.getText(), 'axy');
});

test('non-typing origins are never merged', () => {
  const s = makeSession('');
  s.edit({ from: pos(0, 0), to: pos(0, 0) }, 'a', 'command');
  s.edit({ from: pos(0, 1), to: pos(0, 1) }, 'b', 'command');
  s.undo();
  assert.equal(s.buffer.getText(), 'a');
});

test('breakRun forces the next edit into a fresh step', () => {
  const s = makeSession('');
  s.edit({ from: pos(0, 0), to: pos(0, 0) }, 'a', 'input');
  s.history.breakRun();
  s.edit({ from: pos(0, 1), to: pos(0, 1) }, 'b', 'input');
  s.undo();
  assert.equal(s.buffer.getText(), 'a');
});

test('a new edit clears the redo stack', () => {
  const s = makeSession('');
  s.edit({ from: pos(0, 0), to: pos(0, 0) }, 'a', 'command');
  s.undo();
  assert.equal(s.history.canRedo, true);
  s.edit({ from: pos(0, 0), to: pos(0, 0) }, 'z', 'command');
  assert.equal(s.history.canRedo, false);
});

test('undo restores the selection from before the edit', () => {
  const s = makeSession('abc');
  s.edit({ from: pos(0, 1), to: pos(0, 2) }, 'XY', 'command');
  assert.deepEqual(s.selection.head, pos(0, 3));
  s.undo();
  assert.deepEqual(s.selection.head, pos(0, 0));
  s.redo();
  assert.deepEqual(s.selection.head, pos(0, 3));
});

test('undo and redo survive many round trips', () => {
  const s = makeSession('start');
  s.edit({ from: pos(0, 5), to: pos(0, 5) }, '\nsecond', 'command');
  s.edit({ from: pos(1, 6), to: pos(1, 6) }, '\nthird', 'command');
  const final = s.buffer.getText();

  for (let i = 0; i < 3; i++) {
    s.undo();
    s.undo();
    assert.equal(s.buffer.getText(), 'start');
    s.redo();
    s.redo();
    assert.equal(s.buffer.getText(), final);
  }
});

test('undo with nothing recorded is a no-op', () => {
  const s = makeSession('abc');
  assert.equal(s.undo(), null);
  assert.equal(s.buffer.getText(), 'abc');
});
