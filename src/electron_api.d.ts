import type { AiTutorPlan, TutorFocus } from './core/ai_tutor_plan';

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
      hasOpenAiKey(): Promise<boolean>;
      setOpenAiKey(apiKey: string): Promise<boolean>;
      planTutorTour(focus: TutorFocus): Promise<AiTutorPlan>;
    };
  }
}
