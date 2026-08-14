const { app, BrowserWindow, dialog, ipcMain } = require('electron/main');
const fs = require('node:fs/promises');
const path = require('node:path');

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.dart_tool',
  '.idea',
  '.gradle',
  '.next',
  '.nuxt',
  'coverage',
]);

const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.dart', '.env', '.go', '.gradle',
  '.h', '.hpp', '.html', '.java', '.js', '.jsx', '.json', '.kt', '.kts',
  '.less', '.mjs', '.cjs', '.md', '.php', '.prisma', '.py', '.rb', '.rs',
  '.scss', '.sql', '.svelte', '.swift', '.toml', '.ts', '.tsx', '.txt',
  '.vue', '.xml', '.yaml', '.yml',
]);

const MAX_PROJECT_FILES = 5000;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

let currentProjectRoot = null;
let currentProjectFiles = [];
let runtimeOpenAiKey = process.env.OPENAI_API_KEY?.trim() || '';

const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || 'gpt-5.2';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const MAX_AI_CANDIDATES = 14;
const AI_CONTEXT_RADIUS = 5;

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#111318',
    title: 'AI Code Tutor IDE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (app.isPackaged) {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    void window.loadURL('http://127.0.0.1:5173');
  }
}

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    title: '打开代码项目',
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const rootPath = path.resolve(result.filePaths[0]);
  const files = await collectProjectFiles(rootPath);
  currentProjectRoot = rootPath;
  currentProjectFiles = files;

  return {
    rootPath,
    projectName: path.basename(rootPath),
    files,
  };
});

ipcMain.handle('project:read-file', async (_event, relativePath) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('文件路径无效。');
  }

  const targetPath = resolveInsideProject(currentProjectRoot, relativePath);
  const stat = await fs.stat(targetPath);

  if (!stat.isFile()) {
    throw new Error('目标不是文件。');
  }

  if (stat.size > MAX_TEXT_FILE_BYTES) {
    throw new Error('这个文件超过 2 MB，Alpha 0.2 暂不直接打开。');
  }

  const content = await fs.readFile(targetPath, 'utf8');
  return {
    path: normalizeRelativePath(relativePath),
    content,
  };
});


ipcMain.handle('project:search', async (_event, rawQuery) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  const query = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  if (query.length < 2 || query.length > 80) {
    throw new Error('搜索词长度需要在 2 到 80 个字符之间。');
  }

  return searchProjectInternal(query, 40);
});

ipcMain.handle('ai:has-key', () => runtimeOpenAiKey.length > 0);

ipcMain.handle('ai:set-key', (_event, rawApiKey) => {
  const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : '';
  if (apiKey.length < 8) {
    throw new Error('OpenAI API Key 无效。');
  }

  runtimeOpenAiKey = apiKey;
  return true;
});

ipcMain.handle('ai:plan-tour', async (_event, rawFocus) => {
  if (!currentProjectRoot) {
    throw new Error('请先打开一个项目。');
  }

  if (!runtimeOpenAiKey) {
    throw new Error('请先设置 OpenAI API Key。');
  }

  const focus = validateTutorFocus(rawFocus);
  const candidates = await buildTutorCandidates(focus);
  const aiPlan = await requestTutorPlan(focus, candidates);

  return {
    summary: aiPlan.summary,
    model: OPENAI_MODEL,
    candidateCount: candidates.length,
    moves: aiPlan.steps.map((step) => {
      const candidate = candidates.find((item) => item.id === step.candidateId);
      if (!candidate) {
        throw new Error(`AI 返回了不存在的候选位置：${step.candidateId}`);
      }

      return {
        filePath: candidate.path,
        line: candidate.line,
        column: candidate.column,
        action: step.action,
        speech: step.speech,
        waitMs: 1900,
      };
    }),
  };
});

function validateTutorFocus(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('当前代码上下文无效。');
  }

  const filePath = typeof value.filePath === 'string'
    ? normalizeRelativePath(value.filePath)
    : '';
  const selectedText = typeof value.selectedText === 'string'
    ? value.selectedText.trim().slice(0, 6000)
    : '';
  const query = typeof value.query === 'string'
    ? value.query.trim().slice(0, 80)
    : null;
  const line = Number.isInteger(value.line) ? value.line : 1;
  const column = Number.isInteger(value.column) ? value.column : 1;

  if (!currentProjectFiles.includes(filePath)) {
    throw new Error('当前文件不属于已打开项目。');
  }

  if (selectedText.length === 0 && (!query || query.length < 2)) {
    throw new Error('请先选中一段代码，或把光标放在一个标识符上。');
  }

  return {
    filePath,
    selectedText,
    query: query && query.length >= 2 ? query : null,
    line: Math.max(1, line),
    column: Math.max(1, column),
  };
}

async function buildTutorCandidates(focus) {
  const candidates = [];
  const seen = new Set();

  const currentSnippet = await readSnippet(
    focus.filePath,
    focus.line,
    AI_CONTEXT_RADIUS + 3,
  );

  candidates.push({
    id: 'current',
    path: focus.filePath,
    line: focus.line,
    column: focus.column,
    preview: focus.selectedText || currentSnippet.focusLine,
    snippet: currentSnippet.text,
    reason: '用户当前正在看的代码',
  });
  seen.add(`${focus.filePath}:${focus.line}:${focus.column}`);

  if (!focus.query) {
    return candidates;
  }

  const matches = await searchProjectInternal(focus.query, MAX_AI_CANDIDATES * 2);
  for (const match of matches) {
    if (candidates.length >= MAX_AI_CANDIDATES) {
      break;
    }

    const key = `${match.path}:${match.line}:${match.column}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const snippet = await readSnippet(match.path, match.line, AI_CONTEXT_RADIUS);
    candidates.push({
      id: `candidate-${candidates.length}`,
      path: match.path,
      line: match.line,
      column: match.column,
      preview: match.preview,
      snippet: snippet.text,
      reason: `项目中 “${focus.query}” 的一个匹配位置`,
    });
  }

  return candidates;
}

async function readSnippet(relativePath, focusLine, radius) {
  const absolutePath = resolveInsideProject(currentProjectRoot, relativePath);
  const content = await fs.readFile(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const safeFocus = Math.min(Math.max(1, focusLine), Math.max(1, lines.length));
  const start = Math.max(1, safeFocus - radius);
  const end = Math.min(lines.length, safeFocus + radius);
  const text = lines
    .slice(start - 1, end)
    .map((line, index) => {
      const absoluteLine = start + index;
      const marker = absoluteLine === safeFocus ? '>' : ' ';
      return `${marker} ${String(absoluteLine).padStart(4, ' ')} | ${line}`;
    })
    .join('\n');

  return {
    text,
    focusLine: lines[safeFocus - 1]?.trim() || '',
  };
}

async function requestTutorPlan(focus, candidates) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtimeOpenAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        reasoning: { effort: 'low' },
        input: [
          {
            role: 'system',
            content: AI_TUTOR_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: buildAiTutorPrompt(focus, candidates),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'ai_code_tutor_project_tour',
            strict: true,
            schema: buildAiTutorSchema(candidates),
          },
        },
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `OpenAI API 请求失败（HTTP ${response.status}）`;
      throw new Error(message);
    }

    if (payload.status === 'incomplete') {
      throw new Error(`AI 返回内容不完整：${payload.incomplete_details?.reason || 'unknown'}`);
    }

    const outputText = extractOpenAiOutputText(payload);
    const decoded = JSON.parse(outputText);
    validateAiPlan(decoded, candidates);
    return decoded;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('AI 项目分析超时，请稍后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildAiTutorPrompt(focus, candidates) {
  const candidateText = candidates.map((candidate) => {
    return `候选 ID：${candidate.id}\n文件：${candidate.path}\n目标：第 ${candidate.line} 行，第 ${candidate.column} 列\n说明：${candidate.reason}\n代码：\n${candidate.snippet}`;
  }).join('\n\n---\n\n');

  return `用户正在学习一个真实代码项目。\n\n当前文件：${focus.filePath}\n当前行：${focus.line}\n当前选中/所在代码：\n${focus.selectedText || '(未选中文本)'}\n搜索标识符：${focus.query || '(没有可用于跨文件检索的标识符)'}\n\n下面是 IDE 已经从项目中检索并读取的真实候选位置。你只能从这些候选 ID 中选择角色要去的位置，不允许编造文件或行号。\n\n${candidateText}\n\n请规划一条 1 到 6 步的教学路线。不要为了数量把所有同名文本都走一遍；优先挑真正有助于理解定义、调用、数据流或功能链的位置。第一步可以保留在 current，也可以直接跳到更关键的候选。`;
}

function extractOpenAiOutputText(payload) {
  for (const output of payload.output || []) {
    if (output.type !== 'message') {
      continue;
    }
    for (const content of output.content || []) {
      if (content.type === 'refusal') {
        throw new Error(content.refusal || 'AI 拒绝了这次项目讲解请求。');
      }
      if (content.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }
  throw new Error('AI 没有返回可用的项目讲解路线。');
}

function validateAiPlan(plan, candidates) {
  if (!plan || typeof plan !== 'object' || typeof plan.summary !== 'string' || !Array.isArray(plan.steps)) {
    throw new Error('AI 返回的项目讲解格式无效。');
  }

  if (plan.steps.length < 1 || plan.steps.length > 6) {
    throw new Error('AI 返回的讲解步骤数量无效。');
  }

  const validIds = new Set(candidates.map((candidate) => candidate.id));
  for (const step of plan.steps) {
    if (
      !step
      || typeof step !== 'object'
      || !validIds.has(step.candidateId)
      || !['jump', 'point', 'think'].includes(step.action)
      || typeof step.speech !== 'string'
      || step.speech.trim().length === 0
    ) {
      throw new Error('AI 返回了无法执行的角色步骤。');
    }
  }
}

const AI_TUTOR_SYSTEM_PROMPT = `你是住在代码编辑器里的 AI 编程导师。
你的工作不是把所有搜索结果逐个念出来，而是从 IDE 已提供的真实候选代码位置中，规划一条适合学习者理解代码功能链的路线。

要求：
1. 使用简体中文，像老师带着学生读代码一样自然。
2. 只能选择提示里存在的 candidateId，绝对不能编造文件、行号或候选 ID。
3. 优先区分“定义在哪里”“在哪里被调用/使用”“数据流下一步去哪”“为什么这个位置重要”。
4. 文本同名不代表语义相关；如果候选明显只是巧合同名，可以跳过。
5. 路线控制在 1 到 6 步，不要为了凑数量重复讲同一件事。
6. speech 要直接解释当前候选为什么值得看，通常 1 到 3 句话。
7. action 只能是 jump、point、think：
   - jump：跨位置/跨文件带学生去下一站
   - point：指着当前具体代码解释
   - think：说明概念、关系或需要谨慎判断的地方
8. summary 用 1 到 2 句话概括这条教学路线会帮助用户理解什么。
9. 如果现有候选不足以确认完整调用链，要明确说“这些候选只能说明……”，不要假装已经理解整个项目。`;

function buildAiTutorSchema(candidates) {
  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            candidateId: {
              type: 'string',
              enum: candidates.map((candidate) => candidate.id),
            },
            action: {
              type: 'string',
              enum: ['jump', 'point', 'think'],
            },
            speech: { type: 'string' },
          },
          required: ['candidateId', 'action', 'speech'],
          additionalProperties: false,
        },
      },
    },
    required: ['summary', 'steps'],
    additionalProperties: false,
  };
}

async function searchProjectInternal(query, maximumMatches = 40) {
  const matches = [];
  const lowerQuery = query.toLowerCase();
  const BATCH_SIZE = 20;

  for (let offset = 0; offset < currentProjectFiles.length; offset += BATCH_SIZE) {
    if (matches.length >= maximumMatches) {
      break;
    }

    const batch = currentProjectFiles.slice(offset, offset + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (relativePath) => {
      try {
        const absolutePath = resolveInsideProject(currentProjectRoot, relativePath);
        const content = await fs.readFile(absolutePath, 'utf8');
        return findMatchesInFile(relativePath, content, lowerQuery, maximumMatches);
      } catch {
        return [];
      }
    }));

    for (const result of batchResults) {
      for (const match of result) {
        matches.push(match);
        if (matches.length >= maximumMatches) {
          break;
        }
      }
      if (matches.length >= maximumMatches) {
        break;
      }
    }
  }

  return matches;
}

function findMatchesInFile(relativePath, content, lowerQuery, maximumMatches) {
  const results = [];
  const lines = content.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lowerLine = line.toLowerCase();
    let fromIndex = 0;

    while (results.length < maximumMatches) {
      const matchIndex = lowerLine.indexOf(lowerQuery, fromIndex);
      if (matchIndex < 0) {
        break;
      }

      results.push({
        path: normalizeRelativePath(relativePath),
        line: lineIndex + 1,
        column: matchIndex + 1,
        preview: line.trim(),
      });

      fromIndex = matchIndex + Math.max(1, lowerQuery.length);
    }

    if (results.length >= maximumMatches) {
      break;
    }
  }

  return results;
}

async function collectProjectFiles(rootPath) {
  const files = [];

  async function walk(directoryPath) {
    if (files.length >= MAX_PROJECT_FILES) {
      return;
    }

    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (files.length >= MAX_PROJECT_FILES) {
        return;
      }

      const absolutePath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(absolutePath);
        }
        continue;
      }

      if (!entry.isFile() || !isSupportedTextFile(entry.name)) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      if (stat.size > MAX_TEXT_FILE_BYTES) {
        continue;
      }

      files.push(normalizeRelativePath(path.relative(rootPath, absolutePath)));
    }
  }

  await walk(rootPath);
  return files;
}

function isSupportedTextFile(fileName) {
  if (fileName === '.gitignore' || fileName === '.gitattributes') {
    return true;
  }

  const lowerName = fileName.toLowerCase();
  if (lowerName.startsWith('.env')) {
    return true;
  }

  return TEXT_EXTENSIONS.has(path.extname(lowerName));
}

function resolveInsideProject(rootPath, relativePath) {
  const targetPath = path.resolve(rootPath, relativePath);
  const relative = path.relative(rootPath, targetPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('不能读取项目目录之外的文件。');
  }

  return targetPath;
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
