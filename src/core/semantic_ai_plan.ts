import type { TutorMove } from './tutor_move';

export type SemanticTutorMode = 'full' | 'incoming' | 'outgoing';

export interface SemanticAiTutorPlan {
  summary: string;
  moves: TutorMove[];
  model: string;
  mode: SemanticTutorMode;
  symbolName: string;
  nodeCount: number;
}
