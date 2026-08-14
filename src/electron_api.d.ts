import type { AiTutorPlan, TutorFocus } from './core/ai_tutor_plan';
import type { SemanticFocus, SemanticNavigationResult } from './core/semantic_navigation';
import type { SemanticAiTutorPlan, SemanticTutorMode } from './core/semantic_ai_plan';

export {};

declare global {
  interface Window {
    tutorIde: {
      openProject(): Promise<{
        rootPath: string;
        projectName: string;
        files: string[];
      } | null>;
      readProjectFile(relativePath: string): Promise<{
        path: string;
        content: string;
      }>;
      searchProject(query: string): Promise<Array<{
        path: string;
        line: number;
        column: number;
        preview: string;
      }>>;
      findDartSemanticTargets(focus: SemanticFocus): Promise<SemanticNavigationResult>;
      hasOpenAiKey(): Promise<boolean>;
      setOpenAiKey(apiKey: string): Promise<boolean>;
      planTutorTour(focus: TutorFocus): Promise<AiTutorPlan>;
      planDartSemanticTour(focus: SemanticFocus, mode: SemanticTutorMode): Promise<SemanticAiTutorPlan>;
    };
  }
}
