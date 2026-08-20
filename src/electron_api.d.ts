import type { AiTutorPlan, TutorFocus } from './core/ai_tutor_plan';
import type { SemanticFocus, SemanticNavigationResult } from './core/semantic_navigation';
import type { SemanticAiTutorPlan, SemanticTutorMode } from './core/semantic_ai_plan';
import type { CurrentCodeContext, CurrentCodeExplanation } from './core/current_code_context';
import type { CodeNote, CodeNoteImage } from './notes/code_note_controller';

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


export interface AppearanceState {
  color: string;
  backgroundMode: 'solid' | 'gradient';
  gradientStart: string;
  gradientEnd: string;
  gradientAngle: number;
  scope: 'editor' | 'all';
  imageFile: string;
  imageOpacity: number;
  overlayOpacity: number;
  blur: number;
  fit: 'cover' | 'contain' | 'fill' | 'none';
  position: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'top left' | 'top right' | 'bottom left' | 'bottom right';
}

export interface TutorIdeAppState {
  lastProjectRoot: string;
  lastOpenFile: string;
  voice: PersistedVoiceState;
  appearance: AppearanceState;
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
        directories?: string[];
        lastOpenFile?: string;
      } | null>;
      openGitHubRepository?(url: string): Promise<{
        rootPath: string;
        projectName: string;
        files: string[];
        directories?: string[];
        preferredFile?: string;
        message?: string;
      }>;
      restoreProject(): Promise<{
        rootPath: string;
        projectName: string;
        files: string[];
        directories?: string[];
        lastOpenFile: string;
      } | null>;
      readProjectFile(relativePath: string): Promise<{
        path: string;
        content: string;
      }>;
      readProjectAsset(relativePath: string): Promise<{
        path: string;
        mimeType: string;
        dataUrl: string;
      }>;
      openExternal(url: string): Promise<boolean>;
      writeProjectFile(relativePath: string, content: string): Promise<{
        path: string;
        bytes: number;
      }>;
      watchProjectFile(relativePath: string): Promise<{ path: string }>;
      unwatchProjectFile(): Promise<boolean>;
      onProjectFileChanged(listener: (change: { path: string }) => void): () => void;
      listCodeNotes(relativePath: string): Promise<CodeNote[]>;
      upsertCodeNote(note: {
        id: string;
        filePath: string;
        placement: 'inline' | 'gutter';
        line: number;
        column: number;
        anchorText: string;
        text: string;
        images: CodeNoteImage[];
      }): Promise<CodeNote>;
      deleteCodeNote(id: string): Promise<boolean>;
      importCodeNoteImage(image: {
        name: string;
        mimeType: string;
        dataBase64: string;
      }): Promise<CodeNoteImage & { dataUrl: string }>;
      readCodeNoteImage(assetPath: string): Promise<{
        path: string;
        dataUrl: string;
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
      updateAppearanceState(appearance: Partial<AppearanceState>): Promise<AppearanceState>;
      chooseAppearanceBackground(): Promise<{
        name: string;
        dataUrl: string;
        appearance: AppearanceState;
      } | null>;
      getAppearanceBackground(): Promise<{ name: string; dataUrl: string } | null>;
      clearAppearanceBackground(): Promise<AppearanceState>;
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
      explainCurrentCode(context: CurrentCodeContext): Promise<CurrentCodeExplanation>;
      planTutorTour(focus: TutorFocus): Promise<AiTutorPlan>;
      planDartSemanticTour(focus: SemanticFocus, mode: SemanticTutorMode): Promise<SemanticAiTutorPlan>;
    };
  }
}
