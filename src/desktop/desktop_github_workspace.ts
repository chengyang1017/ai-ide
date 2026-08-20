import {
  Capacitor,
} from '@capacitor/core';

function setTutorStatus(
  message: string,
): void {
  const status =
    document.querySelector<HTMLElement>(
      '#tutor-status',
    );

  if (status) {
    status.textContent =
      message;
  }
}

function requestGitHubUrl():
  Promise<string | null> {
  return new Promise(
    (resolve) => {
      const existing =
        document.querySelector<HTMLElement>(
          '.desktop-github-modal',
        );

      existing?.remove();

      const backdrop =
        document.createElement('div');

      backdrop.className =
        'desktop-github-modal';

      backdrop.innerHTML = `
        <section
          class="desktop-github-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="打开 GitHub 仓库"
        >
          <header>
            <div>
              <strong>🐙 打开 GitHub 仓库</strong>
              <p>粘贴公开 GitHub 仓库或文件链接</p>
            </div>
            <button
              type="button"
              data-github-close
              aria-label="关闭"
            >×</button>
          </header>

          <input
            data-github-url
            type="url"
            inputmode="url"
            spellcheck="false"
            value="https://github.com/"
            aria-label="GitHub 链接"
          />

          <div class="desktop-github-dialog-actions">
            <button
              type="button"
              data-github-cancel
            >取消</button>
            <button
              type="button"
              class="primary-button"
              data-github-open
            >打开仓库</button>
          </div>

          <p
            class="desktop-github-dialog-error"
            data-github-error
          ></p>
        </section>
      `;

      const style =
        document.createElement('style');

      style.textContent = `
        .desktop-github-modal {
          position: fixed;
          inset: 0;
          z-index: 1900;
          display: grid;
          place-items: center;
          padding: 20px;
          background: rgba(5, 8, 13, 0.72);
          backdrop-filter: blur(8px);
        }

        .desktop-github-dialog {
          box-sizing: border-box;
          width: min(620px, 100%);
          padding: 18px;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 14px;
          background: #151922;
          color: #eef4ff;
          box-shadow: 0 24px 80px rgba(0,0,0,0.46);
        }

        .desktop-github-dialog header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 16px;
        }

        .desktop-github-dialog header strong {
          font-size: 16px;
        }

        .desktop-github-dialog header p {
          margin: 5px 0 0;
          color: #8e98a8;
          font-size: 12px;
        }

        .desktop-github-dialog header button {
          width: 34px;
          height: 34px;
          padding: 0;
          font-size: 20px;
        }

        .desktop-github-dialog input {
          box-sizing: border-box;
          width: 100%;
          min-height: 42px;
          padding: 9px 11px;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 9px;
          outline: none;
          background: #0f131b;
          color: #f4f8ff;
          font: 13px/1.4 "Cascadia Code", Consolas, monospace;
        }

        .desktop-github-dialog input:focus {
          border-color: rgba(77,180,255,0.7);
        }

        .desktop-github-dialog-actions {
          display: flex;
          justify-content: flex-end;
          gap: 9px;
          margin-top: 14px;
        }

        .desktop-github-dialog-error {
          min-height: 18px;
          margin: 10px 0 0;
          color: #ff9b9b;
          font-size: 12px;
        }
      `;

      backdrop.append(style);
      document.body.append(backdrop);

      const input =
        backdrop.querySelector<HTMLInputElement>(
          '[data-github-url]',
        )!;

      const open =
        backdrop.querySelector<HTMLButtonElement>(
          '[data-github-open]',
        )!;

      const cancel =
        backdrop.querySelector<HTMLButtonElement>(
          '[data-github-cancel]',
        )!;

      const close =
        backdrop.querySelector<HTMLButtonElement>(
          '[data-github-close]',
        )!;

      const error =
        backdrop.querySelector<HTMLElement>(
          '[data-github-error]',
        )!;

      let settled = false;

      const finish = (
        value: string | null,
      ): void => {
        if (settled) {
          return;
        }

        settled = true;
        backdrop.remove();
        resolve(value);
      };

      const submit = (): void => {
        const value =
          input.value.trim();

        if (
          !/^https:\/\/github\.com\//i.test(
            value,
          )
        ) {
          error.textContent =
            '请输入 https://github.com/... 链接。';
          input.focus();
          return;
        }

        finish(value);
      };

      open.addEventListener(
        'click',
        submit,
      );

      cancel.addEventListener(
        'click',
        () => finish(null),
      );

      close.addEventListener(
        'click',
        () => finish(null),
      );

      backdrop.addEventListener(
        'click',
        (event) => {
          if (event.target === backdrop) {
            finish(null);
          }
        },
      );

      input.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit();
            return;
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            finish(null);
          }
        },
      );

      requestAnimationFrame(
        () => {
          input.focus();
          input.setSelectionRange(
            input.value.length,
            input.value.length,
          );
        },
      );
    },
  );
}

function installDesktopGitHubButton():
  boolean {
  if (
    Capacitor.getPlatform()
      === 'android'
  ) {
    return true;
  }

  if (
    document.querySelector(
      '.desktop-github-open-button',
    )
  ) {
    return true;
  }

  const openGitHubRepository =
    window.tutorIde
      ?.openGitHubRepository;

  if (
    typeof openGitHubRepository
      !== 'function'
  ) {
    return true;
  }

  const projectGroup =
    document.querySelector<HTMLElement>(
      '.command-group-project',
    )
      ?? document.querySelector<HTMLElement>(
        '.titlebar-right',
      );

  if (!projectGroup) {
    return false;
  }

  const button =
    document.createElement('button');

  button.type = 'button';
  button.className =
    'compact-button desktop-github-open-button';
  button.textContent =
    '🐙 GitHub';
  button.title =
    '打开 GitHub 公开仓库';

  button.addEventListener(
    'click',
    () => {
      void (async () => {
        const url =
          await requestGitHubUrl();

        if (!url) {
          return;
        }

        button.disabled = true;
        button.textContent =
          '🐙 读取中…';

        setTutorStatus(
          'GitHub · 正在读取远程仓库…',
        );

        try {
          const snapshot =
            await openGitHubRepository(
              url,
            );

          window.dispatchEvent(
            new CustomEvent(
              'android-project-snapshot',
              {
                detail: snapshot,
              },
            ),
          );

          setTutorStatus(
            snapshot.message
              ?? `✓ GitHub · ${snapshot.projectName}`,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          setTutorStatus(
            `GitHub 打开失败 · ${message}`,
          );

          console.error(
            'Desktop GitHub open failed.',
            error,
          );
        } finally {
          button.disabled = false;
          button.textContent =
            '🐙 GitHub';
        }
      })();
    },
  );

  projectGroup.appendChild(
    button,
  );

  return true;
}

function bootstrapDesktopGitHub():
  void {
  if (
    Capacitor.getPlatform()
      === 'android'
  ) {
    return;
  }

  if (installDesktopGitHubButton()) {
    return;
  }

  const observer =
    new MutationObserver(
      () => {
        if (
          installDesktopGitHubButton()
        ) {
          observer.disconnect();
        }
      },
    );

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
    },
  );

  let attempts = 0;

  const retry = (): void => {
    attempts += 1;

    if (
      installDesktopGitHubButton()
    ) {
      observer.disconnect();
      return;
    }

    if (attempts < 180) {
      requestAnimationFrame(
        retry,
      );
      return;
    }

    observer.disconnect();
  };

  requestAnimationFrame(
    retry,
  );
}

bootstrapDesktopGitHub();
