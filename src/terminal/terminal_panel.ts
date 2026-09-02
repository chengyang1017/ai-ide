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
  startTerminal?: () => Promise<TerminalStartResult>;
  writeTerminal?: (input: string) => Promise<boolean>;
  stopTerminal?: () => Promise<boolean>;
  onTerminalData?: (
    listener: (payload: TerminalDataPayload) => void,
  ) => () => void;
  onTerminalExit?: (
    listener: (payload: TerminalExitPayload) => void,
  ) => () => void;
};

const MAX_OUTPUT_CHARS = 250_000;

function terminalBridge(): TerminalBridge | null {
  const api = (
    window as Window & {
      tutorIde?: TerminalBridge;
    }
  ).tutorIde;

  if (
    typeof api?.startTerminal !== 'function'
      || typeof api.writeTerminal !== 'function'
      || typeof api.stopTerminal !== 'function'
      || typeof api.onTerminalData !== 'function'
      || typeof api.onTerminalExit !== 'function'
  ) {
    return null;
  }

  return api;
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
  return document
    .querySelector<HTMLElement>('#workspace-badge')
    ?.textContent
    ?.trim() === '真实项目';
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
  divider.className = 'command-divider terminal-command-divider';
  divider.setAttribute('aria-hidden', 'true');

  const group = document.createElement('div');
  group.className = 'command-group terminal-command-group';
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

  const toggleButton =
    group.querySelector<HTMLButtonElement>(
      '[data-terminal-toggle]',
    );
  const closeButton =
    panel.querySelector<HTMLButtonElement>(
      '[data-terminal-close]',
    );
  const clearButton =
    panel.querySelector<HTMLButtonElement>(
      '[data-terminal-clear]',
    );
  const restartButton =
    panel.querySelector<HTMLButtonElement>(
      '[data-terminal-restart]',
    );
  const output =
    panel.querySelector<HTMLPreElement>(
      '[data-terminal-output]',
    );
  const form =
    panel.querySelector<HTMLFormElement>(
      '[data-terminal-form]',
    );
  const input =
    panel.querySelector<HTMLInputElement>(
      '[data-terminal-input]',
    );
  const shellLabel =
    panel.querySelector<HTMLElement>(
      '[data-terminal-shell]',
    );
  const cwdLabel =
    panel.querySelector<HTMLElement>(
      '[data-terminal-cwd]',
    );
  const promptLabel =
    panel.querySelector<HTMLElement>(
      '[data-terminal-prompt]',
    );

  if (
    !toggleButton
      || !closeButton
      || !clearButton
      || !restartButton
      || !output
      || !form
      || !input
      || !shellLabel
      || !cwdLabel
      || !promptLabel
  ) {
    panel.remove();
    group.remove();
    divider.remove();
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

    const nextText = (output.textContent ?? '') + text;
    output.textContent =
      nextText.length > MAX_OUTPUT_CHARS
        ? nextText.slice(
            -Math.floor(MAX_OUTPUT_CHARS * 0.7),
          )
        : nextText;
    output.scrollTop = output.scrollHeight;
  }

  function setSessionUi(
    result: TerminalStartResult,
  ): void {
    shellLabel.textContent = result.shell;
    cwdLabel.textContent = result.cwd;
    cwdLabel.title = result.cwd;
    promptLabel.textContent =
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
    input.disabled = true;
    restartButton.disabled = true;

    try {
      const result = await api.startTerminal!();
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
      input.disabled = false;
      restartButton.disabled = false;
      if (visible) {
        input.focus();
      }
    }
  }

  async function restartSession(): Promise<void> {
    if (sessionStarting) {
      return;
    }

    input.disabled = true;
    restartButton.disabled = true;
    try {
      await api.stopTerminal!();
    } catch {
      // A dead session is already effectively stopped.
    }
    sessionRunning = false;
    appendOutput('\n[terminal] 正在重启…\n');
    input.disabled = false;
    restartButton.disabled = false;
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

    appendOutput(`\n${promptLabel.textContent ?? '>'} ${command}\n`);
    try {
      await api.writeTerminal!(command);
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
    editorPane.dataset.terminalOpen = String(nextVisible);
    toggleButton.dataset.active = String(nextVisible);

    if (nextVisible) {
      void startSession();
      window.requestAnimationFrame(() => {
        input.focus();
      });
    }
  }

  const disposeData = api.onTerminalData!(
    ({ data }) => {
      appendOutput(data);
    },
  );
  const disposeExit = api.onTerminalExit!(
    ({ code, signal }) => {
      sessionRunning = false;
      appendOutput(
        `\n[terminal] 会话已结束 · code=${String(code)}${
          signal ? ` · signal=${signal}` : ''
        }\n`,
      );
    },
  );

  toggleButton.addEventListener('click', () => {
    setVisible(!visible);
  });
  closeButton.addEventListener('click', () => {
    setVisible(false);
  });
  clearButton.addEventListener('click', () => {
    output.textContent = '';
    input.focus();
  });
  restartButton.addEventListener('click', () => {
    void restartSession();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const command = input.value;
    input.value = '';

    if (command.trim()) {
      history.push(command);
      if (history.length > 200) {
        history.shift();
      }
    }
    historyIndex = history.length;
    void sendCommand(command);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp') {
      if (history.length === 0) {
        return;
      }
      event.preventDefault();
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex] ?? '';
      input.setSelectionRange(
        input.value.length,
        input.value.length,
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
      input.value =
        historyIndex >= history.length
          ? ''
          : history[historyIndex] ?? '';
      input.setSelectionRange(
        input.value.length,
        input.value.length,
      );
      return;
    }

    if (
      event.ctrlKey
        && event.key.toLowerCase() === 'l'
    ) {
      event.preventDefault();
      output.textContent = '';
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

  const projectRoot = document.querySelector('#project-root');
  if (projectRoot) {
    new MutationObserver(() => {
      const nextRoot = currentWorkspaceRoot();
      if (!nextRoot || nextRoot === lastWorkspaceRoot) {
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

  window.addEventListener('beforeunload', () => {
    disposeData();
    disposeExit();
    void api.stopTerminal!();
  }, { once: true });

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
