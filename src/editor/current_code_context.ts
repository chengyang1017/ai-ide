import type { CurrentCodeContext } from '../core/current_code_context';
import type { EditorController } from './editor_controller';

const CONTEXT_RADIUS = 7;
const MAX_SELECTED_TEXT = 12_000;

export function captureCurrentCodeContext(
  editorController: EditorController,
): CurrentCodeContext | null {
  const editor = editorController.editor;
  const model = editor.getModel();
  const position = editor.getPosition();
  if (!model || !position) {
    return null;
  }

  const selection = editor.getSelection();
  const hasSelection = Boolean(selection && !selection.isEmpty());
  const selectedText = hasSelection && selection
    ? model.getValueInRange(selection).trim().slice(0, MAX_SELECTED_TEXT)
    : '';
  const word = model.getWordAtPosition(position);
  const query = word?.word && word.word.length >= 2
    ? word.word.slice(0, 120)
    : null;

  const focusLine = hasSelection && selection
    ? selection.startLineNumber
    : position.lineNumber;
  const startLine = Math.max(1, focusLine - CONTEXT_RADIUS);
  const endLine = Math.min(model.getLineCount(), focusLine + CONTEXT_RADIUS);
  const nearbyCode: string[] = [];

  for (let line = startLine; line <= endLine; line += 1) {
    const marker = line === focusLine ? '>' : ' ';
    nearbyCode.push(
      `${marker} ${String(line).padStart(4, ' ')} | ${model.getLineContent(line)}`,
    );
  }

  const currentLineText = model.getLineContent(position.lineNumber).trim();
  if (!selectedText && !query && !currentLineText) {
    return null;
  }

  return {
    filePath: editorController.path,
    language: model.getLanguageId(),
    line: focusLine,
    column: hasSelection && selection
      ? selection.startColumn
      : position.column,
    selectedText: selectedText || currentLineText.slice(0, MAX_SELECTED_TEXT),
    query,
    nearbyCode: nearbyCode.join('\n'),
    isDirty: editorController.isDirty(),
    selectionStartLine: hasSelection && selection ? selection.startLineNumber : null,
    selectionStartColumn: hasSelection && selection ? selection.startColumn : null,
    selectionEndLine: hasSelection && selection ? selection.endLineNumber : null,
    selectionEndColumn: hasSelection && selection ? selection.endColumn : null,
  };
}
