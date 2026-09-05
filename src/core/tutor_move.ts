export type TutorAction = 'jump' | 'point' | 'think';

/**
 * 编辑器无关的角色移动协议。
 * 未来无论目标来自本地检索、AI、LSP 还是测试脚本，
 * CharacterController 都只需要执行这个结构。
 */
export interface TutorMove {
  filePath: string;
  line: number;
  column: number;
  speech: string;
  action: TutorAction;
  waitMs?: number;
  /** Agent 跟随等高频移动可以关闭 TTS，只保留机器人和气泡。 */
  voice?: boolean;
}
