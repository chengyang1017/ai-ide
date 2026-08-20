import type {
  ReaderFocusDetail,
  ReaderRemoteFocusDetail,
  ReaderRemoteSelectionDetail,
  ReaderSelectionDetail,
  ReaderViewportDetail,
} from './reader_surface';
import './reader_collab.css';

interface ReaderPeer {
  peerId: string;
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  centerLine: number;
  focus?: ReaderFocusDetail | null;
  selection?: ReaderSelectionDetail | null;
  updatedAt: number;
}

interface RoomStateMessage {
  type: 'room-state';
  roomCode: string;
  repositoryKey: string;
  peers: ReaderPeer[];
}

interface RoomErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

type ServerMessage =
  | RoomStateMessage
  | RoomErrorMessage;

const SERVER_STORAGE_KEY =
  'ai-code-tutor.reader-room-server';
const NAME_STORAGE_KEY =
  'ai-code-tutor.reader-room-name';

const DEFAULT_SERVER =
  'ws://127.0.0.1:8787';

function randomId(length: number):
  string {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const bytes =
    new Uint8Array(length);

  try {
    if (
      globalThis.crypto
        ?.getRandomValues
    ) {
      globalThis.crypto
        .getRandomValues(bytes);

      return Array.from(
        bytes,
        (value) =>
          alphabet[
            value
              % alphabet.length
          ],
      ).join('');
    }
  } catch (error) {
    console.warn(
      'Secure random unavailable; using room-code fallback.',
      error,
    );
  }

  let result = '';

  for (
    let index = 0;
    index < length;
    index += 1
  ) {
    result +=
      alphabet[
        Math.floor(
          Math.random()
            * alphabet.length,
        )
      ];
  }

  return result;
}

function normalizeRoomCode(
  value: string,
): string {
  return value
    .trim()
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      '',
    )
    .slice(0, 10);
}

let activeLocalWorkspaceKey = '';

function stableWorkspaceHash(
  projectName: string,
  files: string[],
): string {
  const source = [
    projectName.trim(),
    ...files
      .map(
        (path) =>
          path.trim()
            .replace(
              /\\/g,
              '/',
            ),
      )
      .filter(Boolean)
      .sort(),
  ].join('\n');

  let hash = 0x811c9dc5;

  for (
    let index = 0;
    index < source.length;
    index += 1
  ) {
    hash ^=
      source.charCodeAt(index);

    hash =
      Math.imul(
        hash,
        0x01000193,
      );
  }

  return (
    hash >>> 0
  )
    .toString(16)
    .padStart(8, '0');
}

function buildLocalWorkspaceKey(
  projectName: string,
  files: string[],
): string {
  const safeName =
    projectName
      .trim()
      .replace(
        /[\s/\\]+/g,
        '-',
      )
      .slice(0, 80)
      || 'android-project';

  return (
    `local://${safeName}`
      + `#${stableWorkspaceHash(
        projectName,
        files,
      )}`
  );
}

function currentRepositoryKey():
  string {
  const root =
    document
      .querySelector<HTMLElement>(
        '#project-root',
      )
      ?.textContent
      ?.trim()
        ?? '';

  if (
    root.startsWith(
      'github://',
    )
  ) {
    return root;
  }

  return activeLocalWorkspaceKey;
}

function isShareableRepository(
  key: string,
): boolean {
  return (
    key.startsWith(
      'github://',
    )
      || key.startsWith(
        'local://',
      )
  );
}

function githubUrlFromRepositoryKey(
  key: string,
): string | null {
  if (
    !key.startsWith(
      'github://',
    )
  ) {
    return null;
  }

  const body =
    key.slice(
      'github://'.length,
    );

  const separator =
    body.lastIndexOf('@');

  if (
    separator <= 0
      || separator
        >= body.length - 1
  ) {
    return null;
  }

  const repository =
    body.slice(
      0,
      separator,
    );

  const ref =
    body.slice(
      separator + 1,
    );

  if (
    !repository.includes('/')
      || !ref
  ) {
    return null;
  }

  return (
    `https://github.com/${repository}`
      + `/tree/${ref}`
  );
}

function waitForRepositorySnapshot(
  expectedKey: string,
  timeoutMs = 45_000,
): Promise<void> {
  if (
    currentRepositoryKey()
      === expectedKey
  ) {
    return Promise.resolve();
  }

  return new Promise(
    (resolve, reject) => {
      let settled = false;

      const cleanup = (): void => {
        window.clearTimeout(
          timeout,
        );

        window.removeEventListener(
          'android-project-snapshot',
          onSnapshot,
        );
      };

      const finish = (): void => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve();
      };

      const onSnapshot = (
        event: Event,
      ): void => {
        const detail =
          (
            event as CustomEvent<{
              rootPath?: string;
            }>
          ).detail;

        if (
          detail?.rootPath
            === expectedKey
        ) {
          finish();
        }
      };

      const timeout =
        window.setTimeout(
          () => {
            if (settled) {
              return;
            }

            settled = true;
            cleanup();

            reject(
              new Error(
                '自动打开房间项目超时。',
              ),
            );
          },
          timeoutMs,
        );

      window.addEventListener(
        'android-project-snapshot',
        onSnapshot,
      );
    },
  );
}

async function openRoomGitHubRepository(
  repositoryKey: string,
): Promise<void> {
  if (
    currentRepositoryKey()
      === repositoryKey
  ) {
    return;
  }

  const url =
    githubUrlFromRepositoryKey(
      repositoryKey,
    );

  if (!url) {
    throw new Error(
      '房间 GitHub 项目标识无效。',
    );
  }

  const desktopOpen =
    window.tutorIde
      ?.openGitHubRepository;

  if (
    typeof desktopOpen
      === 'function'
  ) {
    const snapshot =
      await desktopOpen(url);

    window.dispatchEvent(
      new CustomEvent(
        'android-project-snapshot',
        {
          detail: snapshot,
        },
      ),
    );

    if (
      snapshot.rootPath
        !== repositoryKey
    ) {
      throw new Error(
        `房间需要 ${repositoryKey}，但实际打开的是 ${snapshot.rootPath}。`,
      );
    }

    return;
  }

  const waiting =
    waitForRepositorySnapshot(
      repositoryKey,
    );

  window.dispatchEvent(
    new CustomEvent(
      'ai-ide-github-url',
      {
        detail: {
          url,
          source:
            'reader-room',
        },
      },
    ),
  );

  await waiting;
}

function peerLocationLabel(
  peer: ReaderPeer,
): string {
  if (peer.selection) {
    const selection =
      peer.selection;

    return (
      `${selection.filePath}`
        + ` · ${selection.startLine}:${selection.startColumn}`
        + ` → ${selection.endLine}:${selection.endColumn}`
    );
  }

  if (peer.focus) {
    return (
      `${peer.focus.filePath}`
        + ` · 第 ${peer.focus.line} 行`
        + ` · 第 ${peer.focus.column} 列`
    );
  }

  return `${peer.filePath} · ${peer.startLine}–${peer.endLine} 行`;
}

export function installReaderCollab():
  () => void {
  const projectGroup =
    document.querySelector<HTMLElement>(
      '.command-group-project',
    );

  if (!projectGroup) {
    return () => {};
  }

  const button =
    document.createElement('button');
  button.type = 'button';
  button.className =
    'reader-collab-open';
  button.textContent =
    '👥 多人阅读';

  projectGroup.append(button);

  const modal =
    document.createElement('div');
  modal.className =
    'reader-collab-modal';
  modal.hidden = true;

  modal.innerHTML = `
    <section
      class="reader-collab-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="多人阅读房间"
    >
      <header class="reader-collab-header">
        <div>
          <strong>👥 多人阅读</strong>
          <p data-room-repository>
            创建房间需要项目；加入房间会自动跟随项目
          </p>
        </div>
        <button
          type="button"
          class="reader-collab-close"
          aria-label="关闭"
        >×</button>
      </header>

      <div class="reader-collab-settings">
        <label>
          <span>你的名字</span>
          <input
            data-room-name
            type="text"
            maxlength="32"
            placeholder="例如 ChengYang"
          />
        </label>

        <label>
          <span>房间服务器</span>
          <input
            data-room-server
            type="url"
            inputmode="url"
            placeholder="ws://192.168.1.10:8787"
          />
        </label>
      </div>

      <div class="reader-collab-connect">
        <button
          type="button"
          class="primary-button"
          data-room-create
        >创建房间</button>

        <div class="reader-collab-join">
          <input
            data-room-code
            type="text"
            maxlength="10"
            autocapitalize="characters"
            placeholder="房间码"
          />
          <button
            type="button"
            data-room-join
          >加入</button>
        </div>
      </div>

      <div
        class="reader-collab-feedback"
        data-room-feedback
      >
        <strong>准备就绪</strong>
        <span>还没有开始连接。</span>
      </div>

      <section
        class="reader-collab-active"
        data-room-active
        hidden
      >
        <div class="reader-collab-room-row">
          <div>
            <small>当前房间</small>
            <strong data-room-current-code>—</strong>
          </div>
          <button
            type="button"
            data-room-copy
          >复制房间码</button>
          <button
            type="button"
            data-room-leave
          >离开</button>
        </div>

        <div
          class="reader-collab-peers"
          data-room-peers
        ></div>
      </section>

      <p
        class="reader-collab-status"
        data-room-status
      >
        GitHub 房间会自动告诉加入者要打开哪个仓库和分支；加入者无需提前打开项目。房间仍只同步阅读位置、讲解光标和选区坐标，不上传代码正文。
      </p>
    </section>
  `;

  document.body.append(modal);

  const closeButton =
    modal.querySelector<HTMLButtonElement>(
      '.reader-collab-close',
    )!;

  const repositoryLabel =
    modal.querySelector<HTMLElement>(
      '[data-room-repository]',
    )!;

  const nameInput =
    modal.querySelector<HTMLInputElement>(
      '[data-room-name]',
    )!;

  const serverInput =
    modal.querySelector<HTMLInputElement>(
      '[data-room-server]',
    )!;

  const roomInput =
    modal.querySelector<HTMLInputElement>(
      '[data-room-code]',
    )!;

  const createButton =
    modal.querySelector<HTMLButtonElement>(
      '[data-room-create]',
    )!;

  const joinButton =
    modal.querySelector<HTMLButtonElement>(
      '[data-room-join]',
    )!;

  const activeSection =
    modal.querySelector<HTMLElement>(
      '[data-room-active]',
    )!;

  const currentCode =
    modal.querySelector<HTMLElement>(
      '[data-room-current-code]',
    )!;

  const copyButton =
    modal.querySelector<HTMLButtonElement>(
      '[data-room-copy]',
    )!;

  const leaveButton =
    modal.querySelector<HTMLButtonElement>(
      '[data-room-leave]',
    )!;

  const peersContainer =
    modal.querySelector<HTMLElement>(
      '[data-room-peers]',
    )!;

  const status =
    modal.querySelector<HTMLElement>(
      '[data-room-status]',
    )!;

  const feedback =
    modal.querySelector<HTMLElement>(
      '[data-room-feedback]',
    )!;

  const notice =
    document.createElement('aside');
  notice.className =
    'reader-peer-notice';
  notice.hidden = true;
  notice.innerHTML = `
    <div>
      <strong data-peer-notice-name></strong>
      <span data-peer-notice-location></span>
    </div>
    <button
      type="button"
      data-peer-notice-jump
    >跳过去</button>
  `;

  document.body.append(notice);

  const noticeName =
    notice.querySelector<HTMLElement>(
      '[data-peer-notice-name]',
    )!;

  const noticeLocation =
    notice.querySelector<HTMLElement>(
      '[data-peer-notice-location]',
    )!;

  const noticeJump =
    notice.querySelector<HTMLButtonElement>(
      '[data-peer-notice-jump]',
    )!;

  nameInput.value =
    localStorage.getItem(
      NAME_STORAGE_KEY,
    ) ?? '';

  serverInput.value =
    localStorage.getItem(
      SERVER_STORAGE_KEY,
    ) ?? DEFAULT_SERVER;

  const peerId =
    crypto.randomUUID();

  let socket:
    WebSocket | null = null;

  let roomCode = '';
  let repositoryKey = '';
  let localViewport:
    ReaderViewportDetail | null =
      null;
  let peers:
    ReaderPeer[] = [];
  let pendingNoticePeer:
    ReaderPeer | null = null;
  let reconnectTimer = 0;
  let connectTimeout = 0;
  let repositorySync:
    Promise<void> | null = null;
  let intentionallyClosed =
    false;

  const setStatus = (
    message: string,
  ): void => {
    status.textContent =
      message;
  };

  const resetConnectButtons =
    (): void => {
      createButton.disabled =
        false;
      joinButton.disabled =
        false;
      createButton.textContent =
        '创建房间';
      joinButton.textContent =
        '加入';
  };

  const setFeedback = (
    title: string,
    message: string,
    kind:
      | 'info'
      | 'working'
      | 'error'
      | 'success'
        = 'info',
  ): void => {
    feedback.dataset.kind =
      kind;
    feedback.innerHTML = '';

    const strong =
      document.createElement(
        'strong',
      );
    strong.textContent =
      title;

    const detail =
      document.createElement(
        'span',
      );
    detail.textContent =
      message;

    feedback.append(
      strong,
      detail,
    );

    setStatus(
      `${title} · ${message}`,
    );
  };

  const failBeforeConnect = (
    title: string,
    message: string,
    focus?: HTMLElement,
  ): void => {
    resetConnectButtons();
    setFeedback(
      title,
      message,
      'error',
    );
    focus?.focus();
  };

  const updateRepositoryLabel =
    (): string => {
      const key =
        currentRepositoryKey();

      repositoryLabel.textContent =
        key
          || '请先打开一个项目';

      return key;
    };

  const setConnectedUi =
    (connected: boolean): void => {
      activeSection.hidden =
        !connected;

      createButton.disabled =
        connected;
      joinButton.disabled =
        connected;
      roomInput.disabled =
        connected;

      currentCode.textContent =
        connected
          ? roomCode
          : '—';

      button.textContent =
        connected
          ? `👥 ${roomCode}`
          : '👥 多人阅读';
    };

  const sameVisibleArea = (
    peer: ReaderPeer,
  ): boolean => {
    const local =
      localViewport;

    if (!local) {
      return false;
    }

    if (
      local.filePath
        !== peer.filePath
    ) {
      return false;
    }

    return (
      peer.endLine
        >= local.startLine
        && peer.startLine
          <= local.endLine
    );
  };

  const jumpToPeer = (
    peer: ReaderPeer,
  ): void => {
    window.dispatchEvent(
      new CustomEvent(
        'ai-ide-reader-jump-request',
        {
          detail: {
            filePath:
              peer.filePath,
            line:
              peer.selection?.startLine
                ?? peer.focus?.line
                ?? peer.centerLine,
          },
        },
      ),
    );

    notice.hidden = true;
  };

  const renderPeers = (): void => {
    peersContainer.replaceChildren();

    const others =
      peers.filter(
        (peer) =>
          peer.peerId !== peerId,
      );

    if (others.length === 0) {
      const empty =
        document.createElement('p');
      empty.className =
        'reader-collab-empty';
      empty.textContent =
        '等待其他人加入…';
      peersContainer.append(
        empty,
      );
      return;
    }

    for (const peer of others) {
      const card =
        document.createElement(
          'article',
        );
      card.className =
        'reader-peer-card';

      const info =
        document.createElement('div');

      const name =
        document.createElement(
          'strong',
        );
      name.textContent =
        `👤 ${peer.name}`;

      const location =
        document.createElement(
          'span',
        );
      location.textContent =
        peerLocationLabel(
          peer,
        );

      info.append(
        name,
        location,
      );

      const jump =
        document.createElement(
          'button',
        );
      jump.type = 'button';
      jump.textContent =
        sameVisibleArea(peer)
          ? '正在附近'
          : '跳过去';
      jump.disabled =
        sameVisibleArea(peer);

      jump.addEventListener(
        'click',
        () => jumpToPeer(peer),
      );

      card.append(
        info,
        jump,
      );

      peersContainer.append(
        card,
      );
    }
  };

  const considerNotice = (
    nextPeers: ReaderPeer[],
  ): void => {
    const candidates =
      nextPeers
        .filter(
          (peer) =>
            peer.peerId !== peerId
              && !sameVisibleArea(
                peer,
              ),
        )
        .sort(
          (a, b) =>
            b.updatedAt
              - a.updatedAt,
        );

    const peer =
      candidates[0];

    if (!peer) {
      pendingNoticePeer =
        null;
      notice.hidden =
        true;
      return;
    }

    const changed =
      !pendingNoticePeer
        || pendingNoticePeer
            .peerId
          !== peer.peerId
        || pendingNoticePeer
            .filePath
          !== peer.filePath
        || pendingNoticePeer
            .selection
            ?.filePath
          !== peer.selection
            ?.filePath
        || pendingNoticePeer
            .selection
            ?.startLine
          !== peer.selection
            ?.startLine
        || pendingNoticePeer
            .selection
            ?.startColumn
          !== peer.selection
            ?.startColumn
        || pendingNoticePeer
            .selection
            ?.endLine
          !== peer.selection
            ?.endLine
        || pendingNoticePeer
            .selection
            ?.endColumn
          !== peer.selection
            ?.endColumn
        || Math.abs(
          pendingNoticePeer
            .centerLine
            - peer.centerLine,
        ) >= 4;

    pendingNoticePeer =
      peer;

    if (!changed) {
      return;
    }

    noticeName.textContent =
      peer.selection
        ? `${peer.name} 正在选中代码`
        : peer.focus
          ? `${peer.name} 正在指向代码`
          : `${peer.name} 正在看别处`;

    noticeLocation.textContent =
      peerLocationLabel(peer);

    notice.hidden = false;
  };

  const send = (
    message: object,
  ): void => {
    if (
      socket?.readyState
        !== WebSocket.OPEN
    ) {
      return;
    }

    socket.send(
      JSON.stringify(message),
    );
  };

  const sendViewport =
    (): void => {
      if (
        !localViewport
          || !roomCode
      ) {
        return;
      }

      send({
        type: 'viewport',
        roomCode,
        peerId,
        viewport:
          localViewport,
      });
  };

  const closeSocket =
    (): void => {
      intentionallyClosed =
        true;

      if (reconnectTimer) {
        window.clearTimeout(
          reconnectTimer,
        );
        reconnectTimer = 0;
      }

      if (connectTimeout) {
        window.clearTimeout(
          connectTimeout,
        );
        connectTimeout = 0;
      }

      createButton.disabled = false;
      joinButton.disabled = false;
      createButton.textContent =
        '创建房间';
      joinButton.textContent =
        '加入';

      socket?.close();
      socket = null;

      roomCode = '';
      repositoryKey = '';
      peers = [];
      pendingNoticePeer =
        null;
      notice.hidden = true;

      window.dispatchEvent(
        new CustomEvent<
          ReaderRemoteFocusDetail[]
        >(
          'ai-ide-reader-remote-focuses',
          {
            detail: [],
          },
        ),
      );

      window.dispatchEvent(
        new CustomEvent<
          ReaderRemoteSelectionDetail[]
        >(
          'ai-ide-reader-remote-selections',
          {
            detail: [],
          },
        ),
      );

      setConnectedUi(false);
      renderPeers();
    };

  const connect = (
    nextRoomCode: string,
    source:
      | 'create'
      | 'join',
  ): void => {
    const key =
      updateRepositoryLabel();

    if (
      source === 'create'
        && !isShareableRepository(
          key,
        )
    ) {
      const rawRoot =
        document
          .querySelector<HTMLElement>(
            '#project-root',
          )
          ?.textContent
          ?.trim()
            ?? '';

      failBeforeConnect(
        '当前项目还不能创建房间',
        rawRoot
          ? `已打开：${rawRoot}。如果这是 Android 本地项目，请等待文件树索引完成后再试一次。`
          : '还没有识别到项目。请先打开 GitHub 仓库或 Android 本地项目。',
      );
      return;
    }

    let name =
      nameInput.value
        .trim();

    if (!name) {
      name =
        `Reader-${randomId(4)}`;
      nameInput.value =
        name;

      localStorage.setItem(
        NAME_STORAGE_KEY,
        name,
      );
    }

    const server =
      serverInput.value
        .trim();

    if (
      !/^wss?:\/\//i.test(
        server,
      )
    ) {
      failBeforeConnect(
        '服务器地址无效',
        `当前值：${server || '空'}。请填写 ws:// 或 wss:// 地址。`,
        serverInput,
      );
      return;
    }

    const normalized =
      normalizeRoomCode(
        nextRoomCode,
      );

    if (normalized.length < 4) {
      failBeforeConnect(
        '房间码无效',
        `当前房间码：${normalized || '空'}。至少需要 4 位。`,
        roomInput,
      );
      return;
    }

    setFeedback(
      '开始连接',
      source === 'join'
        ? `将跟随房间项目 · 服务器：${server} · 房间：${normalized}`
        : `项目：${key} · 服务器：${server} · 房间：${normalized}`,
      'working',
    );

    closeSocket();

    intentionallyClosed =
      false;

    createButton.disabled =
      true;
    joinButton.disabled =
      true;

    if (source === 'create') {
      createButton.textContent =
        '连接中…';
      joinButton.textContent =
        '加入';
    } else {
      createButton.textContent =
        '创建房间';
      joinButton.textContent =
        '连接中…';
    }

    roomCode =
      normalized;
    repositoryKey =
      source === 'create'
        ? key
        : '';

    localStorage.setItem(
      NAME_STORAGE_KEY,
      name,
    );
    localStorage.setItem(
      SERVER_STORAGE_KEY,
      server,
    );

    setStatus(
      `正在连接 ${server}…`,
    );

    let nextSocket: WebSocket;

    try {
      nextSocket =
        new WebSocket(server);
    } catch (error) {
      createButton.disabled = false;
      joinButton.disabled = false;
      createButton.textContent =
        '创建房间';
      joinButton.textContent =
        '加入';
      setFeedback(
        'WebSocket 创建失败',
        error instanceof Error
          ? error.message
          : String(error),
        'error',
      );
      return;
    }

    socket =
      nextSocket;

    connectTimeout =
      window.setTimeout(
        () => {
          if (
            socket !== nextSocket
              || nextSocket.readyState
                === WebSocket.OPEN
          ) {
            return;
          }

          nextSocket.close();
          socket = null;
          connectTimeout = 0;

          createButton.disabled =
            false;
          joinButton.disabled =
            false;
          createButton.textContent =
            '创建房间';
          joinButton.textContent =
            '加入';

          setFeedback(
            '连接超时',
            `5 秒内没有连接到 ${server}。请确认 reader:server 正在运行，并检查 Windows 防火墙。`,
            'error',
          );
        },
        5000,
      );

    nextSocket.addEventListener(
      'open',
      () => {
        if (
          socket !== nextSocket
        ) {
          return;
        }

        if (connectTimeout) {
          window.clearTimeout(
            connectTimeout,
          );
          connectTimeout = 0;
        }

        createButton.textContent =
          '创建房间';
        joinButton.textContent =
          '加入';

        send({
          type: 'join',
          roomCode,
          peerId,
          name,
          repositoryKey,
          mode: source,
        });

        setConnectedUi(true);
        setFeedback(
          'WebSocket 已连接',
          `正在加入房间 ${roomCode}…`,
          'working',
        );

        sendViewport();
      },
    );

    nextSocket.addEventListener(
      'message',
      async (event) => {
        if (
          socket !== nextSocket
            || typeof event.data
              !== 'string'
        ) {
          return;
        }

        let message:
          ServerMessage;

        try {
          message =
            JSON.parse(
              event.data,
            ) as ServerMessage;
        } catch {
          return;
        }

        if (
          message.type
            === 'error'
        ) {
          setFeedback(
            '服务器拒绝加入',
            message.message,
            'error',
          );
          resetConnectButtons();
          return;
        }

        if (
          message.type
            !== 'room-state'
        ) {
          return;
        }

        const roomRepositoryKey =
          message.repositoryKey;

        repositoryKey =
          roomRepositoryKey;

        if (
          currentRepositoryKey()
            !== roomRepositoryKey
        ) {
          if (
            roomRepositoryKey.startsWith(
              'github://',
            )
          ) {
            setFeedback(
              '正在打开房间项目',
              `${roomRepositoryKey} · 不需要你提前打开项目。`,
              'working',
            );

            repositorySync ??=
              openRoomGitHubRepository(
                roomRepositoryKey,
              ).finally(
                () => {
                  repositorySync =
                    null;
                },
              );

            try {
              await repositorySync;
            } catch (error) {
              setFeedback(
                '房间已加入，但项目自动打开失败',
                error instanceof Error
                  ? error.message
                  : String(error),
                'error',
              );
              return;
            }
          } else if (
            roomRepositoryKey.startsWith(
              'local://',
            )
          ) {
            setFeedback(
              '这个房间使用本地项目',
              '本地项目源码目前不会上传到房间服务器，所以暂时仍需要双方各自打开同一份本地项目。',
              'info',
            );
          }
        }

        peers =
          message.peers;

        setFeedback(
          '✓ 已进入多人阅读房间',
          `${message.roomCode} · 在线 ${message.peers.length} 人 · 项目已同步`,
          'success',
        );

        const remoteSelections:
          ReaderRemoteSelectionDetail[] =
            message.peers
              .filter(
                (peer) =>
                  peer.peerId !== peerId
                    && Boolean(
                      peer.selection,
                    ),
              )
              .map(
                (peer) => ({
                  peerId:
                    peer.peerId,
                  name:
                    peer.name,
                  selection:
                    peer.selection!,
                }),
              );

        window.dispatchEvent(
          new CustomEvent<
            ReaderRemoteSelectionDetail[]
          >(
            'ai-ide-reader-remote-selections',
            {
              detail:
                remoteSelections,
            },
          ),
        );

        const remoteFocuses:
          ReaderRemoteFocusDetail[] =
            message.peers
              .filter(
                (peer) =>
                  peer.peerId !== peerId
                    && Boolean(
                      peer.focus,
                    ),
              )
              .map(
                (peer) => ({
                  peerId:
                    peer.peerId,
                  name:
                    peer.name,
                  focus:
                    peer.focus!,
                }),
              );

        window.dispatchEvent(
          new CustomEvent<
            ReaderRemoteFocusDetail[]
          >(
            'ai-ide-reader-remote-focuses',
            {
              detail:
                remoteFocuses,
            },
          ),
        );

        renderPeers();
        considerNotice(
          message.peers,
        );
      },
    );

    nextSocket.addEventListener(
      'close',
      () => {
        if (
          socket !== nextSocket
        ) {
          return;
        }

        socket = null;

        if (connectTimeout) {
          window.clearTimeout(
            connectTimeout,
          );
          connectTimeout = 0;
        }

        createButton.disabled = false;
        joinButton.disabled = false;
        createButton.textContent =
          '创建房间';
        joinButton.textContent =
          '加入';

        if (intentionallyClosed) {
          return;
        }

        setFeedback(
          '连接已断开',
          '检查服务器和 Wi-Fi 后重新加入房间。',
          'error',
        );
        setConnectedUi(false);
      },
    );

    nextSocket.addEventListener(
      'error',
      () => {
        if (
          socket !== nextSocket
        ) {
          return;
        }

        setFeedback(
          'WebSocket 连接失败',
          `无法连接 ${server}。`,
          'error',
        );
      },
    );
  };

  button.addEventListener(
    'click',
    () => {
      updateRepositoryLabel();
      modal.hidden = false;
    },
  );

  closeButton.addEventListener(
    'click',
    () => {
      modal.hidden = true;
    },
  );

  modal.addEventListener(
    'click',
    (event) => {
      if (event.target === modal) {
        modal.hidden = true;
      }
    },
  );

  createButton.addEventListener(
    'click',
    () => {
      setStatus(
        '正在生成房间码…',
      );

      createButton.textContent =
        '准备中…';

      try {
        const generatedRoomCode =
          randomId(8);

        roomInput.value =
          generatedRoomCode;

        setStatus(
          `房间码 ${generatedRoomCode} 已生成，正在连接服务器…`,
        );

        connect(
          generatedRoomCode,
          'create',
        );
      } catch (error) {
        createButton.disabled =
          false;
        joinButton.disabled =
          false;
        createButton.textContent =
          '创建房间';

        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.error(
          'Create reader room failed before WebSocket connect.',
          error,
        );

        setFeedback(
          '创建房间入口失败',
          message,
          'error',
        );
      }
    },
  );

  joinButton.addEventListener(
    'click',
    () => {
      setStatus(
        '正在检查房间信息…',
      );

      try {
        connect(
          roomInput.value,
          'join',
        );
      } catch (error) {
        joinButton.disabled =
          false;
        joinButton.textContent =
          '加入';

        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.error(
          'Join reader room failed before WebSocket connect.',
          error,
        );

        setFeedback(
          '加入房间入口失败',
          message,
          'error',
        );
      }
    },
  );

  roomInput.addEventListener(
    'input',
    () => {
      roomInput.value =
        normalizeRoomCode(
          roomInput.value,
        );
    },
  );

  copyButton.addEventListener(
    'click',
    () => {
      void navigator.clipboard
        ?.writeText(
          roomCode,
        )
        .then(
          () => {
            setStatus(
              `✓ 已复制房间码 ${roomCode}`,
            );
          },
        )
        .catch(
          () => {
            setStatus(
              `房间码：${roomCode}`,
            );
          },
        );
    },
  );

  leaveButton.addEventListener(
    'click',
    () => {
      closeSocket();
      setStatus(
        '已离开阅读房间。',
      );
    },
  );

  noticeJump.addEventListener(
    'click',
    () => {
      if (pendingNoticePeer) {
        jumpToPeer(
          pendingNoticePeer,
        );
      }
    },
  );

  const onViewport = (
    event: Event,
  ): void => {
    localViewport =
      (
        event as CustomEvent<
          ReaderViewportDetail
        >
      ).detail;

    sendViewport();

    if (peers.length > 0) {
      renderPeers();
      considerNotice(peers);
    }
  };

  window.addEventListener(
    'ai-ide-reader-viewport',
    onViewport,
  );

  const onReaderFocus = (
    event: Event,
  ): void => {
    const focus =
      (
        event as CustomEvent<
          ReaderFocusDetail | null
        >
      ).detail;

    if (!roomCode) {
      return;
    }

    send({
      type: 'focus',
      roomCode,
      peerId,
      focus:
        focus
          ? { ...focus }
          : null,
    });
  };

  window.addEventListener(
    'ai-ide-reader-focus',
    onReaderFocus,
  );

  const onReaderSelection = (
    event: Event,
  ): void => {
    const selection =
      (
        event as CustomEvent<
          ReaderSelectionDetail | null
        >
      ).detail;

    if (!roomCode) {
      return;
    }

    send({
      type: 'selection',
      roomCode,
      peerId,
      selection:
        selection
          ? { ...selection }
          : null,
    });
  };

  window.addEventListener(
    'ai-ide-reader-selection',
    onReaderSelection,
  );

  const onAndroidProjectSnapshot = (
    event: Event,
  ): void => {
    const detail =
      (
        event as CustomEvent<{
          projectName?: string;
          files?: string[];
        }>
      ).detail;

    const projectName =
      detail?.projectName
        ?.trim()
        ?? '';

    const files =
      Array.isArray(
        detail?.files,
      )
        ? detail.files
        : [];

    if (
      !projectName
        || files.length === 0
    ) {
      return;
    }

    const previousKey =
      currentRepositoryKey();

    activeLocalWorkspaceKey =
      buildLocalWorkspaceKey(
        projectName,
        files,
      );

    const nextKey =
      currentRepositoryKey();

    updateRepositoryLabel();

    if (
      roomCode
        && previousKey
        && previousKey !== nextKey
    ) {
      closeSocket();
      setFeedback(
        '项目已经切换',
        '已自动离开原阅读房间。',
        'info',
      );
    }
  };

  window.addEventListener(
    'android-project-snapshot',
    onAndroidProjectSnapshot,
  );

  const projectRoot =
    document.querySelector<HTMLElement>(
      '#project-root',
    );

  const projectObserver =
    projectRoot
      ? new MutationObserver(
          () => {
            const next =
              currentRepositoryKey();

            updateRepositoryLabel();

            if (
              roomCode
                && next
                  !== repositoryKey
            ) {
              closeSocket();
              setStatus(
                '项目已经切换，已自动离开原阅读房间。',
              );
            }
          },
        )
      : null;

  projectObserver?.observe(
    projectRoot!,
    {
      childList: true,
      subtree: true,
      characterData: true,
    },
  );

  updateRepositoryLabel();
  setConnectedUi(false);
  renderPeers();

  return () => {
    closeSocket();
    projectObserver?.disconnect();

    window.removeEventListener(
      'android-project-snapshot',
      onAndroidProjectSnapshot,
    );

    window.removeEventListener(
      'ai-ide-reader-viewport',
      onViewport,
    );

    window.removeEventListener(
      'ai-ide-reader-focus',
      onReaderFocus,
    );

    window.removeEventListener(
      'ai-ide-reader-selection',
      onReaderSelection,
    );

    button.remove();
    notice.remove();
    modal.remove();
  };
}
