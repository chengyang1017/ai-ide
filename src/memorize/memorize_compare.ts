export interface MemorizeComparison {
  correct: boolean;
  expectedNormalized: string;
  actualNormalized: string;
}

/**
 * 忽略代码排版产生的 whitespace，但保留字符串和注释内部的 whitespace。
 *
 * 这不是完整语言 parser；它覆盖 Dart / TS / JS 等常见代码里的：
 * - 单引号 / 双引号 / 反引号字符串
 * - Dart/Python 风格三引号字符串
 * - // 行注释
 * - /* 块注释 *\/
 */
export function normalizeMemorizeCode(value: string): string {
  const source = value.replace(/\r\n?/g, '\n');
  let result = '';
  let index = 0;

  type Mode =
    | 'code'
    | 'single'
    | 'double'
    | 'template'
    | 'triple-single'
    | 'triple-double'
    | 'line-comment'
    | 'block-comment';

  let mode: Mode = 'code';
  let escaped = false;

  while (index < source.length) {
    const char = source[index] ?? '';
    const next = source[index + 1] ?? '';
    const triple = source.slice(index, index + 3);

    if (mode === 'code') {
      if (/\s/.test(char)) {
        index += 1;
        continue;
      }

      if (char === '/' && next === '/') {
        result += '//';
        mode = 'line-comment';
        index += 2;
        continue;
      }

      if (char === '/' && next === '*') {
        result += '/*';
        mode = 'block-comment';
        index += 2;
        continue;
      }

      if (triple === "'''") {
        result += triple;
        mode = 'triple-single';
        index += 3;
        continue;
      }

      if (triple === '\"\"\"') {
        result += triple;
        mode = 'triple-double';
        index += 3;
        continue;
      }

      if (char === "'") {
        result += char;
        mode = 'single';
        escaped = false;
        index += 1;
        continue;
      }

      if (char === '"') {
        result += char;
        mode = 'double';
        escaped = false;
        index += 1;
        continue;
      }

      if (char === '`') {
        result += char;
        mode = 'template';
        escaped = false;
        index += 1;
        continue;
      }

      result += char;
      index += 1;
      continue;
    }

    if (mode === 'line-comment') {
      result += char;
      index += 1;
      if (char === '\n') {
        mode = 'code';
      }
      continue;
    }

    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        result += '*/';
        mode = 'code';
        index += 2;
        continue;
      }

      result += char;
      index += 1;
      continue;
    }

    if (mode === 'triple-single' || mode === 'triple-double') {
      const delimiter = mode === 'triple-single' ? "'''" : '\"\"\"';
      if (triple === delimiter) {
        result += delimiter;
        mode = 'code';
        index += 3;
        continue;
      }

      result += char;
      index += 1;
      continue;
    }

    result += char;
    index += 1;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    const delimiter =
      mode === 'single'
        ? "'"
        : mode === 'double'
          ? '"'
          : '`';

    if (char === delimiter) {
      mode = 'code';
    }
  }

  return result;
}

export function compareMemorizeCode(
  expected: string,
  actual: string,
): MemorizeComparison {
  const expectedNormalized = normalizeMemorizeCode(expected);
  const actualNormalized = normalizeMemorizeCode(actual);

  return {
    correct: expectedNormalized === actualNormalized,
    expectedNormalized,
    actualNormalized,
  };
}
