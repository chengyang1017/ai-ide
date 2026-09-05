import './agent_follow.css';

type AgentEvent = {
  type: string;
};

type AgentFileChange = {
  type: 'modified' | 'created' | 'deleted';
  path: string;
  line: number;
  endLine: number;
  oldPreview: string;
  newPreview: string;
};

type ProjectSnapshot = {
  rootPath: string;
  projectName: string;
  files: string[];
  directories?: string[];
  lastOpenFile?: string;
};

type AgentFollowBridge = {
  startAgentFollow: () => Promise<{
    root: string;
    cachedFiles: number;
  }>;
  stopAgentFollow: () => Promise<boolean>;
  onAgentFileChange: (
    listener: (change: AgentFileChange) => void,
  ) => () => void;
  onAgentEvent: (
    listener: (event: AgentEvent) => void,
  ) => () => void;
  restoreProject: () => Promise<ProjectSnapshot | null>;
};

function bridge(): AgentFollowBridge | null {
  const candidate = (
    window as Window & {
      tutorIde?: Partial<AgentFollowBridge>;
    }
  ).tutorIde;

  if (
    typeof candidate?.startAgentFollow !== 'function'
      || typeof candidate.stopAgentFollow !== 'function'
      || typeof candidate.onAgentFileChange !== 'function'
      || typeof candidate.onAgentEvent !== 'function'
      || typeof candidate.restoreProject !== 'function'
  ) {
    return null;
  }

  return candidate as AgentFollowBridge;
}

function isRealProjectOpen(): boolean {
  return document
    .querySelector<HTMLElement>('#workspace-badge')
    ?.textContent
    ?.trim() === '真实项目';
}

function activeFilePath(): string {
  return document
    .querySelector<HTMLElement>('#active-file')
    ?.textContent
    ?.trim() ?? '';
}

function setTutorStatus(message: string): void {
  const status =
    document.querySelector<HTMLElement>('#tutor-status');
  if (status) {
    status.textContent = message;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function waitForActiveFile(
  path: string,
  timeoutMs = 3500,
): Promise<boolean> {
  if (activeFilePath() === path) {
    await nextFrame();
    await nextFrame();
    return true;
  }

  const startedAt = performance.now();

  while (performance.now() - startedAt < timeoutMs) {
    await delay(30);
    if (activeFilePath() === path) {
      await nextFrame();
      await nextFrame();
      return true;
    }
  }

  return false;
}

function robotPresentationVisible(): boolean {
  const character =
    document.querySelector<HTMLElement>('#tutor-character');

  const robotVisible = Boolean(
    character
      && !character.classList.contains('offscreen'),
  );

  const inlineDiffVisible = Boolean(
    document.querySelector(
      '.monaco-editor .agent-edit-added-line, .agent-edit-deleted-zone',
    ),
  );

  return robotVisible && inlineDiffVisible;
}

async function waitForRobotPresentation(
  timeoutMs = 900,
): Promise<boolean> {
  const startedAt = performance.now();

  while (performance.now() - startedAt < timeoutMs) {
    if (robotPresentationVisible()) {
      return true;
    }
    await delay(40);
  }

  return robotPresentationVisible();
}

function dispatchAgentEditFocus(
  change: AgentFileChange,
): void {
  window.dispatchEvent(
    new CustomEvent('ai-ide-agent-edit-focus', {
      detail: {
        type: change.type,
        filePath: change.path,
        line: Math.max(1, change.line),
        endLine: Math.max(change.line, change.endLine),
        oldPreview: change.oldPreview,
        newPreview: change.newPreview,
      },
    }),
  );
}

function installAgentFollow(): boolean {
  const api = bridge();
  const agentPanel =
    document.querySelector<HTMLElement>('.agent-panel');

  if (!api || !agentPanel) {
    return false;
  }

  if (
    document.documentElement.dataset.agentLiveFollow
      === 'true'
  ) {
    return true;
  }
  document.documentElement.dataset.agentLiveFollow = 'true';

  const indicator = document.createElement('span');
  indicator.className = 'agent-live-follow-indicator';
  indicator.textContent = '机器人跟随代码';
  indicator.hidden = true;

  const context =
    agentPanel.querySelector<HTMLElement>('.agent-context');
  context?.append(indicator);

  const ui = {
    api,
    indicator,
  };

  let following = false;
  let starting = false;
  let bypassNextSubmit = false;
  let queue: Promise<void> = Promise.resolve();

  async function startFollowing(): Promise<void> {
    if (following || starting || !isRealProjectOpen()) {
      return;
    }

    starting = true;
    try {
      const result = await ui.api.startAgentFollow();
      following = true;
      ui.indicator.hidden = false;
      ui.indicator.title =
        `已缓存 ${result.cachedFiles} 个文本文件；真实写入时机器人会跳到修改位置`;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);
      setTutorStatus(`Agent 跟随：${message}`);
    } finally {
      starting = false;
    }
  }

  async function stopFollowing(): Promise<void> {
    if (!following && !starting) {
      return;
    }

    try {
      await ui.api.stopAgentFollow();
    } catch {
      // Closing an already stopped watcher is harmless.
    }

    following = false;
    starting = false;
    ui.indicator.hidden = true;
  }

  async function ensureEditorIsOnChange(
    change: AgentFileChange,
  ): Promise<boolean> {
    if (await waitForActiveFile(change.path)) {
      return true;
    }

    window.dispatchEvent(
      new CustomEvent('ai-ide-reader-jump-request', {
        detail: {
          filePath: change.path,
          line: Math.max(1, change.line),
          column: 1,
          source: 'coding-agent-live-follow-retry',
        },
      }),
    );

    return waitForActiveFile(change.path, 2500);
  }

  async function presentRobotAndInlineDiff(
    change: AgentFileChange,
  ): Promise<boolean> {
    dispatchAgentEditFocus(change);

    if (await waitForRobotPresentation()) {
      return true;
    }

    // A tutor animation or an overlapping project refresh may have cancelled
    // the first move. Retry once after Monaco has another pair of paint frames.
    setTutorStatus(
      `🤖 正在重新定位机器人 · ${change.path}:${change.line}`,
    );
    await nextFrame();
    await nextFrame();
    dispatchAgentEditFocus(change);

    return waitForRobotPresentation(1200);
  }

  async function refreshAndPresent(
    change: AgentFileChange,
  ): Promise<void> {
    const snapshot = await ui.api.restoreProject();
    if (!snapshot) {
      return;
    }

    if (change.type === 'deleted') {
      window.dispatchEvent(
        new CustomEvent('android-project-snapshot', {
          detail: {
            ...snapshot,
            preferredFile:
              snapshot.lastOpenFile
                && snapshot.files.includes(snapshot.lastOpenFile)
                ? snapshot.lastOpenFile
                : snapshot.files[0],
            message: `Agent 删除 · ${change.path}`,
          },
        }),
      );
      setTutorStatus(`Agent 删除 · ${change.path}`);
      await delay(500);
      return;
    }

    if (!snapshot.files.includes(change.path)) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent('android-project-snapshot', {
        detail: {
          ...snapshot,
          preferredFile: change.path,
          message:
            `Agent ${change.type === 'created' ? '新建' : '修改'} · ${change.path}:${change.line}`,
        },
      }),
    );

    const editorReady = await ensureEditorIsOnChange(change);
    if (!editorReady) {
      setTutorStatus(
        `Agent 已修改 ${change.path}:${change.line}，但代码页未能及时完成定位`,
      );
      return;
    }

    const presented =
      await presentRobotAndInlineDiff(change);

    if (!presented) {
      setTutorStatus(
        `⚠ Agent 已修改 ${change.path}:${change.line}，但机器人/Monaco 删改展示未启动`,
      );
      await delay(900);
      return;
    }

    setTutorStatus(
      `🤖 Agent 正在展示修改 · ${change.path}:${change.line}`,
    );

    // Keep each real edit on screen long enough to watch before the next one.
    await delay(1500);
  }

  const disposeChanges = ui.api.onAgentFileChange(
    (change) => {
      queue = queue
        .then(() => refreshAndPresent(change))
        .catch((error) => {
          const message =
            error instanceof Error
              ? error.message
              : String(error);
          setTutorStatus(`Agent 跟随：${message}`);
        });
    },
  );

  const disposeEvents = ui.api.onAgentEvent((event) => {
    if (
      event.type === 'status'
        || event.type === 'thinking'
        || event.type === 'tool_start'
    ) {
      void startFollowing();
      return;
    }

    if (event.type === 'done' || event.type === 'error') {
      window.setTimeout(() => {
        void stopFollowing();
      }, 1800);
    }
  });

  document.addEventListener(
    'submit',
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) {
        return;
      }
      if (!form.matches('[data-agent-form]')) {
        return;
      }
      if (bypassNextSubmit) {
        bypassNextSubmit = false;
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      void (async () => {
        await startFollowing();
        bypassNextSubmit = true;
        form.dispatchEvent(
          new Event('submit', {
            bubbles: true,
            cancelable: true,
          }),
        );
      })();
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) {
        return;
      }
      if (!target.matches('[data-agent-prompt]')) {
        return;
      }
      if (
        event.key !== 'Enter'
          || (!event.ctrlKey && !event.metaKey)
      ) {
        return;
      }

      const form = target.closest<HTMLFormElement>(
        '[data-agent-form]',
      );
      if (!form) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      void (async () => {
        await startFollowing();
        bypassNextSubmit = true;
        form.dispatchEvent(
          new Event('submit', {
            bubbles: true,
            cancelable: true,
          }),
        );
      })();
    },
    true,
  );

  window.addEventListener(
    'beforeunload',
    () => {
      disposeChanges();
      disposeEvents();
      void ui.api.stopAgentFollow();
    },
    { once: true },
  );

  return true;
}

function bootstrapAgentFollow(): void {
  if (!bridge()) {
    return;
  }

  if (installAgentFollow()) {
    return;
  }

  const observer = new MutationObserver(() => {
    if (installAgentFollow()) {
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
    bootstrapAgentFollow,
    { once: true },
  );
} else {
  bootstrapAgentFollow();
}
