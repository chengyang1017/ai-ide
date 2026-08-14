import type { TutorMove } from '../core/tutor_move';

export interface ProjectSearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface NavigationContext {
  query: string;
  currentPath: string;
  currentLine: number;
}

/**
 * Alpha 0.3 的项目导航器。
 * 当前先使用“项目全文检索”建立真实跨文件路线；
 * 下一阶段 AI 只需要把更智能的搜索词 / 目标范围喂给同一套 TutorMove 协议。
 */
export function buildRelatedCodeMoves(
  context: NavigationContext,
  matches: ProjectSearchMatch[],
  maximumMoves = 6,
): TutorMove[] {
  const unique = new Set<string>();
  const filtered = matches.filter((match) => {
    if (match.path === context.currentPath && match.line === context.currentLine) {
      return false;
    }

    const key = `${match.path}:${match.line}:${match.column}`;
    if (unique.has(key)) {
      return false;
    }
    unique.add(key);
    return true;
  });

  const selected = filtered.slice(0, maximumMoves);

  return selected.map((match, index) => ({
    filePath: match.path,
    line: match.line,
    column: match.column,
    action: index === 0 ? 'jump' : 'point',
    speech: buildSpeech(context.query, match, index, selected.length),
    waitMs: 1500,
  }));
}

function buildSpeech(
  query: string,
  match: ProjectSearchMatch,
  index: number,
  total: number,
): string {
  const location = `${match.path} 第 ${match.line} 行`;
  const preview = compact(match.preview, 110);

  if (index === 0) {
    return `我在整个项目里找到了 “${query}” 的相关位置。先跳到 ${location}：${preview}`;
  }

  if (index === total - 1) {
    return `这里也是 “${query}” 的一个位置：${location}。${preview}`;
  }

  return `继续看 ${location}。${preview}`;
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength)}…`;
}
