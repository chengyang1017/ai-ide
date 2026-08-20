import {
  beginGitHubDeviceFlow,
  getGitHubLoginState,
  getPendingGitHubDeviceFlow,
  githubApiGetJson,
  isAndroidGitHubAuth,
  logoutGitHub,
  pollGitHubDeviceFlow,
  type GitHubLoginState,
} from './github_auth_bridge';
import './github_account_workspace.css';

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  language: string | null;
  updated_at: string;
  owner: {
    login: string;
  };
}

interface GitHubPerson {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
}

type WorkspaceTab = 'repos' | 'following';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function paged<T>(
  pathForPage: (page: number) => string,
  maxPages = 10,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await githubApiGetJson<T[]>(
      pathForPage(page),
    );
    all.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return all;
}

function installGitHubAccountWorkspace(): boolean {
  if (!isAndroidGitHubAuth()) {
    return true;
  }

  if (
    document.querySelector(
      '.github-account-button',
    )
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

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'compact-button github-account-button';
  button.textContent = '🐙 GitHub';
  projectGroup.appendChild(button);

  const modal = document.createElement('div');
  modal.className = 'github-account-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <section class="github-account-dialog" role="dialog" aria-modal="true" aria-label="GitHub 工作区">
      <header class="github-account-header">
        <div class="github-account-profile">
          <img class="github-account-avatar" data-github-avatar alt="" hidden />
          <div class="github-account-title">
            <strong data-github-title>GitHub 工作区</strong>
            <small data-github-subtitle>登录后查看你的项目和关注的人</small>
          </div>
        </div>
        <button type="button" class="github-account-close" data-github-close aria-label="关闭">×</button>
      </header>
      <div class="github-account-toolbar" data-github-toolbar hidden>
        <div class="github-account-tabs">
          <button type="button" data-github-tab="repos" data-active="true">我的项目</button>
          <button type="button" data-github-tab="following">关注的人</button>
        </div>
        <input class="github-account-search" data-github-search type="search" placeholder="搜索…" />
        <button type="button" class="github-account-action" data-github-logout>退出登录</button>
      </div>
      <main class="github-account-body" data-github-body></main>
    </section>
  `;
  document.body.appendChild(modal);

  const body = modal.querySelector<HTMLElement>('[data-github-body]')!;
  const toolbar = modal.querySelector<HTMLElement>('[data-github-toolbar]')!;
  const title = modal.querySelector<HTMLElement>('[data-github-title]')!;
  const subtitle = modal.querySelector<HTMLElement>('[data-github-subtitle]')!;
  const avatar = modal.querySelector<HTMLImageElement>('[data-github-avatar]')!;
  const search = modal.querySelector<HTMLInputElement>('[data-github-search]')!;
  const close = modal.querySelector<HTMLButtonElement>('[data-github-close]')!;
  const logout = modal.querySelector<HTMLButtonElement>('[data-github-logout]')!;
  const tabButtons = Array.from(
    modal.querySelectorAll<HTMLButtonElement>('[data-github-tab]'),
  );

  let loginState: GitHubLoginState = { authenticated: false };
  let tab: WorkspaceTab = 'repos';
  let repos: GitHubRepo[] = [];
  let people: GitHubPerson[] = [];
  let selectedPerson: GitHubPerson | null = null;
  let selectedPersonRepos: GitHubRepo[] = [];
  let authSequence = 0;

  const setTab = (next: WorkspaceTab): void => {
    if (!loginState.authenticated) {
      renderLoggedOut();
      return;
    }

    tab = next;
    selectedPerson = null;
    selectedPersonRepos = [];
    for (const item of tabButtons) {
      item.dataset.active = String(item.dataset.githubTab === next);
    }
    search.value = '';
    void renderCurrentTab(true);
  };

  const openRepository = (repo: GitHubRepo): void => {
    modal.hidden = true;
    window.dispatchEvent(
      new CustomEvent('ai-ide-github-url', {
        detail: { url: repo.html_url },
      }),
    );
  };

  const renderRepoList = (items: GitHubRepo[], heading?: string): void => {
    const query = search.value.trim().toLowerCase();
    const filtered = query
      ? items.filter((repo) =>
          `${repo.full_name} ${repo.description ?? ''} ${repo.language ?? ''}`
            .toLowerCase()
            .includes(query),
        )
      : items;

    body.replaceChildren();
    if (heading) {
      const head = document.createElement('div');
      head.className = 'github-account-section-head';
      if (selectedPerson) {
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'github-account-back';
        back.textContent = '‹';
        back.addEventListener('click', () => {
          selectedPerson = null;
          selectedPersonRepos = [];
          search.value = '';
          renderPeople();
        });
        head.appendChild(back);
      }
      const label = document.createElement('strong');
      label.textContent = heading;
      head.appendChild(label);
      body.appendChild(head);
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'github-account-empty';
      empty.textContent = query ? '没有匹配的项目' : '没有找到项目';
      body.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'github-repo-list';
    for (const repo of filtered) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'github-repo-card';

      const name = document.createElement('strong');
      name.textContent = `${repo.private ? '🔒 ' : ''}${repo.full_name}`;
      const meta = document.createElement('div');
      meta.className = 'github-repo-meta';
      meta.textContent = [
        repo.language || '未知语言',
        repo.private ? 'Private' : 'Public',
        `更新 ${new Date(repo.updated_at).toLocaleDateString()}`,
      ].join(' · ');
      card.append(name, meta);

      if (repo.description) {
        const description = document.createElement('div');
        description.className = 'github-repo-description';
        description.textContent = repo.description;
        card.appendChild(description);
      }

      card.addEventListener('click', () => openRepository(repo));
      list.appendChild(card);
    }
    body.appendChild(list);
  };

  const renderPeople = (): void => {
    const query = search.value.trim().toLowerCase();
    const filtered = query
      ? people.filter((person) => person.login.toLowerCase().includes(query))
      : people;
    body.replaceChildren();
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'github-account-empty';
      empty.textContent = query ? '没有匹配的用户' : '你还没有关注任何用户';
      body.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'github-person-list';
    for (const person of filtered) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'github-person-card';
      const name = document.createElement('strong');
      name.textContent = person.login;
      const meta = document.createElement('div');
      meta.className = 'github-person-meta';
      meta.textContent = '查看这个用户的公开仓库';
      card.append(name, meta);
      card.addEventListener('click', () => {
        void openFollowingUser(person);
      });
      list.appendChild(card);
    }
    body.appendChild(list);
  };

  const loadOwnRepos = async (): Promise<void> => {
    repos = await paged<GitHubRepo>((page) =>
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner%2Ccollaborator%2Corganization_member`,
    );
  };

  const loadFollowing = async (): Promise<void> => {
    const login = loginState.login ?? '';
    if (!login) {
      people = [];
      return;
    }
    people = await paged<GitHubPerson>((page) =>
      `/users/${encodeURIComponent(login)}/following?per_page=100&page=${page}`,
    );
  };

  const openFollowingUser = async (person: GitHubPerson): Promise<void> => {
    selectedPerson = person;
    body.innerHTML = '<div class="github-account-loading">正在读取公开仓库…</div>';
    try {
      selectedPersonRepos = await paged<GitHubRepo>((page) =>
        `/users/${encodeURIComponent(person.login)}/repos?per_page=100&page=${page}&sort=updated&type=owner`,
      );
      renderRepoList(selectedPersonRepos, `${person.login} · 公开项目`);
    } catch (error) {
      body.innerHTML = `<div class="github-account-empty">${error instanceof Error ? error.message : '读取失败'}</div>`;
    }
  };

  const renderCurrentTab = async (forceLoad = false): Promise<void> => {
    if (!loginState.authenticated) {
      renderLoggedOut();
      return;
    }

    body.innerHTML = '<div class="github-account-loading">正在读取 GitHub…</div>';
    try {
      if (tab === 'repos') {
        if (forceLoad || repos.length === 0) {
          await loadOwnRepos();
        }
        renderRepoList(repos);
        return;
      }

      if (selectedPerson) {
        renderRepoList(selectedPersonRepos, `${selectedPerson.login} · 公开项目`);
        return;
      }

      if (forceLoad || people.length === 0) {
        await loadFollowing();
      }
      renderPeople();
    } catch (error) {
      body.innerHTML = `<div class="github-account-empty">${error instanceof Error ? error.message : 'GitHub 读取失败'}</div>`;
    }
  };

  const renderLoggedIn = async (): Promise<void> => {
    toolbar.hidden = false;
    const login = loginState.login ?? 'GitHub';
    title.textContent = loginState.name || login;
    subtitle.textContent = `@${login} · GitHub 工作区`;
    avatar.hidden = !loginState.avatarUrl;
    avatar.src = loginState.avatarUrl ?? '';
    button.textContent = `🐙 ${login}`;
    await renderCurrentTab(true);
  };

  const renderLoggedOut = (): void => {
    toolbar.hidden = true;
    title.textContent = 'GitHub 工作区';
    subtitle.textContent = '登录后查看私有仓库、协作项目和关注的人';
    avatar.hidden = true;
    button.textContent = '🐙 GitHub';
    body.replaceChildren();

    const content = document.createElement('div');
    content.className = 'github-device-flow';
    content.innerHTML = '<p>使用 GitHub Device Flow 登录。Token 会加密保存在 Android Keystore。</p>';
    const login = document.createElement('button');
    login.type = 'button';
    login.className = 'github-account-action primary';
    login.textContent = '登录 GitHub';
    login.addEventListener('click', () => {
      void startDeviceLogin();
    });
    content.appendChild(login);
    body.appendChild(content);
  };

  const refreshLoginState = async (): Promise<void> => {
    loginState = await getGitHubLoginState();
    if (loginState.authenticated) {
      await renderLoggedIn();
    } else {
      renderLoggedOut();
    }
  };

  const waitUntilVisible = async (): Promise<void> => {
    if (!document.hidden) {
      return;
    }

    await new Promise<void>((resolve) => {
      const onVisible = (): void => {
        if (document.hidden) {
          return;
        }

        document.removeEventListener(
          'visibilitychange',
          onVisible,
        );
        resolve();
      };

      document.addEventListener(
        'visibilitychange',
        onVisible,
      );
    });
  };

  const finishAuthorizedLogin =
    async (
      status: HTMLElement,
    ): Promise<void> => {
      status.textContent =
        '✓ 登录成功，正在读取项目…';
      repos = [];
      people = [];
      await refreshLoginState();
    };

  const showDeviceLogin =
    async (
      flow: {
        deviceCode: string;
        userCode: string;
        verificationUri: string;
        expiresIn: number;
        interval: number;
      },
      sequence: number,
    ): Promise<void> => {
      toolbar.hidden = true;

      const content =
        document.createElement('div');
      content.className =
        'github-device-flow';
      content.innerHTML =
        '<p>在 GitHub 授权页输入下面的验证码：</p>';

      const code =
        document.createElement('div');
      code.className =
        'github-device-code';
      code.textContent =
        flow.userCode;

      const open =
        document.createElement('button');
      open.type = 'button';
      open.className =
        'github-account-action primary';
      open.textContent =
        '打开 GitHub 授权';

      const check =
        document.createElement('button');
      check.type = 'button';
      check.className =
        'github-account-action';
      check.textContent =
        '我已授权，继续登录';

      const status =
        document.createElement('p');
      status.textContent =
        '切到 GitHub 完成授权后再回来即可；这个验证码会保留，不需要重新获取。';

      content.append(
        code,
        open,
        check,
        status,
      );
      body.replaceChildren(content);

      const checkOnce =
        async (): Promise<boolean> => {
          if (sequence !== authSequence) {
            return true;
          }

          check.disabled = true;

          try {
            const poll =
              await pollGitHubDeviceFlow(
                flow.deviceCode,
              );

            if (
              poll.status
                === 'authorization_pending'
            ) {
              status.textContent =
                'GitHub 还没有确认授权。完成授权后回来再点一次即可。';
              return false;
            }

            if (poll.status === 'slow_down') {
              status.textContent =
                'GitHub 要求稍等几秒，再检查一次即可。';
              return false;
            }

            if (poll.status === 'authorized') {
              await finishAuthorizedLogin(
                status,
              );
              return true;
            }

            status.textContent =
              poll.description
                || `GitHub 登录失败：${poll.status}`;
            return true;
          } catch (error) {
            status.textContent =
              error instanceof Error
                ? error.message
                : '检查 GitHub 登录状态失败';
            return false;
          } finally {
            check.disabled = false;
          }
        };

      open.addEventListener(
        'click',
        () => {
          void navigator.clipboard
            ?.writeText(flow.userCode)
            .catch(() => {});

          window.open(
            flow.verificationUri,
            '_blank',
            'noopener,noreferrer',
          );
        },
      );

      check.addEventListener(
        'click',
        () => {
          void checkOnce();
        },
      );

      const deadline =
        Date.now()
          + flow.expiresIn * 1000;
      let interval =
        Math.max(
          5,
          flow.interval,
        );

      while (
        sequence === authSequence
          && Date.now() < deadline
      ) {
        await waitUntilVisible();

        if (sequence !== authSequence) {
          return;
        }

        await delay(interval * 1000);

        if (
          sequence !== authSequence
            || document.hidden
        ) {
          continue;
        }

        const poll =
          await pollGitHubDeviceFlow(
            flow.deviceCode,
          );

        if (
          poll.status
            === 'authorization_pending'
        ) {
          continue;
        }

        if (poll.status === 'slow_down') {
          interval += 5;
          continue;
        }

        if (poll.status === 'authorized') {
          await finishAuthorizedLogin(
            status,
          );
          return;
        }

        status.textContent =
          poll.description
            || `GitHub 登录失败：${poll.status}`;
        return;
      }

      status.textContent =
        '验证码已过期，请重新登录。';
    };

  const resumePendingDeviceLogin =
    async (): Promise<boolean> => {
      const pending =
        await getPendingGitHubDeviceFlow();

      if (!pending) {
        return false;
      }

      const sequence = ++authSequence;
      await showDeviceLogin(
        pending,
        sequence,
      );
      return true;
    };

  const startDeviceLogin =
    async (): Promise<void> => {
      const sequence = ++authSequence;
      toolbar.hidden = true;
      body.innerHTML =
        '<div class="github-account-loading">正在向 GitHub 申请登录验证码…</div>';

      try {
        const flow =
          await beginGitHubDeviceFlow();

        if (sequence !== authSequence) {
          return;
        }

        await showDeviceLogin(
          flow,
          sequence,
        );
      } catch (error) {
        body.innerHTML =
          `<div class="github-account-empty">${
            error instanceof Error
              ? error.message
              : 'GitHub 登录失败'
          }</div>`;
      }
    };

  button.addEventListener('click', () => {
    modal.hidden = false;

    void (async () => {
      loginState =
        await getGitHubLoginState();

      if (loginState.authenticated) {
        await renderLoggedIn();
        return;
      }

      if (
        await resumePendingDeviceLogin()
      ) {
        return;
      }

      renderLoggedOut();
    })();
  });

  close.addEventListener('click', () => {
    authSequence += 1;
    modal.hidden = true;
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      authSequence += 1;
      modal.hidden = true;
    }
  });

  logout.addEventListener('click', () => {
    void (async () => {
      await logoutGitHub();
      loginState = { authenticated: false };
      repos = [];
      people = [];
      selectedPerson = null;
      renderLoggedOut();
    })();
  });

  for (const item of tabButtons) {
    item.addEventListener('click', () => {
      const next = item.dataset.githubTab;
      if (next === 'repos' || next === 'following') {
        setTab(next);
      }
    });
  }

  search.addEventListener('input', () => {
    if (tab === 'repos') {
      renderRepoList(repos);
    } else if (selectedPerson) {
      renderRepoList(selectedPersonRepos, `${selectedPerson.login} · 公开项目`);
    } else {
      renderPeople();
    }
  });

  void getGitHubLoginState()
    .then(async (state) => {
      loginState = state;

      if (
        state.authenticated
          && state.login
      ) {
        button.textContent =
          `🐙 ${state.login}`;
        return;
      }

      const pending =
        await getPendingGitHubDeviceFlow();

      if (pending) {
        button.textContent =
          '🐙 GitHub · 待授权';
      }
    })
    .catch(() => {});

  return true;
}

function bootstrapGitHubAccountWorkspace():
  void {
  if (installGitHubAccountWorkspace()) {
    return;
  }

  const observer = new MutationObserver(() => {
    if (installGitHubAccountWorkspace()) {
      observer.disconnect();
    }
  });

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

    if (installGitHubAccountWorkspace()) {
      observer.disconnect();
      return;
    }

    if (attempts < 120) {
      requestAnimationFrame(retry);
      return;
    }

    observer.disconnect();
  };

  requestAnimationFrame(retry);
}

if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    bootstrapGitHubAccountWorkspace,
    { once: true },
  );
} else {
  bootstrapGitHubAccountWorkspace();
}
