import type { TutorMove } from './tutor_move';

export interface TutorFocus {
  filePath: string;
  line: number;
  column: number;
  selectedText: string;
  query: string | null;
}

export interface AiTutorPlan {
  summary: string;
  moves: TutorMove[];
  model: string;
  candidateCount: number;
}
