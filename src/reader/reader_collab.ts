import type {
  ReaderFocusDetail,
  ReaderRemoteFocusDetail,
  ReaderRemoteSelectionDetail,
  ReaderSelectionDetail,
  ReaderViewportDetail,
} from './reader_surface';
import {
  clearCollabRemoteProject,
  setCollabRemoteProject,
} from './collab_remote_project';
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

interface CollabProjectSnapshot {
  projectName: string;
  files: string[];
  directories: string[];
  preferredFile: string;
}

interface RoomStateMessage {
  type: 'room-state';
  roomCode: string;
  repositoryKey: string;
  peers: ReaderPeer[];
  projectSnapshot?: CollabProjectSnapshot | null;
}

interface FileRequestMessage {
  type: 'file-request';
  requestId: string;
  requesterPeerId: string;
  path: string;
}

interface FileResponseMessage {
  type: 'file-response';
  requestId: string;
  path: string;
  content?: string;
  error?: string;
}

interface HelloAckMessage {
  type: 'hello-ack';
  protocolVersion: number;
  capabilities: string[];
}

interface ProtocolErrorMessage {
  type: 'protocol-error';
  serverProtocolVersion: number;
  clientProtocolVersion: number;
  message: string;
}

interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

interface FriendSummary {
  userId: string;
  name: string;
  online: boolean;
}

interface DirectoryStateMessage {
  type: 'directory-state';
  friends: FriendSummary[];
}

interface FriendRequestMessage {
  type: 'friend-request';
  fromUserId: string;
  fromName: string;
}

interface FriendAddedMessage {
  type: 'friend-added';
  userId: string;
  name: string;
  online: boolean;
}

interface FriendRequestSentMessage {
  type: 'friend-request-sent';
  targetName: string;
  queued: boolean;
}

interface CollaborationInviteMessage {
  type: 'collab-invite';
  fromUserId: string;
  fromName: string;
  roomCode: string;
  repositoryKey: string;
}

interface InviteSentMessage {
  type: 'collab-invite-sent';
  targetUserId: string;
}

interface AuthOkMessage {
  type: 'auth-ok';
  userId: string;
  name: string;
  sessionToken?: string;
}

type ServerMessage =
  | HelloAckMessage
  | AuthOkMessage
  | ProtocolErrorMessage
  | RoomStateMessage
  | ErrorMessage
  | DirectoryStateMessage
  | FriendRequestMessage
  | FriendAddedMessage
  | FriendRequestSentMessage
  | CollaborationInviteMessage
  | InviteSentMessage
  | FileRequestMessage
  | FileResponseMessage;

interface StoredFriend {
  userId: string;
  name: string;
}

const SERVER_STORAGE_KEY =
  'ai-code-tutor.reader-room-server';
const NAME_STORAGE_KEY =
  'ai-code-tutor.reader-room-name';
const USER_ID_STORAGE_KEY =
  'ai-code-tutor.reader-friend-user-id';
const SESSION_STORAGE_KEY =
  'ai-code-tutor.reader-account-session';
const FRIENDS_STORAGE_KEY =
  'ai-code-tutor.reader-friends';

const BUILD_COLLAB_SERVER =
  import.meta.env
    .VITE_COLLAB_SERVER_URL
    ?.trim()
      ?? '';

const LOCAL_DEFAULT_SERVER =
  'ws://127.0.0.1:8787';

function isDevelopmentServer(
  value: string,
): boolean {
  try {
    const url =
      new URL(value);

    const host =
      url.hostname
        .toLowerCase();

    if (
      url.protocol === 'ws:'
    ) {
      return true;
    }

    return (
      host === 'localhost'
        || host === '127.0.0.1'
        || host === '::1'
        || host.startsWith(
          '192.168.',
        )
        || host.startsWith(
          '10.',
        )
        || /^172\.(1[6-9]|2\d|3[01])\./
          .test(host)
    );
  } catch {
    return false;
  }
}

function initialCollabServer():
  string {
  const saved =
    localStorage.getItem(
      SERVER_STORAGE_KEY,
    )
      ?.trim()
      ?? '';

  if (
    BUILD_COLLAB_SERVER
      && (
        !saved
          || isDevelopmentServer(
            saved,
          )
      )
  ) {
    return BUILD_COLLAB_SERVER;
  }

  return (
    saved
      || BUILD_COLLAB_SERVER
      || LOCAL_DEFAULT_SERVER
  );
}

const COLLAB_PROTOCOL_VERSION =
  26;

const PROTOCOL_HANDSHAKE_TIMEOUT_MS =
  1800;

const COLLAB_CAPABILITIES = [
  'account-auth',
  'friend-directory',
  'friend-invite',
  'room',
  'local-project-stream',
  'remote-file-read',
  'reader-viewport',
  'reader-focus',
  'reader-selection',
] as const;

function randomId(length: number):
  string {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const bytes =
    new Uint8Array(length);

  try {
    globalThis.crypto
      ?.getRandomValues(bytes);

    return Array.from(
      bytes,
      (value) =>
        alphabet[
          value % alphabet.length
        ],
    ).join('');
  } catch {
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

function ensureUserId(): string {
  const existing =
    localStorage.getItem(
      USER_ID_STORAGE_KEY,
    )
      ?.trim();

  if (existing) {
    return existing;
  }

  const created =
    crypto.randomUUID();

  localStorage.setItem(
    USER_ID_STORAGE_KEY,
    created,
  );

  return created;
}

function loadFriends():
  StoredFriend[] {
  try {
    const raw =
      localStorage.getItem(
        FRIENDS_STORAGE_KEY,
      );

    if (!raw) {
      return [];
    }

    const parsed =
      JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    const unique =
      new Map<string, StoredFriend>();

    for (const value of parsed) {
      if (
        !value
          || typeof value
            !== 'object'
      ) {
        continue;
      }

      const candidate =
        value as {
          userId?: unknown;
          name?: unknown;
        };

      if (
        typeof candidate.userId
          !== 'string'
          || typeof candidate.name
            !== 'string'
      ) {
        continue;
      }

      const userId =
        candidate.userId.trim();
      const name =
        candidate.name.trim();

      if (!userId || !name) {
        continue;
      }

      unique.set(
        userId,
        {
          userId,
          name,
        },
      );
    }

    return Array.from(
      unique.values(),
    );
  } catch {
    return [];
  }
}

function saveFriends(
  friends: StoredFriend[],
): void {
  localStorage.setItem(
    FRIENDS_STORAGE_KEY,
    JSON.stringify(friends),
  );
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

  const workspaceBadge =
    document
      .querySelector<HTMLElement>(
        '#workspace-badge',
      )
      ?.textContent
      ?.trim()
        ?? '';

  if (
    workspaceBadge
      === '真实项目'
      && root
      && root
        !== '尚未打开真实项目'
  ) {
    const projectName =
      document
        .querySelector<HTMLElement>(
          '#project-name',
        )
        ?.textContent
        ?.trim()
        .replace(
          /^▾\s*/,
          '',
        )
          ?? '';

    const files =
      Array.from(
        document
          .querySelectorAll<HTMLElement>(
            '#file-tree .file-item[data-path]',
          ),
      )
        .map(
          (item) =>
            item.dataset.path
              ?.trim()
              ?? '',
        )
        .filter(Boolean);

    if (
      projectName
        && files.length > 0
    ) {
      return buildLocalWorkspaceKey(
        projectName,
        files,
      );
    }
  }

  return activeLocalWorkspaceKey;
}

function localWorkspaceSlug(
  key: string,
): string {
  if (
    !key.startsWith(
      'local://',
    )
  ) {
    return '';
  }

  const body =
    key.slice(
      'local://'.length,
    );

  const hashIndex =
    body.lastIndexOf('#');

  return (
    hashIndex >= 0
      ? body.slice(
          0,
          hashIndex,
        )
      : body
  )
    .trim()
    .toLocaleLowerCase();
}

function localWorkspacesCompatible(
  currentKey: string,
  expectedKey: string,
): boolean {
  if (
    currentKey === expectedKey
  ) {
    return true;
  }

  const currentSlug =
    localWorkspaceSlug(
      currentKey,
    );

  const expectedSlug =
    localWorkspaceSlug(
      expectedKey,
    );

  return Boolean(
    currentSlug
      && expectedSlug
      && currentSlug
        === expectedSlug,
  );
}

function currentLocalProjectSnapshot():
  CollabProjectSnapshot | null {
  const key =
    currentRepositoryKey();

  if (
    !key.startsWith(
      'local://',
    )
  ) {
    return null;
  }

  const projectName =
    document
      .querySelector<HTMLElement>(
        '#project-name',
      )
      ?.textContent
      ?.trim()
      .replace(
        /^▾\s*/,
        '',
      )
        ?? '';

  const files =
    Array.from(
      document
        .querySelectorAll<HTMLElement>(
          '#file-tree .file-item[data-path]',
        ),
    )
      .map(
        (item) =>
          item.dataset.path
            ?.trim()
            ?? '',
      )
      .filter(Boolean);

  const directories =
    Array.from(
      document
        .querySelectorAll<HTMLElement>(
          '#file-tree .directory-item[data-directory-path]',
        ),
    )
      .map(
        (item) =>
          item.dataset.directoryPath
            ?.trim()
            ?? '',
      )
      .filter(Boolean);

  const preferredFile =
    document
      .querySelector<HTMLElement>(
        '#active-file',
      )
      ?.textContent
      ?.trim()
        ?? '';

  if (
    !projectName
      || files.length === 0
  ) {
    return null;
  }

  return {
    projectName,
    files,
    directories,
    preferredFile:
      files.includes(
        preferredFile,
      )
        ? preferredFile
        : files[0] ?? '',
  };
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
            !== expectedKey
        ) {
          return;
        }

        window.requestAnimationFrame(
          () => {
            if (
              currentRepositoryKey()
                === expectedKey
            ) {
              finish();
            }
          },
        );
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
                '自动打开协作项目超时。',
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
      '协作 GitHub 项目标识无效。',
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
        `协作需要 ${repositoryKey}，但实际打开的是 ${snapshot.rootPath}。`,
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
            'reader-friend-invite',
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

  return (
    `${peer.filePath}`
      + ` · ${peer.startLine}–${peer.endLine} 行`
  );
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
    '👥 协作';

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
      aria-label="好友协作"
    >
      <header class="reader-collab-header">
        <div>
          <strong>👥 好友协作</strong>
          <p data-room-repository>
            打开项目后，直接邀请好友一起阅读
          </p>
        </div>
        <button
          type="button"
          class="reader-collab-close"
          aria-label="关闭"
        >×</button>
      </header>

      <section class="reader-friend-identity">
        <label>
          <span>账号用户名</span>
          <input
            data-room-name
            type="text"
            maxlength="32"
            autocomplete="username"
            placeholder="例如 ChengYang"
          />
        </label>

        <label>
          <span>密码</span>
          <input
            data-account-password
            type="password"
            minlength="8"
            maxlength="128"
            autocomplete="current-password"
            placeholder="至少 8 个字符"
          />
        </label>

        <div class="reader-friend-inline">
          <button
            type="button"
            class="primary-button"
            data-account-login
          >登录</button>
          <button
            type="button"
            data-account-register
          >注册</button>
          <button
            type="button"
            data-account-logout
            hidden
          >退出账号</button>
        </div>

        <small data-directory-status>
          正在连接好友服务…
        </small>
      </section>

      <section class="reader-friend-add">
        <label>
          <span>添加好友</span>
          <div class="reader-friend-inline">
            <input
              data-friend-name
              type="text"
              maxlength="32"
              placeholder="输入对方用户名"
            />
            <button
              type="button"
              class="primary-button"
              data-friend-add
            >发送请求</button>
          </div>
        </label>
      </section>

      <section
        class="reader-friend-requests"
        data-friend-requests-section
        hidden
      >
        <div class="reader-friend-section-title">
          <strong>好友请求</strong>
          <span data-friend-request-count></span>
        </div>
        <div
          class="reader-friend-list"
          data-friend-requests
        ></div>
      </section>

      <section class="reader-friends">
        <div class="reader-friend-section-title">
          <strong>好友</strong>
          <span data-friend-online-count></span>
        </div>
        <div
          class="reader-friend-list"
          data-friends
        ></div>
      </section>

      <section
        class="reader-collab-active"
        data-room-active
        hidden
      >
        <div class="reader-collab-room-row">
          <div>
            <small>当前协作</small>
            <strong data-room-current-code>
              已连接
            </strong>
          </div>
          <button
            type="button"
            data-room-leave
          >离开协作</button>
        </div>

        <div
          class="reader-collab-peers"
          data-room-peers
        ></div>
      </section>

      <div
        class="reader-collab-feedback"
        data-room-feedback
      >
        <strong>准备就绪</strong>
        <span>
          选择一个在线好友，点击“一起阅读”。
        </span>
      </div>

      <details class="reader-collab-legacy">
        <summary>高级 / 兼容房间码</summary>

        <div class="reader-collab-settings">
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
            data-room-create
          >创建兼容房间</button>

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
      </details>

      <p
        class="reader-collab-status"
        data-room-status
      >
        好友模式只传输身份、在线状态、邀请、阅读位置、讲解光标和选区坐标；不会把源码正文上传到协作服务器。
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

  const passwordInput =
    modal.querySelector<HTMLInputElement>(
      '[data-account-password]',
    )!;

  const loginButton =
    modal.querySelector<HTMLButtonElement>(
      '[data-account-login]',
    )!;

  const registerButton =
    modal.querySelector<HTMLButtonElement>(
      '[data-account-register]',
    )!;

  const logoutButton =
    modal.querySelector<HTMLButtonElement>(
      '[data-account-logout]',
    )!;

  const friendNameInput =
    modal.querySelector<HTMLInputElement>(
      '[data-friend-name]',
    )!;

  const addFriendButton =
    modal.querySelector<HTMLButtonElement>(
      '[data-friend-add]',
    )!;

  const directoryStatus =
    modal.querySelector<HTMLElement>(
      '[data-directory-status]',
    )!;

  const friendRequestsSection =
    modal.querySelector<HTMLElement>(
      '[data-friend-requests-section]',
    )!;

  const friendRequestCount =
    modal.querySelector<HTMLElement>(
      '[data-friend-request-count]',
    )!;

  const friendRequestsContainer =
    modal.querySelector<HTMLElement>(
      '[data-friend-requests]',
    )!;

  const friendOnlineCount =
    modal.querySelector<HTMLElement>(
      '[data-friend-online-count]',
    )!;

  const friendsContainer =
    modal.querySelector<HTMLElement>(
      '[data-friends]',
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

  const inviteNotice =
    document.createElement('aside');
  inviteNotice.className =
    'reader-collab-invite';
  inviteNotice.hidden = true;
  inviteNotice.innerHTML = `
    <div>
      <strong data-collab-invite-title></strong>
      <span data-collab-invite-project></span>
    </div>
    <div class="reader-collab-invite-actions">
      <button
        type="button"
        class="primary-button"
        data-collab-invite-accept
      >加入</button>
      <button
        type="button"
        data-collab-invite-reject
      >拒绝</button>
    </div>
  `;

  document.body.append(inviteNotice);

  const inviteTitle =
    inviteNotice.querySelector<HTMLElement>(
      '[data-collab-invite-title]',
    )!;

  const inviteProject =
    inviteNotice.querySelector<HTMLElement>(
      '[data-collab-invite-project]',
    )!;

  const inviteAccept =
    inviteNotice.querySelector<HTMLButtonElement>(
      '[data-collab-invite-accept]',
    )!;

  const inviteReject =
    inviteNotice.querySelector<HTMLButtonElement>(
      '[data-collab-invite-reject]',
    )!;

  const userId =
    ensureUserId();

  let accountUserId = '';
  let accountName = '';
  let sessionToken =
    localStorage.getItem(
      SESSION_STORAGE_KEY,
    )
      ?.trim()
      ?? '';

  nameInput.value =
    localStorage.getItem(
      NAME_STORAGE_KEY,
    )
      ?.trim()
      || `Reader-${randomId(4)}`;

  localStorage.setItem(
    NAME_STORAGE_KEY,
    nameInput.value,
  );

  serverInput.value =
    initialCollabServer();

  if (
    BUILD_COLLAB_SERVER
      && serverInput.value
        === BUILD_COLLAB_SERVER
  ) {
    localStorage.setItem(
      SERVER_STORAGE_KEY,
      BUILD_COLLAB_SERVER,
    );
  }

  let storedFriends:
    StoredFriend[] = [];

  let onlineFriends =
    new Map<
      string,
      FriendSummary
    >();

  let friendRequests:
    FriendRequestMessage[] = [];

  let pendingInvite:
    CollaborationInviteMessage | null =
      null;

  let pendingInviteTarget = '';

  let directorySocket:
    WebSocket | null = null;
  let directoryReconnectTimer = 0;
  let directoryGeneration = 0;
  let directoryProtocolReady =
    false;

  let socket:
    WebSocket | null = null;
  let roomProtocolReady =
    false;
  let protocolHandshakeTimeout =
    0;

  let roomCode = '';
  let repositoryKey = '';
  let localViewport:
    ReaderViewportDetail | null =
      null;
  let peers:
    ReaderPeer[] = [];
  let pendingNoticePeer:
    ReaderPeer | null = null;
  let connectTimeout = 0;
  let repositorySync:
    Promise<void> | null = null;
  let intentionallyClosedRoom =
    false;
  let roomProjectSnapshot:
    CollabProjectSnapshot | null =
      null;
  let remoteLocalProjectActive =
    false;
  let remoteFileSequence = 0;

  const pendingRemoteFileReads =
    new Map<
      string,
      {
        resolve: (
          result: {
            path: string;
            content: string;
          },
        ) => void;
        reject: (
          error: Error,
        ) => void;
        timeout: number;
      }
    >();

  const setStatus = (
    message: string,
  ): void => {
    status.textContent =
      message;
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
    feedback.replaceChildren();

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

  const updateRepositoryLabel =
    (): string => {
      const key =
        currentRepositoryKey();

      repositoryLabel.textContent =
        key
          || '请先打开一个项目';

      return key;
    };

  const currentName = (): string => {
    if (accountName) {
      return accountName;
    }

    let name =
      nameInput.value.trim();

    if (!name) {
      name =
        `Reader-${randomId(4)}`;
      nameInput.value =
        name;
    }

    localStorage.setItem(
      NAME_STORAGE_KEY,
      name,
    );

    return name;
  };

  const currentServer = ():
    string | null => {
    const server =
      serverInput.value.trim();

    if (
      !/^wss?:\/\//i.test(
        server,
      )
    ) {
      setFeedback(
        '服务器地址无效',
        '请在高级设置里填写 ws:// 或 wss:// 地址。',
        'error',
      );
      return null;
    }

    localStorage.setItem(
      SERVER_STORAGE_KEY,
      server,
    );

    return server;
  };

  const upsertStoredFriend = (
    friend: StoredFriend,
  ): void => {
    const next =
      storedFriends.filter(
        (item) =>
          item.userId
            !== friend.userId,
      );

    next.push(friend);
    next.sort(
      (a, b) =>
        a.name.localeCompare(
          b.name,
        ),
    );

    storedFriends = next;
    saveFriends(
      storedFriends,
    );
  };

  const renderFriendRequests =
    (): void => {
      friendRequestsSection.hidden =
        friendRequests.length === 0;

      friendRequestCount.textContent =
        friendRequests.length > 0
          ? `${friendRequests.length} 个`
          : '';

      friendRequestsContainer
        .replaceChildren();

      for (
        const request
          of friendRequests
      ) {
        const card =
          document.createElement(
            'article',
          );
        card.className =
          'reader-friend-card';

        const info =
          document.createElement(
            'div',
          );

        const title =
          document.createElement(
            'strong',
          );
        title.textContent =
          request.fromName;

        const subtitle =
          document.createElement(
            'span',
          );
        subtitle.textContent =
          '想添加你为好友';

        info.append(
          title,
          subtitle,
        );

        const actions =
          document.createElement(
            'div',
          );
        actions.className =
          'reader-friend-card-actions';

        const accept =
          document.createElement(
            'button',
          );
        accept.type = 'button';
        accept.className =
          'primary-button';
        accept.textContent =
          '接受';

        const reject =
          document.createElement(
            'button',
          );
        reject.type = 'button';
        reject.textContent =
          '拒绝';

        accept.addEventListener(
          'click',
          () => {
            sendDirectory({
              type: 'friend-accept',
              targetUserId:
                request.fromUserId,
            });

            upsertStoredFriend({
              userId:
                request.fromUserId,
              name:
                request.fromName,
            });

            friendRequests =
              friendRequests.filter(
                (item) =>
                  item.fromUserId
                    !== request.fromUserId,
              );

            renderFriendRequests();
            renderFriends();
            syncDirectoryFriends();

            setFeedback(
              '已添加好友',
              request.fromName,
              'success',
            );
          },
        );

        reject.addEventListener(
          'click',
          () => {
            sendDirectory({
              type: 'friend-reject',
              targetUserId:
                request.fromUserId,
            });

            friendRequests =
              friendRequests.filter(
                (item) =>
                  item.fromUserId
                    !== request.fromUserId,
              );

            renderFriendRequests();
          },
        );

        actions.append(
          accept,
          reject,
        );

        card.append(
          info,
          actions,
        );

        friendRequestsContainer
          .append(card);
      }
    };

  const inviteFriend = (
    friend: FriendSummary,
  ): void => {
    if (!friend.online) {
      setFeedback(
        '好友当前离线',
        `${friend.name} 上线后再邀请。`,
        'info',
      );
      return;
    }

    const key =
      updateRepositoryLabel();

    if (
      !isShareableRepository(
        key,
      )
    ) {
      setFeedback(
        '请先打开项目',
        '邀请好友前，请先打开 GitHub 仓库或 Android 本地项目。',
        'error',
      );
      return;
    }

    if (
      roomCode
        && repositoryKey === key
        && socket?.readyState
          === WebSocket.OPEN
    ) {
      sendDirectory({
        type: 'collab-invite',
        targetUserId:
          friend.userId,
        roomCode,
      });

      setFeedback(
        '邀请已发送',
        `正在等待 ${friend.name} 加入。`,
        'success',
      );
      return;
    }

    pendingInviteTarget =
      friend.userId;

    const generated =
      randomId(8);

    roomInput.value =
      generated;

    setFeedback(
      '正在建立协作',
      `准备邀请 ${friend.name}…`,
      'working',
    );

    connectRoom(
      generated,
      'create',
    );
  };

  const renderFriends = ():
    void => {
      friendsContainer
        .replaceChildren();

      const merged =
        storedFriends.map(
          (stored) => {
            const live =
              onlineFriends.get(
                stored.userId,
              );

            return {
              userId:
                stored.userId,
              name:
                live?.name
                  || stored.name,
              online:
                live?.online
                  ?? false,
            };
          },
        );

      const onlineCount =
        merged.filter(
          (friend) =>
            friend.online,
        ).length;

      friendOnlineCount.textContent =
        `${onlineCount} 在线`;

      if (merged.length === 0) {
        const empty =
          document.createElement(
            'p',
          );
        empty.className =
          'reader-collab-empty';
        empty.textContent =
          '还没有好友。输入用户名发送好友请求。';

        friendsContainer.append(
          empty,
        );
        return;
      }

      merged.sort(
        (a, b) =>
          Number(b.online)
            - Number(a.online)
          || a.name.localeCompare(
            b.name,
          ),
      );

      for (const friend of merged) {
        const card =
          document.createElement(
            'article',
          );
        card.className =
          'reader-friend-card';

        const info =
          document.createElement(
            'div',
          );

        const title =
          document.createElement(
            'strong',
          );

        const dot =
          document.createElement(
            'i',
          );
        dot.className =
          'reader-friend-presence';
        dot.dataset.online =
          String(friend.online);

        title.append(
          dot,
          document.createTextNode(
            friend.name,
          ),
        );

        const subtitle =
          document.createElement(
            'span',
          );
        subtitle.textContent =
          friend.online
            ? '在线'
            : '离线';

        info.append(
          title,
          subtitle,
        );

        const invite =
          document.createElement(
            'button',
          );
        invite.type = 'button';
        invite.textContent =
          roomCode
            ? '邀请加入'
            : '一起阅读';
        invite.disabled =
          !friend.online;

        invite.addEventListener(
          'click',
          () => {
            inviteFriend(friend);
          },
        );

        card.append(
          info,
          invite,
        );

        friendsContainer.append(
          card,
        );
      }
    };

  const sendDirectory = (
    message: object,
  ): void => {
    if (!accountUserId) {
      setFeedback(
        '请先登录账号',
        '登录后才能添加好友和发送协作邀请。',
        'error',
      );
      return;
    }

    if (
      directorySocket
        ?.readyState
        !== WebSocket.OPEN
        || !directoryProtocolReady
    ) {
      setFeedback(
        '好友服务未就绪',
        directorySocket
          ?.readyState
          === WebSocket.OPEN
          ? '正在验证协作协议版本，请稍后再试。'
          : '正在重新连接，请稍后再试。',
        'error',
      );
      return;
    }

    directorySocket.send(
      JSON.stringify(message),
    );
  };

  const syncDirectoryFriends =
    (): void => {
      if (
        directorySocket
          ?.readyState
          !== WebSocket.OPEN
          || !directoryProtocolReady
      ) {
        return;
      }

      directorySocket.send(
        JSON.stringify({
          type: 'friend-sync',
          friendIds:
            storedFriends.map(
              (friend) =>
                friend.userId,
            ),
        }),
      );
  };

  let pendingAccountAction:
    {
      type:
        | 'account-login'
        | 'account-register';
      name: string;
      password: string;
    } | null = null;

  const sendAccountCredentials = (
    type:
      | 'account-login'
      | 'account-register',
  ): void => {
    const name =
      nameInput.value.trim();
    const password =
      passwordInput.value;

    if (name.length < 2) {
      setFeedback(
        '用户名太短',
        '用户名至少需要 2 个字符。',
        'error',
      );
      nameInput.focus();
      return;
    }

    if (password.length < 8) {
      setFeedback(
        '密码太短',
        '密码至少需要 8 个字符。',
        'error',
      );
      passwordInput.focus();
      return;
    }

    pendingAccountAction = {
      type,
      name,
      password,
    };

    const ready =
      directorySocket
        ?.readyState
        === WebSocket.OPEN
        && directoryProtocolReady;

    if (!ready) {
      setFeedback(
        '正在连接账号服务',
        '连接完成后会自动继续。',
        'working',
      );
      connectDirectory();
      return;
    }

    directorySocket!.send(
      JSON.stringify({
        ...pendingAccountAction,
        legacyUserId:
          userId,
      }),
    );
    pendingAccountAction = null;
  };

  const connectDirectory = ():
    void => {
      const server =
        currentServer();

      if (!server) {
        return;
      }

      const generation =
        ++directoryGeneration;

      if (
        directoryReconnectTimer
      ) {
        window.clearTimeout(
          directoryReconnectTimer,
        );
        directoryReconnectTimer =
          0;
      }

      directorySocket?.close();
      directorySocket = null;
      directoryProtocolReady =
        false;

      directoryStatus.textContent =
        '正在连接好友服务…';

      let nextSocket: WebSocket;

      try {
        nextSocket =
          new WebSocket(server);
      } catch (error) {
        directoryStatus.textContent =
          '好友服务连接失败';

        setFeedback(
          '好友服务连接失败',
          error instanceof Error
            ? error.message
            : String(error),
          'error',
        );
        return;
      }

      directorySocket =
        nextSocket;

      let protocolFailed =
        false;
      let directoryHandshakeTimeout =
        0;

      const failDirectoryProtocol = (
        message: string,
      ): void => {
        if (
          generation
            !== directoryGeneration
        ) {
          return;
        }

        protocolFailed =
          true;
        directoryProtocolReady =
          false;

        if (
          directoryHandshakeTimeout
        ) {
          window.clearTimeout(
            directoryHandshakeTimeout,
          );
          directoryHandshakeTimeout =
            0;
        }

        directoryStatus.textContent =
          '协议不兼容';

        setFeedback(
          '协作服务器版本不兼容',
          message,
          'error',
        );

        nextSocket.close();
      };

      nextSocket.addEventListener(
        'open',
        () => {
          if (
            generation
              !== directoryGeneration
          ) {
            return;
          }

          directoryStatus.textContent =
            '正在验证协作协议…';

          nextSocket.send(
            JSON.stringify({
              type: 'hello',
              protocolVersion:
                COLLAB_PROTOCOL_VERSION,
              capabilities: [
                ...COLLAB_CAPABILITIES,
              ],
            }),
          );

          directoryHandshakeTimeout =
            window.setTimeout(
              () => {
                failDirectoryProtocol(
                  `客户端协议 v${COLLAB_PROTOCOL_VERSION} 没有收到服务器握手响应。服务器可能仍是旧版本，请更新或重启 reader:server。`,
                );
              },
              PROTOCOL_HANDSHAKE_TIMEOUT_MS,
            );
        },
      );

      nextSocket.addEventListener(
        'message',
        (event) => {
          if (
            generation
              !== directoryGeneration
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
              === 'hello-ack'
          ) {
            if (
              directoryHandshakeTimeout
            ) {
              window.clearTimeout(
                directoryHandshakeTimeout,
              );
              directoryHandshakeTimeout =
                0;
            }

            if (
              message.protocolVersion
                !== COLLAB_PROTOCOL_VERSION
            ) {
              failDirectoryProtocol(
                `客户端协议 v${COLLAB_PROTOCOL_VERSION}，服务器协议 v${message.protocolVersion}。请更新客户端或服务器后重试。`,
              );
              return;
            }

            directoryProtocolReady =
              true;

            if (pendingAccountAction) {
              nextSocket.send(
                JSON.stringify({
                  ...pendingAccountAction,
                  legacyUserId:
                    userId,
                }),
              );
              pendingAccountAction = null;
              directoryStatus.textContent =
                '正在登录账号…';
              return;
            }

            if (sessionToken) {
              nextSocket.send(
                JSON.stringify({
                  type:
                    'account-session',
                  sessionToken,
                }),
              );
              directoryStatus.textContent =
                '正在恢复账号…';
              return;
            }

            directoryStatus.textContent =
              `好友服务已连接 · 协议 v${message.protocolVersion} · 请登录`;
            return;
          }

          if (
            message.type
              === 'protocol-error'
          ) {
            failDirectoryProtocol(
              message.message
                || `客户端协议 v${COLLAB_PROTOCOL_VERSION} 与服务器协议 v${message.serverProtocolVersion} 不兼容。`,
            );
            return;
          }

          if (!directoryProtocolReady) {
            return;
          }

          if (
            message.type
              === 'auth-ok'
          ) {
            accountUserId =
              message.userId;
            accountName =
              message.name;

            if (message.sessionToken) {
              sessionToken =
                message.sessionToken;
              localStorage.setItem(
                SESSION_STORAGE_KEY,
                sessionToken,
              );
            }

            nameInput.value =
              message.name;
            nameInput.disabled =
              true;
            passwordInput.value = '';
            passwordInput.disabled =
              true;
            loginButton.hidden = true;
            registerButton.hidden = true;
            logoutButton.hidden = false;

            localStorage.setItem(
              NAME_STORAGE_KEY,
              message.name,
            );

            storedFriends = [];
            saveFriends(storedFriends);
            onlineFriends = new Map();
            friendRequests = [];
            renderFriends();
            renderFriendRequests();

            directoryStatus.textContent =
              `已登录 ${message.name} · 协议 v${COLLAB_PROTOCOL_VERSION}`;

            setFeedback(
              '账号已登录',
              `${message.name} · 好友资料将从服务器同步。`,
              'success',
            );
            return;
          }

          if (
            message.type
              === 'directory-state'
          ) {
            onlineFriends =
              new Map(
                message.friends.map(
                  (friend) => [
                    friend.userId,
                    friend,
                  ],
                ),
              );

            for (
              const friend
                of message.friends
            ) {
              if (
                friend.userId
                  && friend.name
              ) {
                upsertStoredFriend({
                  userId:
                    friend.userId,
                  name:
                    friend.name,
                });
              }
            }

            renderFriends();
            return;
          }

          if (
            message.type
              === 'friend-request'
          ) {
            const alreadyFriend =
              storedFriends.some(
                (friend) =>
                  friend.userId
                    === message.fromUserId,
              );

            if (alreadyFriend) {
              sendDirectory({
                type:
                  'friend-accept',
                targetUserId:
                  message.fromUserId,
              });
              return;
            }

            const exists =
              friendRequests.some(
                (request) =>
                  request.fromUserId
                    === message.fromUserId,
              );

            if (!exists) {
              friendRequests.push(
                message,
              );
            }

            renderFriendRequests();

            setFeedback(
              '收到好友请求',
              `${message.fromName} 想添加你为好友。`,
              'info',
            );
            return;
          }

          if (
            message.type
              === 'friend-added'
          ) {
            upsertStoredFriend({
              userId:
                message.userId,
              name:
                message.name,
            });

            friendRequests =
              friendRequests.filter(
                (request) =>
                  request.fromUserId
                    !== message.userId,
              );

            onlineFriends.set(
              message.userId,
              {
                userId:
                  message.userId,
                name:
                  message.name,
                online:
                  message.online,
              },
            );

            renderFriendRequests();
            renderFriends();
            syncDirectoryFriends();

            setFeedback(
              '好友已添加',
              `${message.name} 已在好友列表中。`,
              'success',
            );
            return;
          }

          if (
            message.type
              === 'friend-request-sent'
          ) {
            setFeedback(
              '好友请求已发送',
              message.queued
                ? `${message.targetName} 当前不在线，请求已经保存，对方下次上线仍会收到。`
                : `等待 ${message.targetName} 接受。`,
              'success',
            );
            return;
          }

          if (
            message.type
              === 'collab-invite'
          ) {
            pendingInvite =
              message;

            inviteTitle.textContent =
              `${message.fromName} 邀请你一起阅读`;

            inviteProject.textContent =
              message.repositoryKey;

            inviteNotice.hidden =
              false;
            return;
          }

          if (
            message.type
              === 'collab-invite-sent'
          ) {
            return;
          }

          if (
            message.type
              === 'error'
          ) {
            if (
              message.code
                === 'invalid_session'
                || message.code
                  === 'signed_in_elsewhere'
            ) {
              sessionToken = '';
              accountUserId = '';
              accountName = '';
              localStorage.removeItem(
                SESSION_STORAGE_KEY,
              );
              nameInput.disabled = false;
              passwordInput.disabled = false;
              loginButton.hidden = false;
              registerButton.hidden = false;
              logoutButton.hidden = true;
              storedFriends = [];
              saveFriends(storedFriends);
              onlineFriends = new Map();
              friendRequests = [];
              renderFriends();
              renderFriendRequests();
              directoryStatus.textContent =
                '请重新登录账号';
            }

            setFeedback(
              '好友服务提示',
              message.message,
              'error',
            );
          }
        },
      );

      nextSocket.addEventListener(
        'close',
        () => {
          if (
            generation
              !== directoryGeneration
          ) {
            return;
          }

          if (
            directoryHandshakeTimeout
          ) {
            window.clearTimeout(
              directoryHandshakeTimeout,
            );
            directoryHandshakeTimeout =
              0;
          }

          directorySocket = null;
          directoryProtocolReady =
            false;

          onlineFriends =
            new Map();
          renderFriends();

          if (protocolFailed) {
            directoryStatus.textContent =
              '协议不兼容';
            return;
          }

          directoryStatus.textContent =
            '好友服务已断开，正在重连…';

          directoryReconnectTimer =
            window.setTimeout(
              () => {
                connectDirectory();
              },
              1500,
            );
        },
      );

      nextSocket.addEventListener(
        'error',
        () => {
          if (
            generation
              === directoryGeneration
              && !protocolFailed
          ) {
            directoryStatus.textContent =
              '好友服务连接失败';
          }
        },
      );
    };

  const setConnectedUi = (
    connected: boolean,
  ): void => {
    activeSection.hidden =
      !connected;

    currentCode.textContent =
      connected
        ? (
          repositoryKey
            || '已连接'
        )
        : '未连接';

    button.textContent =
      connected
        ? '👥 协作中'
        : '👥 协作';

    renderFriends();
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
    void (async () => {
      if (
        repositoryKey
          && currentRepositoryKey()
            !== repositoryKey
      ) {
        if (
          repositoryKey.startsWith(
            'github://',
          )
        ) {
          setFeedback(
            '正在切换到好友项目',
            repositoryKey,
            'working',
          );

          repositorySync ??=
            openRoomGitHubRepository(
              repositoryKey,
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
              '无法切换到好友项目',
              error instanceof Error
                ? error.message
                : String(error),
              'error',
            );
            return;
          }

          if (
            currentRepositoryKey()
              !== repositoryKey
          ) {
            setFeedback(
              '项目切换没有生效',
              `当前仍是 ${currentRepositoryKey() || '未知项目'}。`,
              'error',
            );
            return;
          }
        } else if (
          repositoryKey.startsWith(
            'local://',
          )
        ) {
          if (!roomProjectSnapshot) {
            setFeedback(
              '好友项目还没有准备好',
              '没有收到本地项目文件树，请重新加入协作。',
              'error',
            );
            return;
          }

          repositorySync ??=
            activateRemoteLocalProject(
              repositoryKey,
              roomProjectSnapshot,
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
              '好友项目打开失败',
              error instanceof Error
                ? error.message
                : String(error),
              'error',
            );
            return;
          }
        } else {
          setFeedback(
            '无法识别协作项目',
            repositoryKey,
            'error',
          );
          return;
        }
      }

      window.dispatchEvent(
        new CustomEvent(
          'ai-ide-reader-jump-request',
          {
            detail: {
              filePath:
                peer.filePath,
              line:
                peer.selection
                  ?.startLine
                  ?? peer.focus
                    ?.line
                  ?? peer.centerLine,
            },
          },
        ),
      );

      notice.hidden = true;
    })();
  };

  const renderPeers = (): void => {
    peersContainer.replaceChildren();

    const others =
      peers.filter(
        (peer) =>
          peer.peerId !== userId,
      );

    if (others.length === 0) {
      const empty =
        document.createElement('p');
      empty.className =
        'reader-collab-empty';
      empty.textContent =
        '等待好友加入…';
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
            peer.peerId !== userId
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

  const sendRoom = (
    message: object,
  ): void => {
    if (
      socket?.readyState
        !== WebSocket.OPEN
        || !roomProtocolReady
    ) {
      return;
    }

    socket.send(
      JSON.stringify(message),
    );
  };

  const requestRemoteProjectFile =
    (
      path: string,
    ): Promise<{
      path: string;
      content: string;
    }> => {
      if (
        socket?.readyState
          !== WebSocket.OPEN
          || !roomProtocolReady
          || !roomCode
      ) {
        return Promise.reject(
          new Error(
            '好友协作连接已经断开。',
          ),
        );
      }

      const requestId =
        `${userId}-${Date.now()}-${++remoteFileSequence}`;

      return new Promise(
        (resolve, reject) => {
          const timeout =
            window.setTimeout(
              () => {
                pendingRemoteFileReads
                  .delete(requestId);

                reject(
                  new Error(
                    `读取好友文件超时：${path}`,
                  ),
                );
              },
              12_000,
            );

          pendingRemoteFileReads.set(
            requestId,
            {
              resolve,
              reject,
              timeout,
            },
          );

          sendRoom({
            type:
              'file-request',
            roomCode,
            peerId: userId,
            requestId,
            path,
          });
        },
      );
    };

  const resolveRemoteFileResponse =
    (
      message:
        FileResponseMessage,
    ): void => {
      const pending =
        pendingRemoteFileReads.get(
          message.requestId,
        );

      if (!pending) {
        return;
      }

      pendingRemoteFileReads.delete(
        message.requestId,
      );

      window.clearTimeout(
        pending.timeout,
      );

      if (message.error) {
        pending.reject(
          new Error(
            message.error,
          ),
        );
        return;
      }

      if (
        typeof message.content
          !== 'string'
      ) {
        pending.reject(
          new Error(
            '好友返回的文件内容无效。',
          ),
        );
        return;
      }

      pending.resolve({
        path:
          message.path,
        content:
          message.content,
      });
    };

  const serveRemoteFileRequest =
    async (
      message:
        FileRequestMessage,
    ): Promise<void> => {
      if (
        !roomCode
          || !repositoryKey
            .startsWith(
              'local://',
            )
          || remoteLocalProjectActive
      ) {
        return;
      }

      try {
        const result =
          await window.tutorIde
            .readProjectFile(
              message.path,
            );

        sendRoom({
          type:
            'file-response',
          roomCode,
          requestId:
            message.requestId,
          targetPeerId:
            message.requesterPeerId,
          path:
            result.path,
          content:
            result.content,
        });
      } catch (error) {
        sendRoom({
          type:
            'file-response',
          roomCode,
          requestId:
            message.requestId,
          targetPeerId:
            message.requesterPeerId,
          path:
            message.path,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }
    };

  const activateRemoteLocalProject =
    async (
      expectedKey: string,
      snapshot:
        CollabProjectSnapshot,
    ): Promise<void> => {
      roomProjectSnapshot =
        snapshot;

      setCollabRemoteProject(
        {
          rootPath:
            expectedKey,
          projectName:
            snapshot.projectName,
          files:
            snapshot.files,
          directories:
            snapshot.directories,
        },
        requestRemoteProjectFile,
      );

      remoteLocalProjectActive =
        true;

      window.dispatchEvent(
        new CustomEvent(
          'android-project-snapshot',
          {
            detail: {
              rootPath:
                expectedKey,
              projectName:
                snapshot.projectName,
              files:
                snapshot.files,
              directories:
                snapshot.directories,
              preferredFile:
                snapshot.preferredFile,
              message:
                `✓ 好友本地项目 · ${snapshot.projectName} · 远程只读`,
            },
          },
        ),
      );

      await new Promise<void>(
        (resolve) => {
          window.requestAnimationFrame(
            () => {
              window.requestAnimationFrame(
                () => resolve(),
              );
            },
          );
        },
      );

      if (
        currentRepositoryKey()
          !== expectedKey
      ) {
        throw new Error(
          `好友项目切换失败：${expectedKey}`,
        );
      }
    };

  const sendViewport =
    (): void => {
      if (
        !localViewport
          || !roomCode
      ) {
        return;
      }

      sendRoom({
        type: 'viewport',
        roomCode,
        peerId: userId,
        viewport:
          localViewport,
      });
    };

  const clearRemoteReaderState =
    (): void => {
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
    };

  const closeRoom = (): void => {
    intentionallyClosedRoom =
      true;

    if (connectTimeout) {
      window.clearTimeout(
        connectTimeout,
      );
      connectTimeout = 0;
    }

    if (protocolHandshakeTimeout) {
      window.clearTimeout(
        protocolHandshakeTimeout,
      );
      protocolHandshakeTimeout = 0;
    }

    roomProtocolReady =
      false;

    socket?.close();
    socket = null;

    roomCode = '';
    repositoryKey = '';
    pendingInviteTarget = '';
    peers = [];
    pendingNoticePeer =
      null;
    notice.hidden = true;
    roomProjectSnapshot =
      null;

    if (remoteLocalProjectActive) {
      clearCollabRemoteProject();
      remoteLocalProjectActive =
        false;
    }

    for (
      const pending
        of pendingRemoteFileReads
          .values()
    ) {
      window.clearTimeout(
        pending.timeout,
      );

      pending.reject(
        new Error(
          '好友协作已经结束。',
        ),
      );
    }

    pendingRemoteFileReads.clear();

    clearRemoteReaderState();
    setConnectedUi(false);
    renderPeers();
  };

  const handleRoomState =
    async (
      message: RoomStateMessage,
    ): Promise<void> => {
      const roomRepositoryKey =
        message.repositoryKey;

      repositoryKey =
        roomRepositoryKey;

      if (message.projectSnapshot) {
        roomProjectSnapshot =
          message.projectSnapshot;
      }

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
            '正在打开好友的项目',
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
              '已经加入协作，但项目自动打开失败',
              error instanceof Error
                ? error.message
                : String(error),
              'error',
            );
            return;
          }

          if (
            currentRepositoryKey()
              !== roomRepositoryKey
          ) {
            setFeedback(
              '协作项目没有切换成功',
              `需要 ${roomRepositoryKey}，当前仍是 ${currentRepositoryKey() || '未知项目'}。`,
              'error',
            );
            return;
          }
        } else if (
          roomRepositoryKey.startsWith(
            'local://',
          )
        ) {
          const snapshot =
            message.projectSnapshot
              ?? roomProjectSnapshot;

          if (!snapshot) {
            setFeedback(
              '好友项目文件树缺失',
              '协作服务器没有收到创建者的本地项目清单，请让对方重新发起邀请。',
              'error',
            );
            return;
          }

          roomProjectSnapshot =
            snapshot;

          if (
            !localWorkspacesCompatible(
              currentRepositoryKey(),
              roomRepositoryKey,
            )
          ) {
            setFeedback(
              '正在打开好友本地项目',
              `${snapshot.projectName} · 无需你本机拥有这份项目。`,
              'working',
            );

            repositorySync ??=
              activateRemoteLocalProject(
                roomRepositoryKey,
                snapshot,
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
                '好友本地项目打开失败',
                error instanceof Error
                  ? error.message
                  : String(error),
                'error',
              );
              return;
            }
          }
        }
      }

      peers =
        message.peers;

      setConnectedUi(true);

      setFeedback(
        '✓ 已进入好友协作',
        `在线 ${message.peers.length} 人 · 项目已同步`,
        'success',
      );

      const remoteSelections:
        ReaderRemoteSelectionDetail[] =
          message.peers
            .filter(
              (peer) =>
                peer.peerId !== userId
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
                peer.peerId !== userId
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

      if (pendingInviteTarget) {
        const targetUserId =
          pendingInviteTarget;

        pendingInviteTarget = '';

        sendDirectory({
          type: 'collab-invite',
          targetUserId,
          roomCode:
            message.roomCode,
        });

        const friend =
          storedFriends.find(
            (item) =>
              item.userId
                === targetUserId,
          );

        setFeedback(
          '邀请已发送',
          `正在等待 ${friend?.name ?? '好友'} 加入。`,
          'success',
        );
      }
    };

  const connectRoom = (
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
      pendingInviteTarget = '';

      setFeedback(
        '当前项目不能开始协作',
        '请先打开 GitHub 仓库或等待 Android 本地项目文件树完成索引。',
        'error',
      );
      return;
    }

    const server =
      currentServer();

    if (!server) {
      pendingInviteTarget = '';
      return;
    }

    const normalized =
      normalizeRoomCode(
        nextRoomCode,
      );

    if (normalized.length < 4) {
      pendingInviteTarget = '';

      setFeedback(
        '房间信息无效',
        '兼容房间码至少需要 4 位。',
        'error',
      );
      return;
    }

    intentionallyClosedRoom =
      true;
    socket?.close();
    socket = null;
    intentionallyClosedRoom =
      false;
    roomProtocolReady =
      false;

    if (protocolHandshakeTimeout) {
      window.clearTimeout(
        protocolHandshakeTimeout,
      );
      protocolHandshakeTimeout = 0;
    }

    roomCode =
      normalized;
    repositoryKey =
      source === 'create'
        ? key
        : '';

    let nextSocket: WebSocket;

    try {
      nextSocket =
        new WebSocket(server);
    } catch (error) {
      pendingInviteTarget = '';

      setFeedback(
        '协作连接失败',
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
          pendingInviteTarget = '';

          setFeedback(
            '协作连接超时',
            `5 秒内没有连接到 ${server}。请确认 reader:server 正在运行。`,
            'error',
          );
        },
        5000,
      );

    let protocolFailed =
      false;

    const failRoomProtocol = (
      message: string,
    ): void => {
      if (
        socket !== nextSocket
      ) {
        return;
      }

      protocolFailed =
        true;
      roomProtocolReady =
        false;
      pendingInviteTarget = '';

      if (protocolHandshakeTimeout) {
        window.clearTimeout(
          protocolHandshakeTimeout,
        );
        protocolHandshakeTimeout = 0;
      }

      setFeedback(
        '协作服务器版本不兼容',
        message,
        'error',
      );

      nextSocket.close();
    };

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

        setFeedback(
          '正在验证协作服务器',
          `检查协议 v${COLLAB_PROTOCOL_VERSION}…`,
          'working',
        );

        nextSocket.send(
          JSON.stringify({
            type: 'hello',
            protocolVersion:
              COLLAB_PROTOCOL_VERSION,
            capabilities: [
              ...COLLAB_CAPABILITIES,
            ],
          }),
        );

        protocolHandshakeTimeout =
          window.setTimeout(
            () => {
              failRoomProtocol(
                `客户端协议 v${COLLAB_PROTOCOL_VERSION} 没有收到服务器握手响应。服务器可能仍是旧版本，请更新或重启 reader:server。`,
              );
            },
            PROTOCOL_HANDSHAKE_TIMEOUT_MS,
          );
      },
    );

    nextSocket.addEventListener(
      'message',
      (event) => {
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
            === 'hello-ack'
        ) {
          if (protocolHandshakeTimeout) {
            window.clearTimeout(
              protocolHandshakeTimeout,
            );
            protocolHandshakeTimeout = 0;
          }

          if (
            message.protocolVersion
              !== COLLAB_PROTOCOL_VERSION
          ) {
            failRoomProtocol(
              `客户端协议 v${COLLAB_PROTOCOL_VERSION}，服务器协议 v${message.protocolVersion}。请更新客户端或服务器后重试。`,
            );
            return;
          }

          roomProtocolReady =
            true;

          sendRoom({
            type: 'join',
            roomCode,
            peerId: userId,
            name:
              currentName(),
            repositoryKey,
            mode: source,
            projectSnapshot:
              source === 'create'
                && repositoryKey
                  .startsWith(
                    'local://',
                  )
                ? currentLocalProjectSnapshot()
                : null,
          });

          setFeedback(
            '正在进入协作',
            source === 'create'
              ? `协议 v${message.protocolVersion} 已确认 · 正在建立协作空间…`
              : `协议 v${message.protocolVersion} 已确认 · 正在跟随好友项目…`,
            'working',
          );

          sendViewport();
          return;
        }

        if (
          message.type
            === 'protocol-error'
        ) {
          failRoomProtocol(
            message.message
              || `客户端协议 v${COLLAB_PROTOCOL_VERSION} 与服务器协议 v${message.serverProtocolVersion} 不兼容。`,
          );
          return;
        }

        if (!roomProtocolReady) {
          return;
        }

        if (
          message.type
            === 'error'
        ) {
          pendingInviteTarget = '';

          setFeedback(
            '协作服务器拒绝连接',
            message.message,
            'error',
          );
          return;
        }

        if (
          message.type
            === 'file-request'
        ) {
          void serveRemoteFileRequest(
            message,
          );
          return;
        }

        if (
          message.type
            === 'file-response'
        ) {
          resolveRemoteFileResponse(
            message,
          );
          return;
        }

        if (
          message.type
            === 'room-state'
        ) {
          void handleRoomState(
            message,
          );
        }
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
        roomProtocolReady =
          false;

        if (connectTimeout) {
          window.clearTimeout(
            connectTimeout,
          );
          connectTimeout = 0;
        }

        if (protocolHandshakeTimeout) {
          window.clearTimeout(
            protocolHandshakeTimeout,
          );
          protocolHandshakeTimeout = 0;
        }

        if (
          intentionallyClosedRoom
        ) {
          return;
        }

        roomCode = '';
        repositoryKey = '';
        peers = [];
        clearRemoteReaderState();
        setConnectedUi(false);

        if (protocolFailed) {
          return;
        }

        setFeedback(
          '协作连接已断开',
          '好友服务仍在线；可以重新点击好友发起协作。',
          'error',
        );
      },
    );

    nextSocket.addEventListener(
      'error',
      () => {
        if (
          socket === nextSocket
            && !protocolFailed
        ) {
          setFeedback(
            '协作 WebSocket 失败',
            `无法连接 ${server}。`,
            'error',
          );
        }
      },
    );
  };

  button.addEventListener(
    'click',
    () => {
      updateRepositoryLabel();
      modal.hidden = false;
      renderFriends();
      renderFriendRequests();

      if (
        directorySocket
          ?.readyState
          !== WebSocket.OPEN
          || !directoryProtocolReady
      ) {
        connectDirectory();
      }
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

  loginButton.addEventListener(
    'click',
    () => {
      sendAccountCredentials(
        'account-login',
      );
    },
  );

  registerButton.addEventListener(
    'click',
    () => {
      sendAccountCredentials(
        'account-register',
      );
    },
  );

  passwordInput.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        loginButton.click();
      }
    },
  );

  logoutButton.addEventListener(
    'click',
    () => {
      if (
        directorySocket
          ?.readyState
          === WebSocket.OPEN
          && directoryProtocolReady
          && accountUserId
      ) {
        directorySocket!.send(
          JSON.stringify({
            type:
              'account-logout',
          }),
        );
      }

      sessionToken = '';
      accountUserId = '';
      accountName = '';
      localStorage.removeItem(
        SESSION_STORAGE_KEY,
      );
      nameInput.disabled = false;
      passwordInput.disabled = false;
      loginButton.hidden = false;
      registerButton.hidden = false;
      logoutButton.hidden = true;
      storedFriends = [];
      saveFriends(storedFriends);
      onlineFriends = new Map();
      friendRequests = [];
      renderFriends();
      renderFriendRequests();
      directoryStatus.textContent =
        `好友服务已连接 · 协议 v${COLLAB_PROTOCOL_VERSION} · 请登录`;
      setFeedback(
        '已退出账号',
        '可以在这台设备登录其他账号。',
        'info',
      );
    },
  );

  addFriendButton.addEventListener(
    'click',
    () => {
      const targetName =
        friendNameInput.value
          .trim();

      if (!targetName) {
        setFeedback(
          '请输入用户名',
          '输入对方的协作用户名后再发送好友请求。',
          'error',
        );
        friendNameInput.focus();
        return;
      }

      if (
        targetName.toLocaleLowerCase()
          === currentName()
            .toLocaleLowerCase()
      ) {
        setFeedback(
          '不能添加自己',
          '请输入另一位用户的用户名。',
          'error',
        );
        return;
      }

      sendDirectory({
        type: 'friend-request',
        targetName,
      });

      friendNameInput.value = '';
    },
  );

  friendNameInput.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addFriendButton.click();
      }
    },
  );

  serverInput.addEventListener(
    'change',
    () => {
      currentServer();
      connectDirectory();
    },
  );

  createButton.addEventListener(
    'click',
    () => {
      const generated =
        randomId(8);

      roomInput.value =
        generated;

      connectRoom(
        generated,
        'create',
      );
    },
  );

  joinButton.addEventListener(
    'click',
    () => {
      connectRoom(
        roomInput.value,
        'join',
      );
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

  leaveButton.addEventListener(
    'click',
    () => {
      closeRoom();

      setFeedback(
        '已离开协作',
        '好友仍保持在线连接。',
        'info',
      );
    },
  );

  inviteAccept.addEventListener(
    'click',
    () => {
      void (async () => {
        const invite =
          pendingInvite;

        pendingInvite = null;
        inviteNotice.hidden = true;

        if (!invite) {
          return;
        }

        roomInput.value =
          invite.roomCode;

        setFeedback(
          '正在加入好友',
          `正在跟随 ${invite.fromName} 的项目…`,
          'working',
        );

        if (
          roomCode
        ) {
          closeRoom();
        }

        if (
          currentRepositoryKey()
            !== invite.repositoryKey
        ) {
          if (
            invite.repositoryKey
              .startsWith(
                'github://',
              )
          ) {
            repositorySync ??=
              openRoomGitHubRepository(
                invite.repositoryKey,
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
                '好友项目打开失败',
                error instanceof Error
                  ? error.message
                  : String(error),
                'error',
              );
              modal.hidden = false;
              return;
            }

            if (
              currentRepositoryKey()
                !== invite.repositoryKey
            ) {
              setFeedback(
                '好友项目没有切换成功',
                `需要 ${invite.repositoryKey}，当前仍是 ${currentRepositoryKey() || '未知项目'}。`,
                'error',
              );
              modal.hidden = false;
              return;
            }
          } else if (
            invite.repositoryKey
              .startsWith(
                'local://',
              )
          ) {
            setFeedback(
              '正在连接好友本地项目',
              '无需在本机准备同一份项目，正在获取文件树…',
              'working',
            );
          } else {
            setFeedback(
              '无法识别好友项目',
              invite.repositoryKey,
              'error',
            );
            modal.hidden = false;
            return;
          }
        }

        modal.hidden = true;

        connectRoom(
          invite.roomCode,
          'join',
        );
      })();
    },
  );

  inviteReject.addEventListener(
    'click',
    () => {
      pendingInvite = null;
      inviteNotice.hidden = true;
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

    sendRoom({
      type: 'focus',
      roomCode,
      peerId: userId,
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

    sendRoom({
      type: 'selection',
      roomCode,
      peerId: userId,
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
        && !repositorySync
        && previousKey
        && previousKey !== nextKey
    ) {
      closeRoom();

      setFeedback(
        '项目已经切换',
        '已自动离开原协作。',
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
                && !repositorySync
                && next
                && next
                  !== repositoryKey
            ) {
              closeRoom();

              setFeedback(
                '项目已经切换',
                '已自动离开原协作。',
                'info',
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
  renderFriends();
  renderFriendRequests();
  connectDirectory();

  return () => {
    closeRoom();

    ++directoryGeneration;

    if (
      directoryReconnectTimer
    ) {
      window.clearTimeout(
        directoryReconnectTimer,
      );
    }

    directoryProtocolReady =
      false;
    directorySocket?.close();
    directorySocket = null;

    roomProtocolReady =
      false;

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
    inviteNotice.remove();
    modal.remove();
  };
}
