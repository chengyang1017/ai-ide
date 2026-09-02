const { app, ipcMain, safeStorage } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_AGENT_MODEL =
  process.env.OPENAI_AGENT_MODEL?.trim()
  || process.env.OPENAI_MODEL?.trim()
  || 'gpt-5.2';

const MAX_AGENT_ROUNDS = 14;
const MAX_READ_BYTES = 500 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_MATCHES = 80;
const MAX_LIST_ENTRIES = 1200;
const MAX_COMMAND_OUTPUT = 220 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.ai-code-tutor',
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

const activeRuns = new Map();

const AGENT_INSTRUCTIONS = `You are the coding Agent inside Code Tutor IDE.
Work on the user's currently opened local project, not on arbitrary system paths.
Use tools to inspect the project before editing. When the user asks for a code change, perform the change instead of only describing it.
Prefer small, targeted edits. Use replace_text when a precise replacement is possible; use write_file for new files or when a full rewrite is genuinely simpler.
After meaningful code changes, run an appropriate validation command when one of the allowed commands fits the project, such as npm run typecheck, flutter analyze, flutter test, dotnet build/test, or git diff/status.
Do not run destructive shell commands. Do not use the command tool to delete, move, reset, clean, install arbitrary software, or change files outside the project.
Use delete_file only when the user explicitly asks to delete something or deletion is clearly required by the requested refactor.
Every changed or deleted existing file is automatically backed up by the IDE before mutation.
At the end, summarize what changed, which validation ran, and any remaining issue. Keep the final answer concise and concrete.`;

const TOOLS = [
  {
    type: 'function',
    name: 'list_files',
    description: 'List files and directories inside the current project. Use this to understand project structure.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional project-relative directory path. Empty means project root.',
        },
        max_depth: {
          type: 'integer',
          minimum: 1,
          maximum: 6,
          description: 'Maximum recursive depth. Defaults to 3.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'search_text',
    description: 'Search project text files for a literal string and return matching file/line previews.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        path: {
          type: 'string',
          description: 'Optional project-relative directory to limit the search.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'read_file',
    description: 'Read one UTF-8 text file from the current project.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'replace_text',
    description: 'Replace exact text inside an existing UTF-8 project file. Best for targeted edits.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string' },
        new_text: { type: 'string' },
        replace_all: {
          type: 'boolean',
          description: 'Replace all exact occurrences instead of only one. Defaults to false.',
        },
      },
      required: ['path', 'old_text', 'new_text'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'write_file',
    description: 'Write complete UTF-8 content to a project file. Creates the file and parent directories if needed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'create_directory',
    description: 'Create a directory inside the current project.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'delete_file',
    description: 'Delete one project file after creating an automatic backup. Directories cannot be deleted with this tool.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'run_command',
    description: 'Run an allowed non-destructive development command in the project root, such as typecheck, tests, analyze, build, or git status/diff.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
];

function stateFilePath() {
  return path.join(
    app.getPath('userData'),
    'ai-code-tutor',
    'state.json',
  );
}

async function loadOpenAiKey() {
  const environmentKey =
    process.env.OPENAI_API_KEY?.trim() || '';
  if (environmentKey) {
    return environmentKey;
  }

  let state;
  try {
    state = JSON.parse(
      await fs.readFile(stateFilePath(), 'utf8'),
    );
  } catch {
    state = null;
  }

  const encrypted =
    typeof state?.encryptedOpenAiKey === 'string'
      ? state.encryptedOpenAiKey.trim()
      : '';

  if (!encrypted) {
    throw new Error('请先在 IDE 里设置 OpenAI API Key。');
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储当前不可用，无法读取 OpenAI API Key。');
  }

  try {
    return safeStorage.decryptString(
      Buffer.from(encrypted, 'base64'),
    );
  } catch {
    throw new Error('无法解密已保存的 OpenAI API Key，请重新设置 Key。');
  }
}

async function validateProjectRoot(rawRoot) {
  if (
    typeof rawRoot !== 'string'
      || !rawRoot.trim()
      || !path.isAbsolute(rawRoot)
  ) {
    throw new Error('Agent 只能操作当前打开的本地真实项目。');
  }

  const root = path.resolve(rawRoot);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new Error('Agent 项目根目录无效。');
  }
  return root;
}

function normalizeRelativePath(
  rawPath,
  { allowRoot = false } = {},
) {
  if (typeof rawPath !== 'string') {
    throw new Error('项目路径必须是字符串。');
  }

  const normalized = path.posix.normalize(
    rawPath.replace(/\\/g, '/').trim(),
  );

  if (normalized === '.' || normalized === '') {
    if (allowRoot) {
      return '';
    }
    throw new Error('项目路径不能为空。');
  }

  if (
    path.posix.isAbsolute(normalized)
      || normalized === '..'
      || normalized.startsWith('../')
  ) {
    throw new Error('Agent 路径必须位于当前项目内部。');
  }

  return normalized;
}

function resolveInsideProject(
  root,
  rawPath,
  options,
) {
  const relativePath = normalizeRelativePath(
    rawPath,
    options,
  );
  const targetPath = relativePath
    ? path.resolve(root, ...relativePath.split('/'))
    : root;
  const relativeFromRoot = path.relative(root, targetPath);

  if (
    relativeFromRoot === '..'
      || relativeFromRoot.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeFromRoot)
  ) {
    throw new Error('Agent 路径越出了当前项目。');
  }

  return {
    relativePath,
    targetPath,
  };
}

function isIgnoredDirectory(name) {
  return IGNORED_DIRECTORIES.has(name);
}

async function isTextFile(targetPath, maxBytes) {
  const stat = await fs.stat(targetPath);
  if (!stat.isFile() || stat.size > maxBytes) {
    return false;
  }

  const bytes = await fs.readFile(targetPath);
  const probe = bytes.subarray(0, Math.min(bytes.length, 8192));
  return !probe.includes(0);
}

async function readTextFile(root, rawPath) {
  const entry = resolveInsideProject(root, rawPath);
  const stat = await fs.stat(entry.targetPath);
  if (!stat.isFile()) {
    throw new Error(`${entry.relativePath} 不是文件。`);
  }
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(`${entry.relativePath} 超过 Agent 单次读取上限 500 KB。`);
  }

  const bytes = await fs.readFile(entry.targetPath);
  if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) {
    throw new Error(`${entry.relativePath} 看起来是二进制文件，Agent 不直接读取。`);
  }

  return {
    path: entry.relativePath,
    content: bytes.toString('utf8'),
    bytes: bytes.length,
  };
}

async function listProjectEntries(
  root,
  rawPath,
  rawMaxDepth,
) {
  const base = resolveInsideProject(
    root,
    rawPath || '',
    { allowRoot: true },
  );
  const maxDepth = Number.isInteger(rawMaxDepth)
    ? Math.min(6, Math.max(1, rawMaxDepth))
    : 3;
  const result = [];

  async function walk(directoryPath, relativeDirectory, depth) {
    if (
      depth > maxDepth
        || result.length >= MAX_LIST_ENTRIES
    ) {
      return;
    }

    const entries = await fs.readdir(
      directoryPath,
      { withFileTypes: true },
    );
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (result.length >= MAX_LIST_ENTRIES) {
        break;
      }
      if (entry.isDirectory() && isIgnoredDirectory(entry.name)) {
        continue;
      }

      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;

      result.push({
        path: relativePath,
        type: entry.isDirectory() ? 'directory' : 'file',
      });

      if (entry.isDirectory()) {
        await walk(
          path.join(directoryPath, entry.name),
          relativePath,
          depth + 1,
        );
      }
    }
  }

  await walk(
    base.targetPath,
    base.relativePath,
    1,
  );

  return {
    path: base.relativePath,
    entries: result,
    truncated: result.length >= MAX_LIST_ENTRIES,
  };
}

async function collectFiles(root, startPath = '') {
  const base = resolveInsideProject(
    root,
    startPath,
    { allowRoot: true },
  );
  const files = [];

  async function walk(directoryPath, relativeDirectory) {
    if (files.length >= MAX_LIST_ENTRIES) {
      return;
    }

    const entries = await fs.readdir(
      directoryPath,
      { withFileTypes: true },
    );
    for (const entry of entries) {
      if (files.length >= MAX_LIST_ENTRIES) {
        break;
      }
      if (entry.isDirectory() && isIgnoredDirectory(entry.name)) {
        continue;
      }

      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const targetPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        await walk(targetPath, relativePath);
      } else if (entry.isFile()) {
        files.push({ relativePath, targetPath });
      }
    }
  }

  const baseStat = await fs.stat(base.targetPath);
  if (baseStat.isFile()) {
    return [{
      relativePath: base.relativePath,
      targetPath: base.targetPath,
    }];
  }

  await walk(base.targetPath, base.relativePath);
  return files;
}

async function searchProjectText(root, rawQuery, rawPath) {
  const query =
    typeof rawQuery === 'string'
      ? rawQuery
      : '';
  if (!query) {
    throw new Error('search_text 的 query 不能为空。');
  }

  const files = await collectFiles(root, rawPath || '');
  const matches = [];

  for (const file of files) {
    if (matches.length >= MAX_SEARCH_MATCHES) {
      break;
    }

    let stat;
    try {
      stat = await fs.stat(file.targetPath);
    } catch {
      continue;
    }
    if (
      !stat.isFile()
        || stat.size > MAX_SEARCH_FILE_BYTES
    ) {
      continue;
    }

    let bytes;
    try {
      bytes = await fs.readFile(file.targetPath);
    } catch {
      continue;
    }
    if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) {
      continue;
    }

    const lines = bytes.toString('utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes(query)) {
        continue;
      }
      matches.push({
        path: file.relativePath,
        line: index + 1,
        preview: lines[index].trim().slice(0, 300),
      });
      if (matches.length >= MAX_SEARCH_MATCHES) {
        break;
      }
    }
  }

  return {
    query,
    matches,
    truncated: matches.length >= MAX_SEARCH_MATCHES,
  };
}

async function backupFile(run, relativePath, targetPath) {
  if (run.backedUp.has(relativePath)) {
    return;
  }

  let stat;
  try {
    stat = await fs.stat(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  if (!stat.isFile()) {
    return;
  }

  const backupPath = path.join(
    run.root,
    '.ai-code-tutor',
    'agent-backups',
    run.runId,
    ...relativePath.split('/'),
  );
  await fs.mkdir(path.dirname(backupPath), {
    recursive: true,
  });
  await fs.copyFile(targetPath, backupPath);
  run.backedUp.add(relativePath);
}

async function replaceText(run, args) {
  const file = await readTextFile(run.root, args.path);
  const oldText =
    typeof args.old_text === 'string'
      ? args.old_text
      : '';
  const newText =
    typeof args.new_text === 'string'
      ? args.new_text
      : '';

  if (!oldText) {
    throw new Error('replace_text 的 old_text 不能为空。');
  }

  const firstIndex = file.content.indexOf(oldText);
  if (firstIndex < 0) {
    throw new Error(`在 ${file.path} 中找不到指定 old_text。`);
  }

  let nextContent;
  let replacements;
  if (args.replace_all === true) {
    replacements = file.content.split(oldText).length - 1;
    nextContent = file.content.split(oldText).join(newText);
  } else {
    replacements = 1;
    nextContent =
      file.content.slice(0, firstIndex)
      + newText
      + file.content.slice(firstIndex + oldText.length);
  }

  const nextBytes = Buffer.byteLength(nextContent, 'utf8');
  if (nextBytes > MAX_WRITE_BYTES) {
    throw new Error(`${file.path} 修改后超过 2 MB 写入上限。`);
  }

  const entry = resolveInsideProject(run.root, file.path);
  await backupFile(run, file.path, entry.targetPath);
  await fs.writeFile(entry.targetPath, nextContent, 'utf8');
  run.changedFiles.add(file.path);
  run.deletedFiles.delete(file.path);

  return {
    path: file.path,
    replacements,
    bytes: nextBytes,
  };
}

async function writeFile(run, args) {
  const relativePath = normalizeRelativePath(args.path);
  const content =
    typeof args.content === 'string'
      ? args.content
      : null;
  if (content === null) {
    throw new Error('write_file content 必须是字符串。');
  }

  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) {
    throw new Error(`${relativePath} 超过 2 MB 写入上限。`);
  }

  const entry = resolveInsideProject(run.root, relativePath);
  await backupFile(run, relativePath, entry.targetPath);
  await fs.mkdir(path.dirname(entry.targetPath), {
    recursive: true,
  });
  await fs.writeFile(entry.targetPath, content, 'utf8');
  run.changedFiles.add(relativePath);
  run.deletedFiles.delete(relativePath);

  return {
    path: relativePath,
    bytes,
  };
}

async function createDirectory(run, args) {
  const entry = resolveInsideProject(run.root, args.path);
  await fs.mkdir(entry.targetPath, {
    recursive: true,
  });
  return {
    path: entry.relativePath,
  };
}

async function deleteFile(run, args) {
  const entry = resolveInsideProject(run.root, args.path);
  const stat = await fs.stat(entry.targetPath);
  if (!stat.isFile()) {
    throw new Error('delete_file 只允许删除文件，不允许删除目录。');
  }

  await backupFile(
    run,
    entry.relativePath,
    entry.targetPath,
  );
  await fs.unlink(entry.targetPath);
  run.changedFiles.delete(entry.relativePath);
  run.deletedFiles.add(entry.relativePath);

  return {
    path: entry.relativePath,
    deleted: true,
  };
}

function allowedCommand(rawCommand) {
  const command =
    typeof rawCommand === 'string'
      ? rawCommand.trim()
      : '';
  if (!command || command.length > 500) {
    return null;
  }

  const rules = [
    /^npm(?:\.cmd)?\s+(?:run\s+[\w:.-]+|test\b|--version\b)/i,
    /^npx(?:\.cmd)?\s+tsc\b/i,
    /^flutter\s+(?:analyze\b|test\b|build\b|doctor\b|pub\s+get\b)/i,
    /^dart\s+(?:analyze\b|test\b|format\b|--version\b)/i,
    /^dotnet\s+(?:build\b|test\b|restore\b|--version\b)/i,
    /^python(?:3)?\s+(?:-m\s+pytest\b|--version\b)/i,
    /^pytest\b/i,
    /^git\s+(?:status\b|diff\b|log\b|branch\b|rev-parse\b)/i,
    /^node\s+--version\b/i,
    /^tsc\b/i,
  ];

  return rules.some((rule) => rule.test(command))
    ? command
    : null;
}

async function runAllowedCommand(run, args) {
  const command = allowedCommand(args.command);
  if (!command) {
    throw new Error(
      '这个命令不在 Agent 第一版安全白名单里。允许 typecheck/test/analyze/build 和只读 git 命令。',
    );
  }

  return new Promise((resolve, reject) => {
    const shell = process.platform === 'win32'
      ? {
          command: 'powershell.exe',
          args: [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            command,
          ],
        }
      : {
          command: process.env.SHELL?.trim() || '/bin/bash',
          args: ['-lc', command],
        };

    const child = spawn(
      shell.command,
      shell.args,
      {
        cwd: run.root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    function append(current, chunk) {
      const next = current + String(chunk);
      return next.length > MAX_COMMAND_OUTPUT
        ? next.slice(-MAX_COMMAND_OUTPUT)
        : next;
    }

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      try {
        child.kill();
      } catch {
        // Ignore process shutdown races.
      }
    }, COMMAND_TIMEOUT_MS);

    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // Ignore process shutdown races.
      }
    };
    run.controller.signal.addEventListener(
      'abort',
      onAbort,
      { once: true },
    );

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      run.controller.signal.removeEventListener(
        'abort',
        onAbort,
      );
      reject(error);
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      run.controller.signal.removeEventListener(
        'abort',
        onAbort,
      );

      if (run.controller.signal.aborted) {
        reject(new Error('Agent 已停止。'));
        return;
      }

      resolve({
        command,
        code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

function parseToolArguments(call) {
  if (typeof call.arguments !== 'string') {
    return {};
  }
  try {
    return JSON.parse(call.arguments);
  } catch {
    throw new Error(`${call.name} 的工具参数不是有效 JSON。`);
  }
}

async function executeTool(run, name, args) {
  switch (name) {
    case 'list_files':
      return listProjectEntries(
        run.root,
        args.path || '',
        args.max_depth,
      );
    case 'search_text':
      return searchProjectText(
        run.root,
        args.query,
        args.path || '',
      );
    case 'read_file':
      return readTextFile(run.root, args.path);
    case 'replace_text':
      return replaceText(run, args);
    case 'write_file':
      return writeFile(run, args);
    case 'create_directory':
      return createDirectory(run, args);
    case 'delete_file':
      return deleteFile(run, args);
    case 'run_command':
      return runAllowedCommand(run, args);
    default:
      throw new Error(`未知 Agent 工具：${name}`);
  }
}

function sendAgentEvent(sender, payload) {
  if (!sender.isDestroyed()) {
    sender.send('agent:event', payload);
  }
}

function summarizeToolResult(name, result) {
  if (name === 'read_file') {
    return `${result.path} · ${result.bytes} bytes`;
  }
  if (name === 'list_files') {
    return `${result.entries.length} 个项目${result.truncated ? ' · 已截断' : ''}`;
  }
  if (name === 'search_text') {
    return `${result.matches.length} 个匹配${result.truncated ? ' · 已截断' : ''}`;
  }
  if (name === 'run_command') {
    return `${result.command} · exit ${String(result.code)}`;
  }
  if (result?.path) {
    return result.path;
  }
  return '完成';
}

async function requestResponse(apiKey, input, signal) {
  const response = await fetch(
    `${OPENAI_BASE_URL}/responses`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_AGENT_MODEL,
        instructions: AGENT_INSTRUCTIONS,
        input,
        tools: TOOLS,
        tool_choice: 'auto',
      }),
      signal,
    },
  );

  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail =
        payload?.error?.message
        || payload?.message
        || '';
    } catch {
      detail = await response.text().catch(() => '');
    }
    throw new Error(
      `OpenAI Agent 请求失败 (${response.status})${detail ? `：${detail}` : ''}`,
    );
  }

  return response.json();
}

function finalTextFromResponse(response) {
  const chunks = [];
  for (const item of response?.output ?? []) {
    if (item?.type !== 'message') {
      continue;
    }
    for (const content of item.content ?? []) {
      if (
        content?.type === 'output_text'
          && typeof content.text === 'string'
      ) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

function compactProjectContext(root, activeFile, files) {
  const relativeActive =
    typeof activeFile === 'string'
      ? activeFile.trim()
      : '';
  const fileLines = files
    .filter((entry) => entry.type === 'file')
    .slice(0, 350)
    .map((entry) => `- ${entry.path}`)
    .join('\n');

  return [
    `Project root: ${root}`,
    `Current editor file: ${relativeActive || '(none)'}`,
    'Project file sample:',
    fileLines || '(no files found)',
  ].join('\n');
}

ipcMain.handle(
  'agent:run',
  async (event, rawRoot, rawRequest) => {
    const senderId = event.sender.id;
    if (activeRuns.has(senderId)) {
      throw new Error('已有一个 Agent 任务正在运行。');
    }

    const root = await validateProjectRoot(rawRoot);
    const prompt =
      typeof rawRequest?.prompt === 'string'
        ? rawRequest.prompt.trim()
        : '';
    const activeFile =
      typeof rawRequest?.activeFile === 'string'
        ? rawRequest.activeFile.trim()
        : '';

    if (!prompt) {
      throw new Error('请输入 Agent 任务。');
    }
    if (prompt.length > 20_000) {
      throw new Error('Agent 任务描述过长。');
    }

    const apiKey = await loadOpenAiKey();
    const controller = new AbortController();
    const run = {
      runId: randomUUID(),
      root,
      controller,
      backedUp: new Set(),
      changedFiles: new Set(),
      deletedFiles: new Set(),
    };
    activeRuns.set(senderId, run);

    event.sender.once('destroyed', () => {
      if (activeRuns.get(senderId) === run) {
        controller.abort();
        activeRuns.delete(senderId);
      }
    });

    try {
      sendAgentEvent(event.sender, {
        runId: run.runId,
        type: 'status',
        message: `Agent 已启动 · ${OPENAI_AGENT_MODEL}`,
      });

      const projectListing = await listProjectEntries(
        root,
        '',
        3,
      );
      const input = [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                compactProjectContext(
                  root,
                  activeFile,
                  projectListing.entries,
                ),
                '',
                'User task:',
                prompt,
              ].join('\n'),
            },
          ],
        },
      ];

      let finalMessage = '';
      let rounds = 0;

      while (rounds < MAX_AGENT_ROUNDS) {
        if (controller.signal.aborted) {
          throw new Error('Agent 已停止。');
        }
        rounds += 1;

        sendAgentEvent(event.sender, {
          runId: run.runId,
          type: 'thinking',
          message: `Agent 正在处理 · 第 ${rounds} 轮`,
        });

        const response = await requestResponse(
          apiKey,
          input,
          controller.signal,
        );

        const output = Array.isArray(response?.output)
          ? response.output
          : [];
        input.push(...output);

        const toolCalls = output.filter(
          (item) => item?.type === 'function_call',
        );

        if (toolCalls.length === 0) {
          finalMessage = finalTextFromResponse(response);
          break;
        }

        for (const call of toolCalls) {
          if (controller.signal.aborted) {
            throw new Error('Agent 已停止。');
          }

          const args = parseToolArguments(call);
          sendAgentEvent(event.sender, {
            runId: run.runId,
            type: 'tool_start',
            tool: call.name,
            message: `${call.name}…`,
          });

          let toolOutput;
          try {
            toolOutput = await executeTool(
              run,
              call.name,
              args,
            );
            sendAgentEvent(event.sender, {
              runId: run.runId,
              type: 'tool_result',
              tool: call.name,
              message: summarizeToolResult(
                call.name,
                toolOutput,
              ),
            });
          } catch (error) {
            toolOutput = {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : String(error),
            };
            sendAgentEvent(event.sender, {
              runId: run.runId,
              type: 'tool_error',
              tool: call.name,
              message: toolOutput.error,
            });
          }

          input.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(toolOutput),
          });
        }
      }

      if (!finalMessage) {
        finalMessage =
          rounds >= MAX_AGENT_ROUNDS
            ? 'Agent 达到本轮最大工具循环次数，请缩小任务或继续下一轮。'
            : 'Agent 已完成。';
      }

      const result = {
        runId: run.runId,
        model: OPENAI_AGENT_MODEL,
        message: finalMessage,
        changedFiles: Array.from(run.changedFiles),
        deletedFiles: Array.from(run.deletedFiles),
        backupDirectory: run.backedUp.size > 0
          ? `.ai-code-tutor/agent-backups/${run.runId}`
          : '',
      };

      sendAgentEvent(event.sender, {
        runId: run.runId,
        type: 'done',
        message: finalMessage,
        changedFiles: result.changedFiles,
        deletedFiles: result.deletedFiles,
      });

      return result;
    } catch (error) {
      const message =
        error?.name === 'AbortError'
          ? 'Agent 已停止。'
          : error instanceof Error
            ? error.message
            : String(error);

      sendAgentEvent(event.sender, {
        runId: run.runId,
        type: 'error',
        message,
      });
      throw new Error(message);
    } finally {
      if (activeRuns.get(senderId) === run) {
        activeRuns.delete(senderId);
      }
    }
  },
);

ipcMain.handle('agent:cancel', (event) => {
  const run = activeRuns.get(event.sender.id);
  if (!run) {
    return false;
  }
  run.controller.abort();
  activeRuns.delete(event.sender.id);
  return true;
});
