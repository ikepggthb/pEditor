import type { Editor } from '../core/editor.ts';
import {
  deleteBackward,
  deleteForward,
  deleteToLineEnd,
  deleteWordBackward,
  duplicateSelection,
  indentLines,
  insertNewline,
  insertTab,
  moveLines,
  moveWord,
  toggleComment,
} from '../core/commands.ts';

/**
 * Hardware-keyboard bindings.
 *
 * A Bluetooth keyboard is a common way to actually get work done on a phone,
 * and this is also what makes the app usable on a desktop browser while
 * developing it. Anything not handled here falls through to `beforeinput`,
 * which is where soft keyboards and IMEs are dealt with.
 */
export function handleKeydown(editor: Editor, event: KeyboardEvent): boolean {
  // 229 / 'Unidentified' means an IME or soft keyboard owns this keystroke.
  if (event.isComposing || event.keyCode === 229) return false;

  const mod = event.metaKey || event.ctrlKey;
  const shift = event.shiftKey;
  const alt = event.altKey;

  switch (event.key) {
    case 'ArrowLeft':
      if (mod) editor.moveToRowEdge('start', shift);
      else if (alt) moveWord(editor, -1, shift);
      else editor.moveHorizontal(-1, shift);
      return true;

    case 'ArrowRight':
      if (mod) editor.moveToRowEdge('end', shift);
      else if (alt) moveWord(editor, 1, shift);
      else editor.moveHorizontal(1, shift);
      return true;

    case 'ArrowUp':
      if (alt) {
        moveLines(editor, -1);
        return true;
      }
      if (mod) editor.moveToDocumentEdge('start', shift);
      else editor.moveVertical(-1, shift);
      return true;

    case 'ArrowDown':
      if (alt) {
        moveLines(editor, 1);
        return true;
      }
      if (mod) editor.moveToDocumentEdge('end', shift);
      else editor.moveVertical(1, shift);
      return true;

    case 'Home':
      editor.moveToRowEdge('start', shift);
      return true;

    case 'End':
      editor.moveToRowEdge('end', shift);
      return true;

    case 'PageUp':
      editor.movePage(-1, shift);
      return true;

    case 'PageDown':
      editor.movePage(1, shift);
      return true;

    case 'Backspace':
      if (alt || mod) deleteWordBackward(editor);
      else deleteBackward(editor);
      return true;

    case 'Delete':
      if (mod) deleteToLineEnd(editor);
      else deleteForward(editor);
      return true;

    case 'Enter':
      insertNewline(editor);
      return true;

    case 'Tab':
      if (shift) indentLines(editor, -1);
      else insertTab(editor);
      return true;

    case 'Escape':
      if (editor.isComposing) editor.cancelComposition();
      return true;

    default:
      break;
  }

  if (!mod) return false;

  switch (event.key.toLowerCase()) {
    case 'a':
      editor.selectAll();
      return true;
    case 'z':
      if (shift) editor.redo();
      else editor.undo();
      return true;
    case 'y':
      editor.redo();
      return true;
    case 'd':
      duplicateSelection(editor);
      return true;
    case '/':
      toggleComment(editor);
      return true;
    case ']':
      indentLines(editor, 1);
      return true;
    case '[':
      indentLines(editor, -1);
      return true;
    default:
      return false;
  }
}
