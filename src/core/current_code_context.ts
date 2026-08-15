export interface CurrentCodeContext {
  filePath: string;
  language: string;
  line: number;
  column: number;
  selectedText: string;
  query: string | null;
  nearbyCode: string;
  isDirty: boolean;
  selectionStartLine: number | null;
  selectionStartColumn: number | null;
  selectionEndLine: number | null;
  selectionEndColumn: number | null;
}

export interface CurrentCodeExplanation {
  explanation: string;
  model: string;
  filePath: string;
  line: number;
  column: number;
  query: string | null;
  usedSelection: boolean;
  usedUnsavedContent: boolean;
}
