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

function installAgentFollow(): boolean {
  const api = bridge();
  const editorStage =
    document.querySelector<HTMLElement>('#editor-stage');
  const agentPanel =
    document.querySelector<HTMLElement>('.agent-panel');

  if (!api || !editorStage || !agentPanel) {
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
  indicator.textContent = '代码页跟随';
  indicator.hidden = true;

  const context =
    agentPanel.querySelector<HTMLElement>('.agent-context');
  context?.append(indicator);

  const overlay = document.createElement('div');
  overlay.className = 'agent-live-change';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="agent-live-change-heading">
      <strong data-agent-live-title>Agent 修改</strong>
      <code data-agent-live-location></code>
    </div>
    <div class="agent-live-change-diff">
      <pre class="agent-live-change-old" data-agent-live-old></pre>
      <pre class="agent-live-change-new" data-agent-live-new></pre>
    </div>
  `;
  editorStage.append(overlay);

  const title =
    overlay.querySelector<HTMLElement>(
      '[data-agent-live-title]',
    );
  const location =
    overlay.querySelector<HTMLElement>(
      '[data-agent-live-location]',
    );
  const oldPreview =
    overlay.querySelector<HTMLPreElement>(
      '[data-agent-live-old]',
    );
  const newPreview =
    overlay.querySelector<HTMLPreElement>(
      '[data-agent-live-new]',
    );

  if (!title || !location || !oldPreview || !newPreview) {
    overlay.remove();
    indicator.remove();
    delete document.documentElement.dataset.agentLiveFollow;
    return false;
  }

  const ui = {
    api,
    editorStage,
    indicator,
    overlay,
    title,
    location,
    oldPreview,
    newPreview,
  };

  let following = false;
  let starting = false;
  let bypassNextSubmit = false;
  let queue: Promise<void> = Promise.resolve();
  let hideTimer = 0;

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
        `已缓存 ${result.cachedFiles} 个文本文件，Agent 写入时自动跳转`;
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

  function showChange(change: AgentFileChange): void {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
    }

    ui.overlay.dataset.kind = change.type;
    ui.title.textContent =
      change.type === 'created'
        ? 'Agent 新建'
        : change.type === 'deleted'
          ? 'Agent 删除'
          : 'Agent 修改';
    ui.location.textContent =
      `${change.path}:${change.line}`;

    ui.oldPreview.textContent = change.oldPreview
      ? `- ${change.oldPreview}`
      : '- （无旧内容）';
    ui.newPreview.textContent = change.newPreview
      ? `+ ${change.newPreview}`
      : '+ （无新内容）';

    ui.oldPreview.hidden =
      change.type === 'created';
    ui.newPreview.hidden =
      change.type === 'deleted';
    ui.overlay.hidden = false;

    hideTimer = window.setTimeout(() => {
      ui.overlay.hidden = true;
    }, 2400);
  }

  async function refreshAndJump(
    change: AgentFileChange,
  ): Promise<void> {
    showChange(change);

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
      await delay(320);
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

    await delay(110);

    window.dispatchEvent(
      new CustomEvent('ai-ide-reader-jump-request', {
        detail: {
          filePath: change.path,
          line: Math.max(1, change.line),
          column: 1,
          source: 'coding-agent-live-follow',
        },
      }),
    );

    setTutorStatus(
      `Agent ${change.type === 'created' ? '新建' : '修改'} · ${change.path}:${change.line}`,
    );

    // Give the user a short visual dwell before following the next rapid edit.
    await delay(360);
  }

  const disposeChanges = ui.api.onAgentFileChange(
    (change) => {
      queue = queue
        .then(() => refreshAndJump(change))
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
      }, 700);
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
