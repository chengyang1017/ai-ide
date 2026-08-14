import type {
  SemanticLocation,
  SemanticNavigationResult,
  SemanticTutorRoute,
} from '../core/semantic_navigation';
import type { TutorMove } from '../core/tutor_move';

export function buildSemanticTutorRoute(
  result: SemanticNavigationResult,
  maximumMoves = 10,
): SemanticTutorRoute {
  const ordered = orderLocations(result.locations).slice(0, maximumMoves);
  const symbol = result.symbolName || '当前符号';

  const moves: TutorMove[] = ordered.map((location, index) => ({
    filePath: location.path,
    line: location.line,
    column: location.column,
    action: index === 0 ? 'jump' : actionFor(location),
    speech: speechFor(symbol, location, result.mode),
    waitMs: 1700,
  }));

  const summary = result.mode === 'callHierarchy'
    ? `Dart Analyzer 找到了 “${symbol}” 的定义与真实调用关系。`
    : `Dart Analyzer 没有为 “${symbol}” 提供调用层级，已退回语义定义与引用。`;

  return { summary, moves };
}

function orderLocations(locations: SemanticLocation[]): SemanticLocation[] {
  const priority: Record<SemanticLocation['kind'], number> = {
    definition: 0,
    incomingCall: 1,
    outgoingCall: 2,
    reference: 3,
  };

  return [...locations].sort((a, b) => {
    const kindDifference = priority[a.kind] - priority[b.kind];
    if (kindDifference !== 0) {
      return kindDifference;
    }
    const pathDifference = a.path.localeCompare(b.path);
    return pathDifference !== 0 ? pathDifference : a.line - b.line;
  });
}

function actionFor(location: SemanticLocation): TutorMove['action'] {
  if (location.kind === 'definition') {
    return 'point';
  }
  if (location.kind === 'incomingCall' || location.kind === 'outgoingCall') {
    return 'jump';
  }
  return 'point';
}

function speechFor(
  symbol: string,
  location: SemanticLocation,
  mode: SemanticNavigationResult['mode'],
): string {
  const locationText = `${location.path} 第 ${location.line} 行`;
  const preview = compact(location.preview, 115);

  switch (location.kind) {
    case 'definition':
      return `先看 “${symbol}” 的定义。Dart Analyzer 把我带到 ${locationText}。${preview}`;
    case 'incomingCall':
      return `这里是真正调用 “${symbol}” 的位置${location.label ? `，调用者是 ${location.label}` : ''}：${locationText}。${preview}`;
    case 'outgoingCall':
      return `“${symbol}” 又会调用这里${location.label ? `：${location.label}` : ''}。目标在 ${locationText}。${preview}`;
    case 'reference':
      return `${mode === 'references' ? '调用层级不适用于这个符号，所以我改看语义引用。' : '这里还有一个语义引用。'} ${locationText}。${preview}`;
  }
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength)}…`;
}
