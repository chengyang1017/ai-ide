import type { TutorMove } from './tutor_move';

export type SemanticTargetKind =
  | 'definition'
  | 'incomingCall'
  | 'outgoingCall'
  | 'reference';

export interface SemanticFocus {
  filePath: string;
  line: number;
  column: number;
  query: string;
  documentText: string;
  selectionStartLine?: number;
  selectionStartColumn?: number;
  selectionEndLine?: number;
  selectionEndColumn?: number;
}

export interface SemanticLocation {
  path: string;
  line: number;
  column: number;
  kind: SemanticTargetKind;
  label: string;
  preview: string;
}

export interface SemanticNavigationResult {
  provider: string;
  mode: 'callHierarchy' | 'references';
  symbolName: string;
  locations: SemanticLocation[];
}

export interface SemanticTutorRoute {
  summary: string;
  moves: TutorMove[];
}
