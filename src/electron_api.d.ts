import type { AiTutorPlan, TutorFocus } from './core/ai_tutor_plan';
import type { SemanticFocus, SemanticNavigationResult } from './core/semantic_navigation';
import type { SemanticAiTutorPlan, SemanticTutorMode } from './core/semantic_ai_plan';

export interface NativeVoiceInfo {
  id: string;
  name: string;
  language: string;
  gender: string;
  description: string;
}

export interface PersistedVoiceState {
  enabled: boolean;
  language: string;
  voiceId: string;
  rate: number;
}

export interface TutorIdeAppState {
  lastProjectRoot: string;
  lastOpenFile: string;
  voice: PersistedVoiceState;
  hasOpenAiKey: boolean;
  nativeTts: boolean;
}

export {};

declare global {
  interface Window {
    tutorIde: {
      openProject(): Promise<{
        rootPath: string;
        projectName: string;
        files: string[];
        lastOpenFile?: string;
      } | null>;
      restoreProject(): Promise<{
        rootPath: string;
        projectName: string;
        files: string[];
        lastOpenFile: string;
      } | null>;
      readProjectFile(relativePath: string): Promise<{
        path: string;
        content: string;
      }>;
      writeProjectFile(relativePath: string, content: string): Promise<{
        path: string;
        bytes: number;
      }>;
      searchProject(query: string): Promise<Array<{
        path: string;
        line: number;
        column: number;
        preview: string;
      }>>;
      findDartSemanticTargets(focus: SemanticFocus): Promise<SemanticNavigationResult>;
      getAppState(): Promise<TutorIdeAppState>;
      updateVoiceState(voiceState: PersistedVoiceState): Promise<PersistedVoiceState>;
      listNativeVoices(): Promise<NativeVoiceInfo[]>;
      synthesizeSpeech(request: {
        text: string;
        voiceId: string;
        rate: number;
      }): Promise<{
        mimeType: string;
        audioBase64: string;
        voiceId: string;
        voiceName: string;
        language: string;
      }>;
      hasOpenAiKey(): Promise<boolean>;
      setOpenAiKey(apiKey: string): Promise<boolean>;
      clearOpenAiKey(): Promise<boolean>;
      planTutorTour(focus: TutorFocus): Promise<AiTutorPlan>;
      planDartSemanticTour(focus: SemanticFocus, mode: SemanticTutorMode): Promise<SemanticAiTutorPlan>;
    };
  }
}
