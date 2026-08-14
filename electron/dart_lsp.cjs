const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const { pathToFileURL, fileURLToPath } = require('node:url');
const path = require('node:path');

class DartLspClient {
  constructor(rootPath) {
    this.rootPath = rootPath;
    this.process = null;
    this.startPromise = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.openDocuments = new Map();
    this.stderrTail = '';
  }

  async findSemanticTargets({ absolutePath, content, line, column }) {
    await this.start();
    const uri = pathToFileURL(absolutePath).toString();
    this.syncDocument(uri, content);

    const position = {
      line: Math.max(0, line - 1),
      character: Math.max(0, column - 1),
    };

    const prepared = await this.request('textDocument/prepareCallHierarchy', {
      textDocument: { uri },
      position,
    }).catch(() => null);

    const callItems = Array.isArray(prepared) ? prepared : [];
    if (callItems.length > 0) {
      const item = callItems[0];
      const [incoming, outgoing] = await Promise.all([
        this.request('callHierarchy/incomingCalls', { item }).catch(() => []),
        this.request('callHierarchy/outgoingCalls', { item }).catch(() => []),
      ]);

      return {
        mode: 'callHierarchy',
        symbolName: typeof item.name === 'string' ? item.name : '',
        targets: buildCallHierarchyTargets(item, incoming, outgoing),
      };
    }

    const [definition, references] = await Promise.all([
      this.request('textDocument/definition', {
        textDocument: { uri },
        position,
      }).catch(() => null),
      this.request('textDocument/references', {
        textDocument: { uri },
        position,
        context: { includeDeclaration: false },
      }).catch(() => []),
    ]);

    return {
      mode: 'references',
      symbolName: '',
      targets: buildReferenceTargets(definition, references),
    };
  }


  async findCallGraph({
    absolutePath,
    content,
    line,
    column,
    direction = 'both',
    maxDepth = 2,
    maxNodes = 24,
    selectionStartLine = null,
    selectionStartColumn = null,
    selectionEndLine = null,
    selectionEndColumn = null,
  }) {
    await this.start();
    const uri = pathToFileURL(absolutePath).toString();
    this.syncDocument(uri, content);

    const directPosition = {
      line: Math.max(0, line - 1),
      character: Math.max(0, column - 1),
    };

    const resolved = await this.resolveCallablePosition({
      uri,
      directPosition,
      selectionStartLine,
      selectionStartColumn,
      selectionEndLine,
      selectionEndColumn,
    });

    const prepared = await this.request('textDocument/prepareCallHierarchy', {
      textDocument: { uri },
      position: resolved.position,
    }).catch(() => null);

    const callItems = Array.isArray(prepared) ? prepared : [];
    const rootItem = callItems[0];
    if (!rootItem) {
      return {
        symbolName: '',
        nodes: [],
      };
    }

    const rootLocation = callHierarchyItemLocation(rootItem);
    if (!rootLocation) {
      return {
        symbolName: typeof rootItem.name === 'string' ? rootItem.name : '',
        nodes: [],
      };
    }

    const safeDepth = Math.max(1, Math.min(Number(maxDepth) || 2, 3));
    const safeMaxNodes = Math.max(4, Math.min(Number(maxNodes) || 24, 40));
    const safeDirection = ['incoming', 'outgoing', 'both'].includes(direction)
      ? direction
      : 'both';

    const nodes = [{
      ...rootLocation,
      relation: 'root',
      depth: 0,
      name: typeof rootItem.name === 'string' ? rootItem.name : '',
      parentName: '',
      item: rootItem,
    }];
    const queue = [nodes[0]];
    const seen = new Set([callHierarchyItemKey(rootItem)]);

    while (queue.length > 0 && nodes.length < safeMaxNodes) {
      const current = queue.shift();
      if (!current || current.depth >= safeDepth) {
        continue;
      }

      const requests = [];
      if (safeDirection === 'incoming' || safeDirection === 'both') {
        requests.push(
          this.request('callHierarchy/incomingCalls', { item: current.item })
            .then((value) => ({ kind: 'incomingCall', value }))
            .catch(() => ({ kind: 'incomingCall', value: [] })),
        );
      }
      if (safeDirection === 'outgoing' || safeDirection === 'both') {
        requests.push(
          this.request('callHierarchy/outgoingCalls', { item: current.item })
            .then((value) => ({ kind: 'outgoingCall', value }))
            .catch(() => ({ kind: 'outgoingCall', value: [] })),
        );
      }

      const responses = await Promise.all(requests);
      for (const response of responses) {
        const calls = Array.isArray(response.value) ? response.value : [];
        for (const call of calls) {
          if (nodes.length >= safeMaxNodes) {
            break;
          }

          const nextItem = response.kind === 'incomingCall' ? call?.from : call?.to;
          if (!nextItem) {
            continue;
          }

          const key = callHierarchyItemKey(nextItem);
          if (!key || seen.has(key)) {
            continue;
          }

          const location = response.kind === 'incomingCall'
            ? incomingCallSiteLocation(call) || callHierarchyItemLocation(nextItem)
            : callHierarchyItemLocation(nextItem);
          if (!location) {
            continue;
          }

          seen.add(key);
          const node = {
            ...location,
            relation: response.kind,
            depth: current.depth + 1,
            name: typeof nextItem.name === 'string' ? nextItem.name : '',
            parentName: current.name || '',
            item: nextItem,
          };
          nodes.push(node);
          queue.push(node);
        }
      }
    }

    return {
      symbolName: typeof rootItem.name === 'string' ? rootItem.name : '',
      nodes: nodes.map(({ item, ...node }) => node),
    };
  }

  async resolveCallablePosition({
    uri,
    directPosition,
    selectionStartLine,
    selectionStartColumn,
    selectionEndLine,
    selectionEndColumn,
  }) {
    const selection = toLspSelectionRange({
      selectionStartLine,
      selectionStartColumn,
      selectionEndLine,
      selectionEndColumn,
    });

    // 没有 Selection 时先尊重用户精确点中的函数名；成功就不用额外请求。
    if (!selection) {
      const direct = await this.request('textDocument/prepareCallHierarchy', {
        textDocument: { uri },
        position: directPosition,
      }).catch(() => null);
      if (Array.isArray(direct) && direct.length > 0) {
        return { position: directPosition };
      }
    }

    // 选中整个函数、或光标位于函数体内部时，利用 Document Symbols
    // 自动定位最近的 Function / Method / Constructor 声明，再把它的
    // selectionRange 起点作为 Call Hierarchy 的真正入口。
    const symbols = await this.request('textDocument/documentSymbol', {
      textDocument: { uri },
    }).catch(() => []);

    const callable = chooseCallableDocumentSymbol(symbols, selection, directPosition);
    if (callable) {
      return {
        position: callable.selectionRange?.start || callable.range.start,
        name: callable.name || '',
      };
    }

    return { position: directPosition };
  }

  async start() {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } catch (error) {
      this.startPromise = null;
      throw error;
    }
  }

  async startInternal() {
    const dartCommand = resolveDartExecutable();
    const child = spawn(
      dartCommand,
      [
        'language-server',
        '--protocol=lsp',
        '--client-id=AI-Code-Tutor-IDE',
        '--client-version=0.1.0-alpha.5',
      ],
      {
        cwd: this.rootPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    this.process = child;

    child.stdout.on('data', (chunk) => this.consume(chunk));
    child.stderr.on('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(-4000);
    });

    child.on('exit', (code, signal) => {
      const message = this.stderrTail.trim()
        || `Dart Language Server 已退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）。`;
      const error = new Error(message);
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
      this.process = null;
      this.startPromise = null;
      this.openDocuments.clear();
    });

    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', (error) => {
        reject(new Error(
          `无法启动 Dart Language Server（${dartCommand}）。\n${error.message}`,
        ));
      });
    });

    const rootUri = pathToFileURL(this.rootPath).toString();
    await this.requestInternal('initialize', {
      processId: process.pid,
      clientInfo: {
        name: 'AI Code Tutor IDE',
        version: '0.1.0-alpha.5',
      },
      rootUri,
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(this.rootPath),
        },
      ],
      capabilities: {
        workspace: {
          configuration: true,
          workspaceFolders: true,
        },
        textDocument: {
          definition: { linkSupport: true },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          callHierarchy: { dynamicRegistration: true },
          synchronization: {
            didSave: false,
            willSave: false,
            willSaveWaitUntil: false,
          },
        },
      },
      initializationOptions: {},
    }, 20_000);

    this.notify('initialized', {});
  }

  syncDocument(uri, content) {
    const currentVersion = this.openDocuments.get(uri);
    if (currentVersion === undefined) {
      this.openDocuments.set(uri, 1);
      this.notify('textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: 'dart',
          version: 1,
          text: content,
        },
      });
      return;
    }

    const nextVersion = currentVersion + 1;
    this.openDocuments.set(uri, nextVersion);
    this.notify('textDocument/didChange', {
      textDocument: {
        uri,
        version: nextVersion,
      },
      contentChanges: [{ text: content }],
    });
  }

  request(method, params, timeoutMs = 15_000) {
    if (!this.process) {
      throw new Error('Dart Language Server 尚未启动。');
    }
    return this.requestInternal(method, params, timeoutMs);
  }

  requestInternal(method, params, timeoutMs = 15_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Dart LSP 请求超时：${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.write({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
    });
  }

  notify(method, params) {
    this.write({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  write(message) {
    const child = this.process;
    if (!child?.stdin || child.stdin.destroyed) {
      throw new Error('Dart Language Server 连接不可用。');
    }

    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
    child.stdin.write(Buffer.concat([header, body]));
  }

  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        return;
      }

      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) {
        return;
      }

      const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.subarray(bodyEnd);

      try {
        this.handleMessage(JSON.parse(body));
      } catch {
        // 忽略无法解析的单条 LSP 消息，避免拖垮整个 IDE。
      }
    }
  }

  handleMessage(message) {
    if (message && Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message || 'Dart LSP 请求失败。'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message?.method && Object.prototype.hasOwnProperty.call(message, 'id')) {
      this.respondToServerRequest(message);
    }
  }

  respondToServerRequest(message) {
    let result = null;

    if (message.method === 'workspace/configuration') {
      const items = Array.isArray(message.params?.items) ? message.params.items : [];
      result = items.map(() => null);
    } else if (message.method === 'workspace/workspaceFolders') {
      const rootUri = pathToFileURL(this.rootPath).toString();
      result = [{ uri: rootUri, name: path.basename(this.rootPath) }];
    }

    this.write({
      jsonrpc: '2.0',
      id: message.id,
      result,
    });
  }

  dispose() {
    const child = this.process;
    this.process = null;
    this.startPromise = null;
    this.openDocuments.clear();

    if (!child) {
      return;
    }

    try {
      child.kill();
    } catch {
      // Electron 退出时尽力结束子进程即可。
    }
  }
}

const CALLABLE_SYMBOL_KINDS = new Set([6, 9, 12]); // Method, Constructor, Function

function toLspSelectionRange(value) {
  const fields = [
    value.selectionStartLine,
    value.selectionStartColumn,
    value.selectionEndLine,
    value.selectionEndColumn,
  ];
  if (!fields.every(Number.isInteger)) {
    return null;
  }

  const start = {
    line: Math.max(0, value.selectionStartLine - 1),
    character: Math.max(0, value.selectionStartColumn - 1),
  };
  const end = {
    line: Math.max(0, value.selectionEndLine - 1),
    character: Math.max(0, value.selectionEndColumn - 1),
  };

  return comparePosition(start, end) <= 0
    ? { start, end }
    : { start: end, end: start };
}

function chooseCallableDocumentSymbol(value, selection, cursor) {
  const symbols = flattenDocumentSymbols(value)
    .filter((symbol) => CALLABLE_SYMBOL_KINDS.has(Number(symbol.kind)))
    .filter((symbol) => symbol.range?.start && symbol.range?.end);

  if (symbols.length === 0) {
    return null;
  }

  const ranked = symbols
    .map((symbol) => ({ symbol, score: callableSymbolScore(symbol, selection, cursor) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score);

  return ranked[0]?.symbol || null;
}

function flattenDocumentSymbols(value) {
  const items = Array.isArray(value) ? value : [];
  const result = [];

  const visit = (item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    // DocumentSymbol
    if (item.range?.start && item.range?.end) {
      result.push(item);
      for (const child of Array.isArray(item.children) ? item.children : []) {
        visit(child);
      }
      return;
    }

    // SymbolInformation fallback
    if (item.location?.range?.start && item.location?.range?.end) {
      result.push({
        name: item.name,
        kind: item.kind,
        range: item.location.range,
        selectionRange: item.location.range,
      });
    }
  };

  for (const item of items) {
    visit(item);
  }
  return result;
}

function callableSymbolScore(symbol, selection, cursor) {
  const range = symbol.range;
  const size = rangeSpanScore(range);

  if (selection) {
    if (rangeContainsRange(selection, range)) {
      // 用户框选整个函数：优先被 Selection 完整包住的 callable。
      return size;
    }
    if (rangeContainsRange(range, selection)) {
      // 用户只选函数体的一部分。
      return 1_000_000 + size;
    }
    if (rangesOverlap(range, selection)) {
      return 2_000_000 + size;
    }
    return Number.POSITIVE_INFINITY;
  }

  if (positionInRange(cursor, range)) {
    // 光标在函数体任意位置：选择范围最小的 callable（最内层函数）。
    return size;
  }

  return Number.POSITIVE_INFINITY;
}

function rangeContainsRange(outer, inner) {
  return comparePosition(outer.start, inner.start) <= 0
    && comparePosition(outer.end, inner.end) >= 0;
}

function rangesOverlap(a, b) {
  return comparePosition(a.start, b.end) <= 0
    && comparePosition(b.start, a.end) <= 0;
}

function positionInRange(position, range) {
  return comparePosition(range.start, position) <= 0
    && comparePosition(position, range.end) <= 0;
}

function comparePosition(a, b) {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.character - b.character;
}

function rangeSpanScore(range) {
  const lineSpan = Math.max(0, Number(range.end.line) - Number(range.start.line));
  const characterSpan = Math.max(0, Number(range.end.character) - Number(range.start.character));
  return lineSpan * 100_000 + characterSpan;
}

function buildCallHierarchyTargets(item, incomingValue, outgoingValue) {
  const targets = [];
  const definition = callHierarchyItemLocation(item);
  if (definition) {
    targets.push({ ...definition, kind: 'definition' });
  }

  const incoming = Array.isArray(incomingValue) ? incomingValue : [];
  for (const call of incoming) {
    const caller = call?.from;
    const ranges = Array.isArray(call?.fromRanges) ? call.fromRanges : [];
    const range = ranges[0] || caller?.selectionRange || caller?.range;
    const location = uriRangeLocation(caller?.uri, range);
    if (location) {
      targets.push({
        ...location,
        kind: 'incomingCall',
        label: typeof caller?.name === 'string' ? caller.name : '',
      });
    }
  }

  const outgoing = Array.isArray(outgoingValue) ? outgoingValue : [];
  for (const call of outgoing) {
    const callee = call?.to;
    const location = callHierarchyItemLocation(callee);
    if (location) {
      targets.push({
        ...location,
        kind: 'outgoingCall',
        label: typeof callee?.name === 'string' ? callee.name : '',
      });
    }
  }

  return dedupeTargets(targets);
}

function buildReferenceTargets(definitionValue, referencesValue) {
  const targets = [];
  for (const location of normalizeLocations(definitionValue)) {
    targets.push({ ...location, kind: 'definition' });
  }
  for (const location of normalizeLocations(referencesValue)) {
    targets.push({ ...location, kind: 'reference' });
  }
  return dedupeTargets(targets);
}

function normalizeLocations(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const result = [];

  for (const item of list) {
    if (item?.targetUri) {
      const location = uriRangeLocation(
        item.targetUri,
        item.targetSelectionRange || item.targetRange,
      );
      if (location) result.push(location);
      continue;
    }

    const location = uriRangeLocation(item?.uri, item?.range);
    if (location) result.push(location);
  }

  return result;
}

function callHierarchyItemLocation(item) {
  return uriRangeLocation(item?.uri, item?.selectionRange || item?.range);
}

function uriRangeLocation(uri, range) {
  if (typeof uri !== 'string' || !range?.start) {
    return null;
  }

  try {
    return {
      absolutePath: fileURLToPath(uri),
      line: Number(range.start.line) + 1,
      column: Number(range.start.character) + 1,
    };
  } catch {
    return null;
  }
}

function incomingCallSiteLocation(call) {
  const caller = call?.from;
  const ranges = Array.isArray(call?.fromRanges) ? call.fromRanges : [];
  const range = ranges[0] || caller?.selectionRange || caller?.range;
  return uriRangeLocation(caller?.uri, range);
}

function callHierarchyItemKey(item) {
  if (!item || typeof item.uri !== 'string') {
    return '';
  }

  const range = item.selectionRange || item.range;
  const start = range?.start;
  return `${item.uri}:${start?.line ?? -1}:${start?.character ?? -1}:${item.name || ''}`;
}

function dedupeTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    const key = `${target.absolutePath}:${target.line}:${target.column}:${target.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { DartLspClient };

/**
 * Electron/Node 在 Windows 上不能像 PowerShell 一样直接把 dart.bat
 * 当作普通可执行文件 spawn。Flutter SDK 的 dart 命令通常位于：
 *   <flutter>\\bin\\dart.bat
 * 真正的 Dart VM 则位于：
 *   <flutter>\\bin\\cache\\dart-sdk\\bin\\dart.exe
 *
 * 因此这里自动从 DART_BIN、FLUTTER_ROOT、where.exe 和 PATH 中解析
 * 真正可直接 spawn 的 dart.exe。非 Windows 平台继续使用 dart 命令。
 */
function resolveDartExecutable() {
  const configured = process.env.DART_BIN?.trim();
  if (configured) {
    if (process.platform !== 'win32') {
      return configured;
    }

    const resolved = resolveWindowsDartCandidate(configured);
    if (resolved) {
      return resolved;
    }

    throw new Error(
      `DART_BIN 无法解析为可执行的 Dart：${configured}`,
    );
  }

  if (process.platform !== 'win32') {
    return 'dart';
  }

  const flutterRoot = process.env.FLUTTER_ROOT?.trim();
  if (flutterRoot) {
    const candidate = path.join(
      flutterRoot,
      'bin',
      'cache',
      'dart-sdk',
      'bin',
      'dart.exe',
    );
    if (isFile(candidate)) {
      return candidate;
    }
  }

  const fromWhere = findWindowsDartWithWhere();
  if (fromWhere) {
    return fromWhere;
  }

  const pathEntries = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^\"|\"$/g, ''))
    .filter(Boolean);

  for (const entry of pathEntries) {
    const executable = path.join(entry, 'dart.exe');
    if (isFile(executable)) {
      return executable;
    }

    const flutterDart = path.join(
      entry,
      'cache',
      'dart-sdk',
      'bin',
      'dart.exe',
    );
    if (isFile(flutterDart)) {
      return flutterDart;
    }
  }

  throw new Error(
    '找不到 Dart SDK。请确认 dart --version 可用，或设置 DART_BIN / FLUTTER_ROOT。',
  );
}

function findWindowsDartWithWhere() {
  let output;
  try {
    output = execFileSync('where.exe', ['dart'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }

  for (const line of output.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate) {
      continue;
    }

    const resolved = resolveWindowsDartCandidate(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveWindowsDartCandidate(candidate) {
  const normalized = path.resolve(candidate);

  if (/\.exe$/i.test(normalized) && isFile(normalized)) {
    return normalized;
  }

  if (/\.(?:bat|cmd)$/i.test(normalized) && isFile(normalized)) {
    const flutterDart = path.join(
      path.dirname(normalized),
      'cache',
      'dart-sdk',
      'bin',
      'dart.exe',
    );
    if (isFile(flutterDart)) {
      return flutterDart;
    }
  }

  return null;
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

