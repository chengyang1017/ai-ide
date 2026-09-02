import './agent_panel.css';

type AgentEvent = {
  runId?: string;
  type: string;
  tool?: string;
  message?: string;
  changedFiles?: string[];
  deletedFiles?: string[];
};

type AgentResult = {
  runId: string;
  model: string;
  message: string;
  changedFiles: string[];
  deletedFiles: string[];
  backupDirectory: string;
};

type ProjectSnapshot = {
  rootPath: string;
  projectName: string;
  files: string[];
  directories?: string[];
  lastOpenFile?: string;
};

type AgentBridge = {
  runAgent: (request: {
    prompt: string;
    activeFile: string;
  }) => Promise<AgentResult>;
  cancelAgent: () => Promise<boolean>;
  onAgentEvent: (
    listener: (event: AgentEvent) => void,
  ) => () => void;
  restoreProject: () => Promise<ProjectSnapshot | null>;
  hasOpenAiKey?: () => Promise<boolean>;
};

function bridge(): AgentBridge | null {
  const candidate = (
    window as Window & {
      tutorIde?: Partial<AgentBridge>;
    }
  ).tutorIde;

  if (
    typeof candidate?.runAgent !== 'function'
      || typeof candidate.cancelAgent !== 'function'
      || typeof candidate.onAgentEvent !== 'function'
      || typeof candidate.restoreProject !== 'function'
  ) {
    return null;
  }

  return candidate as AgentBridge;
}

function isRealProjectOpen(): boolean {
  return document
    .querySelector<HTMLElement>('#workspace-badge')
    ?.textContent
    ?.trim() === '真实项目';
}

function currentActiveFile(): string {
  return document
    .querySelector<HTMLElement>('#active-file')
    ?.textContent
    ?.trim() ?? '';
}

function hasUnsavedChanges(): boolean {
  return document
    .querySelector<HTMLElement>('#editor-tab-dot')
    ?.dataset.dirty === 'true';
}

function setTutorStatus(message: string): void {
  const status =
    document.querySelector<HTMLElement>('#tutor-status');
  if (status) {
    status.textContent = message;
  }
}

function installAgentPanel(): boolean {
  const api = bridge();
  const commandBar =
    document.querySelector<HTMLElement>('.commandbar');
  const workspace =
    document.querySelector<HTMLElement>('.workspace');

  if (!api || !commandBar || !workspace) {
    return false;
  }

  if (
    document.documentElement.dataset.codingAgentPanel
      === 'true'
  ) {
    return true;
  }
  document.documentElement.dataset.codingAgentPanel = 'true';

  const divider = document.createElement('div');
  divider.className = 'command-divider agent-command-divider';
  divider.setAttribute('aria-hidden', 'true');

  const group = document.createElement('div');
  group.className = 'command-group agent-command-group';
  group.innerHTML = `
    <span class="command-group-label">AGENT</span>
    <button type="button" data-agent-toggle>🤖 Agent</button>
  `;
  commandBar.append(divider, group);

  const panel = document.createElement('aside');
  panel.className = 'agent-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="agent-panel-header">
      <div>
        <strong>CODE AGENT</strong>
        <span data-agent-state>等待任务</span>
      </div>
      <button type="button" data-agent-close aria-label="关闭 Agent">×</button>
    </div>

    <div class="agent-context">
      <span>当前文件</span>
      <code data-agent-active-file>—</code>
    </div>

    <div class="agent-log" data-agent-log>
      <div class="agent-empty-state">
        <strong>让 Agent 直接处理项目</strong>
        <p>它可以读取、搜索、修改文件，并运行 typecheck / analyze / test 等验证命令。</p>
      </div>
    </div>

    <form class="agent-composer" data-agent-form>
      <textarea
        data-agent-prompt
        rows="5"
        maxlength="20000"
        placeholder="例如：检查这个 Flutter 项目的登录流程，把 Provider 改成 BLoC，并运行 flutter analyze。"
      ></textarea>
      <div class="agent-composer-actions">
        <span data-agent-hint>修改前会自动备份现有文件</span>
        <button type="button" data-agent-stop disabled>停止</button>
        <button type="submit" data-agent-run>执行 Agent</button>
      </div>
    </form>
  `;
  workspace.append(panel);

  const toggleButton =
    group.querySelector<HTMLButtonElement>(
      '[data-agent-toggle]',
    );
  const closeButton =
    panel.querySelector<HTMLButtonElement>(
      '[data-agent-close]',
    );
  const stateLabel =
    panel.querySelector<HTMLElement>(
      '[data-agent-state]',
    );
  const activeFileLabel =
    panel.querySelector<HTMLElement>(
      '[data-agent-active-file]',
    );
  const log =
    panel.querySelector<HTMLElement>('[data-agent-log]');
  const form =
    panel.querySelector<HTMLFormElement>(
      '[data-agent-form]',
    );
  const prompt =
    panel.querySelector<HTMLTextAreaElement>(
      '[data-agent-prompt]',
    );
  const runButton =
    panel.querySelector<HTMLButtonElement>(
      '[data-agent-run]',
    );
  const stopButton =
    panel.querySelector<HTMLButtonElement>(
      '[data-agent-stop]',
    );
  const hint =
    panel.querySelector<HTMLElement>('[data-agent-hint]');

  if (
    !toggleButton
      || !closeButton
      || !stateLabel
      || !activeFileLabel
      || !log
      || !form
      || !prompt
      || !runButton
      || !stopButton
      || !hint
  ) {
    panel.remove();
    group.remove();
    divider.remove();
    delete document.documentElement.dataset.codingAgentPanel;
    return false;
  }

  const ui = {
    toggleButton,
    closeButton,
    stateLabel,
    activeFileLabel,
    log,
    form,
    prompt,
    runButton,
    stopButton,
    hint,
  };

  let visible = false;
  let running = false;
  let currentRunId = '';

  function updateContext(): void {
    ui.activeFileLabel.textContent =
      currentActiveFile() || '—';
  }

  function setVisible(nextVisible: boolean): void {
    visible = nextVisible;
    panel.hidden = !nextVisible;
    workspace.dataset.agentOpen = String(nextVisible);
    ui.toggleButton.dataset.active = String(nextVisible);
    updateContext();

    if (nextVisible) {
      window.requestAnimationFrame(() => {
        ui.prompt.focus();
      });
    }
  }

  function setRunning(nextRunning: boolean): void {
    running = nextRunning;
    ui.runButton.disabled = nextRunning;
    ui.stopButton.disabled = !nextRunning;
    ui.prompt.disabled = nextRunning;
    ui.stateLabel.textContent = nextRunning
      ? '运行中'
      : '等待任务';
    ui.toggleButton.dataset.running =
      String(nextRunning);
  }

  function clearEmptyState(): void {
    ui.log.querySelector('.agent-empty-state')?.remove();
  }

  function appendLog(
    kind: string,
    message: string,
    tool?: string,
  ): void {
    clearEmptyState();
    const row = document.createElement('div');
    row.className = 'agent-log-row';
    row.dataset.kind = kind;

    const icon = document.createElement('span');
    icon.className = 'agent-log-icon';
    icon.textContent =
      kind === 'tool_result'
        ? '✓'
        : kind === 'tool_error' || kind === 'error'
          ? '!'
          : kind === 'thinking'
            ? '…'
            : kind === 'done'
              ? '◆'
              : '›';

    const body = document.createElement('div');
    if (tool) {
      const label = document.createElement('code');
      label.textContent = tool;
      body.append(label);
    }
    const text = document.createElement('span');
    text.textContent = message;
    body.append(text);

    row.append(icon, body);
    ui.log.append(row);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  async function refreshProjectAfterAgent(
    result: AgentResult,
  ): Promise<void> {
    if (
      result.changedFiles.length === 0
        && result.deletedFiles.length === 0
    ) {
      return;
    }

    const snapshot = await api.restoreProject();
    if (!snapshot) {
      return;
    }

    const preferredFile =
      result.changedFiles.find((file) =>
        snapshot.files.includes(file),
      );

    window.dispatchEvent(
      new CustomEvent('android-project-snapshot', {
        detail: {
          ...snapshot,
          preferredFile,
          message:
            `✓ Agent 完成 · 修改 ${result.changedFiles.length} · 删除 ${result.deletedFiles.length}`,
        },
      }),
    );
  }

  const disposeAgentEvents = api.onAgentEvent(
    (event) => {
      if (
        currentRunId
          && event.runId
          && event.runId !== currentRunId
      ) {
        return;
      }

      if (event.runId && !currentRunId) {
        currentRunId = event.runId;
      }

      const message = event.message?.trim() ?? '';
      if (!message) {
        return;
      }

      if (event.type === 'status') {
        ui.stateLabel.textContent = message;
      }
      appendLog(event.type, message, event.tool);
    },
  );

  async function runAgent(): Promise<void> {
    if (running) {
      return;
    }
    if (!isRealProjectOpen()) {
      appendLog('error', '请先打开一个本地真实项目。');
      setTutorStatus('请先打开一个本地真实项目');
      return;
    }
    if (hasUnsavedChanges()) {
      appendLog(
        'error',
        '当前文件还有未保存修改，请先 Ctrl+S，再让 Agent 改项目。',
      );
      return;
    }

    const task = ui.prompt.value.trim();
    if (!task) {
      ui.prompt.focus();
      return;
    }

    if (
      typeof api.hasOpenAiKey === 'function'
        && !(await api.hasOpenAiKey())
    ) {
      appendLog(
        'error',
        '还没有 OpenAI API Key，请先点击顶部 Key 设置。',
      );
      return;
    }

    currentRunId = '';
    setRunning(true);
    updateContext();
    appendLog('user', task);
    setTutorStatus('Agent 正在处理项目…');

    try {
      const result = await api.runAgent({
        prompt: task,
        activeFile: currentActiveFile(),
      });
      currentRunId = result.runId;
      await refreshProjectAfterAgent(result);

      if (result.backupDirectory) {
        appendLog(
          'status',
          `备份：${result.backupDirectory}`,
        );
      }
      setTutorStatus(
        `✓ Agent 完成 · ${result.model}`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);
      appendLog('error', message);
      setTutorStatus(`Agent：${message}`);
    } finally {
      setRunning(false);
      currentRunId = '';
      ui.prompt.focus();
    }
  }

  ui.toggleButton.addEventListener('click', () => {
    setVisible(!visible);
  });
  ui.closeButton.addEventListener('click', () => {
    setVisible(false);
  });
  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void runAgent();
  });
  ui.prompt.addEventListener('keydown', (event) => {
    if (
      event.key === 'Enter'
        && (event.ctrlKey || event.metaKey)
    ) {
      event.preventDefault();
      void runAgent();
    }
  });
  ui.stopButton.addEventListener('click', () => {
    void api.cancelAgent();
    ui.stateLabel.textContent = '正在停止…';
  });

  const activeFileElement =
    document.querySelector('#active-file');
  if (activeFileElement) {
    new MutationObserver(updateContext).observe(
      activeFileElement,
      {
        childList: true,
        characterData: true,
        subtree: true,
      },
    );
  }

  document.addEventListener('keydown', (event) => {
    if (
      event.ctrlKey
        && event.shiftKey
        && event.key.toLowerCase() === 'a'
    ) {
      const target = event.target as HTMLElement | null;
      const editable = target?.matches(
        'input, textarea, [contenteditable="true"]',
      ) ?? false;
      if (editable) {
        return;
      }
      event.preventDefault();
      setVisible(!visible);
    }
  });

  window.addEventListener(
    'beforeunload',
    () => {
      disposeAgentEvents();
      if (running) {
        void api.cancelAgent();
      }
    },
    { once: true },
  );

  return true;
}

function bootstrapAgentPanel(): void {
  if (!bridge()) {
    return;
  }

  if (installAgentPanel()) {
    return;
  }

  const observer = new MutationObserver(() => {
    if (installAgentPanel()) {
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    bootstrapAgentPanel,
    { once: true },
  );
} else {
  bootstrapAgentPanel();
}
