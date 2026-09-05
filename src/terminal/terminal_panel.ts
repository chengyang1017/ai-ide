import './terminal_panel.css';

type TerminalStartResult = {
  cwd: string;
  shell: string;
};

type TerminalDataPayload = {
  data: string;
};

type TerminalExitPayload = {
  code: number | null;
  signal: string | null;
};

type TerminalBridge = {
  startTerminal: () => Promise<TerminalStartResult>;
  writeTerminal: (input: string) => Promise<boolean>;
  stopTerminal: () => Promise<boolean>;
  onTerminalData: (
    listener: (payload: TerminalDataPayload) => void,
  ) => () => void;
  onTerminalExit: (
    listener: (payload: TerminalExitPayload) => void,
  ) => () => void;
};

const MAX_OUTPUT_CHARS = 250_000;

function terminalBridge(): TerminalBridge | null {
  const candidate = (
    window as Window & {
      tutorIde?: Partial<TerminalBridge>;
    }
  ).tutorIde;

  if (
    typeof candidate?.startTerminal !== 'function'
      || typeof candidate.writeTerminal !== 'function'
      || typeof candidate.stopTerminal !== 'function'
      || typeof candidate.onTerminalData !== 'function'
      || typeof candidate.onTerminalExit !== 'function'
  ) {
    return null;
  }

  return candidate as TerminalBridge;
}

function stripAnsi(value: string): string {
  return value.replace(
    /\u001B\[[0-?]*[ -/]*[@-~]/g,
    '',
  );
}

function normalizeTerminalOutput(value: string): string {
  return stripAnsi(value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function currentWorkspaceRoot(): string {
  return document
    .querySelector<HTMLElement>('#project-root')
    ?.textContent
    ?.trim() ?? '';
}

function isLocalProjectOpen(): boolean {
  const badge = document
    .querySelector<HTMLElement>('#workspace-badge')
    ?.textContent
    ?.trim() ?? '';
  return badge === '真实项目' || badge === 'Real Project';
}

function mustQuery<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing terminal element: ${selector}`);
  }
  return element;
}

function installTerminal(): boolean {
  const api = terminalBridge();
  const commandBar =
    document.querySelector<HTMLElement>('.commandbar');
  const editorPane =
    document.querySelector<HTMLElement>('.editor-pane');

  if (!api || !commandBar || !editorPane) {
    return false;
  }

  if (
    document.documentElement.dataset.terminalPanel
      === 'true'
  ) {
    return true;
  }

  document.documentElement.dataset.terminalPanel = 'true';

  const divider = document.createElement('div');
  divider.className =
    'command-divider terminal-command-divider';
  divider.setAttribute('aria-hidden', 'true');

  const group = document.createElement('div');
  group.className =
    'command-group terminal-command-group';
  group.innerHTML = `
    <span class="command-group-label">TERMINAL</span>
    <button type="button" data-terminal-toggle title="切换终端 · Ctrl+\`">⌨ 终端</button>
  `;

  commandBar.append(divider, group);

  const panel = document.createElement('section');
  panel.className = 'terminal-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="terminal-header">
      <div class="terminal-title-wrap">
        <strong>TERMINAL</strong>
        <span data-terminal-shell>PowerShell</span>
        <span data-terminal-cwd></span>
      </div>
      <div class="terminal-actions">
        <button type="button" data-terminal-clear title="清空终端输出">清空</button>
        <button type="button" data-terminal-restart title="重启终端会话">重启</button>
        <button type="button" data-terminal-close title="隐藏终端">×</button>
      </div>
    </div>
    <pre class="terminal-output" data-terminal-output aria-live="polite"></pre>
    <form class="terminal-input-row" data-terminal-form>
      <span class="terminal-prompt" data-terminal-prompt>PS&gt;</span>
      <input
        data-terminal-input
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        aria-label="终端命令"
        placeholder="输入命令后按 Enter"
      />
    </form>
  `;
  editorPane.append(panel);

  let ui: {
    api: TerminalBridge;
    editorPane: HTMLElement;
    toggleButton: HTMLButtonElement;
    closeButton: HTMLButtonElement;
    clearButton: HTMLButtonElement;
    restartButton: HTMLButtonElement;
    output: HTMLPreElement;
    form: HTMLFormElement;
    input: HTMLInputElement;
    shellLabel: HTMLElement;
    cwdLabel: HTMLElement;
    promptLabel: HTMLElement;
  };

  try {
    ui = {
      api,
      editorPane,
      toggleButton: mustQuery<HTMLButtonElement>(
        group,
        '[data-terminal-toggle]',
      ),
      closeButton: mustQuery<HTMLButtonElement>(
        panel,
        '[data-terminal-close]',
      ),
      clearButton: mustQuery<HTMLButtonElement>(
        panel,
        '[data-terminal-clear]',
      ),
      restartButton: mustQuery<HTMLButtonElement>(
        panel,
        '[data-terminal-restart]',
      ),
      output: mustQuery<HTMLPreElement>(
        panel,
        '[data-terminal-output]',
      ),
      form: mustQuery<HTMLFormElement>(
        panel,
        '[data-terminal-form]',
      ),
      input: mustQuery<HTMLInputElement>(
        panel,
        '[data-terminal-input]',
      ),
      shellLabel: mustQuery<HTMLElement>(
        panel,
        '[data-terminal-shell]',
      ),
      cwdLabel: mustQuery<HTMLElement>(
        panel,
        '[data-terminal-cwd]',
      ),
      promptLabel: mustQuery<HTMLElement>(
        panel,
        '[data-terminal-prompt]',
      ),
    };
  } catch {
    panel.remove();
    group.remove();
    divider.remove();
    delete document.documentElement.dataset.terminalPanel;
    return false;
  }

  let sessionRunning = false;
  let sessionStarting = false;
  let visible = false;
  let lastWorkspaceRoot = currentWorkspaceRoot();
  const history: string[] = [];
  let historyIndex = 0;

  function appendOutput(raw: string): void {
    const text = normalizeTerminalOutput(raw);
    if (!text) {
      return;
    }

    const nextText =
      (ui.output.textContent ?? '') + text;

    ui.output.textContent =
      nextText.length > MAX_OUTPUT_CHARS
        ? nextText.slice(
            -Math.floor(MAX_OUTPUT_CHARS * 0.7),
          )
        : nextText;

    ui.output.scrollTop = ui.output.scrollHeight;
  }

  function setSessionUi(
    result: TerminalStartResult,
  ): void {
    ui.shellLabel.textContent = result.shell;
    ui.cwdLabel.textContent = result.cwd;
    ui.cwdLabel.title = result.cwd;
    ui.promptLabel.textContent =
      result.shell.toLowerCase().includes('powershell')
        ? 'PS>'
        : '$';
  }

  async function startSession(
    announce = true,
  ): Promise<void> {
    if (sessionStarting || sessionRunning) {
      return;
    }

    if (!isLocalProjectOpen()) {
      appendOutput(
        '\n[terminal] 请先打开一个本地真实项目。\n',
      );
      return;
    }

    sessionStarting = true;
    ui.input.disabled = true;
    ui.restartButton.disabled = true;

    try {
      const result = await ui.api.startTerminal();
      sessionRunning = true;
      setSessionUi(result);

      if (announce) {
        appendOutput(
          `\n[terminal] ${result.shell} · ${result.cwd}\n`,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);
      appendOutput(`\n[terminal] ${message}\n`);
    } finally {
      sessionStarting = false;
      ui.input.disabled = false;
      ui.restartButton.disabled = false;
      if (visible) {
        ui.input.focus();
      }
    }
  }

  async function restartSession(): Promise<void> {
    if (sessionStarting) {
      return;
    }

    ui.input.disabled = true;
    ui.restartButton.disabled = true;

    try {
      await ui.api.stopTerminal();
    } catch {
      // A dead session is already effectively stopped.
    }

    sessionRunning = false;
    appendOutput('\n[terminal] 正在重启…\n');
    ui.input.disabled = false;
    ui.restartButton.disabled = false;
    await startSession(false);
  }

  async function sendCommand(
    command: string,
  ): Promise<void> {
    if (!sessionRunning) {
      await startSession(false);
    }

    if (!sessionRunning) {
      return;
    }

    appendOutput(
      `\n${ui.promptLabel.textContent ?? '>'} ${command}\n`,
    );

    try {
      await ui.api.writeTerminal(command);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);
      appendOutput(`[terminal] ${message}\n`);
      sessionRunning = false;
    }
  }

  function setVisible(nextVisible: boolean): void {
    visible = nextVisible;
    panel.hidden = !nextVisible;
    ui.editorPane.dataset.terminalOpen =
      String(nextVisible);
    ui.toggleButton.dataset.active =
      String(nextVisible);

    if (nextVisible) {
      void startSession();
      window.requestAnimationFrame(() => {
        ui.input.focus();
      });
    }
  }

  const disposeData = ui.api.onTerminalData(
    ({ data }) => {
      appendOutput(data);
    },
  );

  const disposeExit = ui.api.onTerminalExit(
    ({ code, signal }) => {
      sessionRunning = false;
      appendOutput(
        `\n[terminal] 会话已结束 · code=${String(code)}${
          signal ? ` · signal=${signal}` : ''
        }\n`,
      );
    },
  );

  ui.toggleButton.addEventListener('click', () => {
    setVisible(!visible);
  });

  ui.closeButton.addEventListener('click', () => {
    setVisible(false);
  });

  ui.clearButton.addEventListener('click', () => {
    ui.output.textContent = '';
    ui.input.focus();
  });

  ui.restartButton.addEventListener('click', () => {
    void restartSession();
  });

  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const command = ui.input.value;
    ui.input.value = '';

    if (command.trim()) {
      history.push(command);
      if (history.length > 200) {
        history.shift();
      }
    }

    historyIndex = history.length;
    void sendCommand(command);
  });

  ui.input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') {
      if (history.length === 0) {
        return;
      }

      event.preventDefault();
      historyIndex = Math.max(
        0,
        historyIndex - 1,
      );
      ui.input.value = history[historyIndex] ?? '';
      ui.input.setSelectionRange(
        ui.input.value.length,
        ui.input.value.length,
      );
      return;
    }

    if (event.key === 'ArrowDown') {
      if (history.length === 0) {
        return;
      }

      event.preventDefault();
      historyIndex = Math.min(
        history.length,
        historyIndex + 1,
      );
      ui.input.value =
        historyIndex >= history.length
          ? ''
          : history[historyIndex] ?? '';
      ui.input.setSelectionRange(
        ui.input.value.length,
        ui.input.value.length,
      );
      return;
    }

    if (
      event.ctrlKey
        && event.key.toLowerCase() === 'l'
    ) {
      event.preventDefault();
      ui.output.textContent = '';
    }
  });

  document.addEventListener('keydown', (event) => {
    if (
      event.ctrlKey
        && !event.shiftKey
        && !event.altKey
        && event.key === '`'
    ) {
      event.preventDefault();
      setVisible(!visible);
    }
  });

  const projectRoot =
    document.querySelector('#project-root');

  if (projectRoot) {
    new MutationObserver(() => {
      const nextRoot = currentWorkspaceRoot();
      if (
        !nextRoot
          || nextRoot === lastWorkspaceRoot
      ) {
        return;
      }

      lastWorkspaceRoot = nextRoot;
      if (visible) {
        void restartSession();
      }
    }).observe(projectRoot, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  window.addEventListener(
    'beforeunload',
    () => {
      disposeData();
      disposeExit();
      void ui.api.stopTerminal();
    },
    { once: true },
  );

  return true;
}

function bootstrapTerminal(): void {
  if (!terminalBridge()) {
    return;
  }

  if (installTerminal()) {
    return;
  }

  const observer = new MutationObserver(() => {
    if (installTerminal()) {
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
    bootstrapTerminal,
    { once: true },
  );
} else {
  bootstrapTerminal();
}
