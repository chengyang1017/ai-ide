import pg from 'pg';
import {
  WebSocket,
  WebSocketServer,
} from 'ws';

const {
  Pool,
} = pg;

const port =
  Number.parseInt(
    process.env.PORT ?? '8787',
    10,
  );

const host =
  process.env.HOST
    ?? '0.0.0.0';

const PROTOCOL_VERSION =
  24;

const PROTOCOL_CAPABILITIES = [
  'friend-directory',
  'friend-invite',
  'room',
  'local-project-stream',
  'remote-file-read',
  'reader-viewport',
  'reader-focus',
  'reader-selection',
];

const databaseUrl =
  process.env.DATABASE_URL
    ?.trim()
    ?? '';

const database =
  databaseUrl
    ? new Pool({
        connectionString:
          databaseUrl,
        max: 5,
        idleTimeoutMillis:
          30_000,
      })
    : null;

const rooms =
  new Map();

const knownUsers =
  new Map();

const userIdByName =
  new Map();

const onlineDirectorySockets =
  new Map();

const friendships =
  new Map();

const pendingFriendRequests =
  new Map();

function friendshipPair(
  firstUserId,
  secondUserId,
) {
  return [
    firstUserId,
    secondUserId,
  ].sort();
}

function rememberPendingRequest(
  targetNameKey,
  request,
) {
  const queued =
    pendingFriendRequests
      .get(targetNameKey)
      ?? [];

  const filtered =
    queued.filter(
      (item) =>
        item.fromUserId
          !== request.fromUserId,
    );

  filtered.push(request);

  pendingFriendRequests.set(
    targetNameKey,
    filtered,
  );
}

function forgetPendingRequest(
  targetNameKey,
  fromUserId,
) {
  const queued =
    pendingFriendRequests
      .get(targetNameKey)
      ?? [];

  const next =
    queued.filter(
      (item) =>
        item.fromUserId
          !== fromUserId,
    );

  if (next.length === 0) {
    pendingFriendRequests.delete(
      targetNameKey,
    );
    return;
  }

  pendingFriendRequests.set(
    targetNameKey,
    next,
  );
}

async function initializePersistence() {
  if (!database) {
    console.warn(
      '[persistence] DATABASE_URL is not set; friend data uses memory only.',
    );
    return;
  }

  await database.query(`
    CREATE TABLE IF NOT EXISTS collab_users (
      user_id TEXT PRIMARY KEY,
      name VARCHAR(32) NOT NULL,
      name_key VARCHAR(32) NOT NULL UNIQUE,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS collab_friendships (
      user_id_a TEXT NOT NULL
        REFERENCES collab_users(user_id)
        ON DELETE CASCADE,
      user_id_b TEXT NOT NULL
        REFERENCES collab_users(user_id)
        ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id_a, user_id_b),
      CHECK (user_id_a < user_id_b)
    )
  `);

  await database.query(`
    CREATE TABLE IF NOT EXISTS collab_friend_requests (
      from_user_id TEXT NOT NULL
        REFERENCES collab_users(user_id)
        ON DELETE CASCADE,
      target_name_key VARCHAR(32) NOT NULL,
      from_name VARCHAR(32) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (from_user_id, target_name_key)
    )
  `);

  const usersResult =
    await database.query(`
      SELECT
        user_id,
        name,
        name_key,
        EXTRACT(
          EPOCH FROM last_seen
        ) * 1000 AS last_seen_ms
      FROM collab_users
    `);

  for (const row of usersResult.rows) {
    const userId =
      sanitizeId(
        row.user_id,
      );

    const name =
      safeText(
        row.name,
        32,
      );

    const nameKey =
      normalizeName(
        row.name_key,
      );

    if (
      !userId
        || !name
        || !nameKey
    ) {
      continue;
    }

    knownUsers.set(
      userId,
      {
        userId,
        name,
        nameKey,
        lastSeen:
          Number(
            row.last_seen_ms,
          ) || Date.now(),
      },
    );

    userIdByName.set(
      nameKey,
      userId,
    );
  }

  const friendshipsResult =
    await database.query(`
      SELECT
        user_id_a,
        user_id_b
      FROM collab_friendships
    `);

  for (
    const row
      of friendshipsResult.rows
  ) {
    const firstUserId =
      sanitizeId(
        row.user_id_a,
      );

    const secondUserId =
      sanitizeId(
        row.user_id_b,
      );

    if (
      !firstUserId
        || !secondUserId
    ) {
      continue;
    }

    ensureFriendSet(
      firstUserId,
    ).add(
      secondUserId,
    );

    ensureFriendSet(
      secondUserId,
    ).add(
      firstUserId,
    );
  }

  const requestsResult =
    await database.query(`
      SELECT
        from_user_id,
        target_name_key,
        from_name
      FROM collab_friend_requests
      ORDER BY created_at ASC
    `);

  for (
    const row
      of requestsResult.rows
  ) {
    const fromUserId =
      sanitizeId(
        row.from_user_id,
      );

    const targetNameKey =
      normalizeName(
        row.target_name_key,
      );

    const fromName =
      safeText(
        row.from_name,
        32,
      );

    if (
      !fromUserId
        || !targetNameKey
        || !fromName
    ) {
      continue;
    }

    rememberPendingRequest(
      targetNameKey,
      {
        fromUserId,
        fromName,
      },
    );
  }

  console.log(
    `[persistence] loaded ${knownUsers.size} users, `
      + `${friendshipsResult.rowCount ?? 0} friendships, `
      + `${requestsResult.rowCount ?? 0} pending requests.`,
  );
}

async function persistUser(
  user,
) {
  if (!database) {
    return;
  }

  await database.query(
    `
      INSERT INTO collab_users (
        user_id,
        name,
        name_key,
        last_seen,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        NOW(),
        NOW()
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        name_key = EXCLUDED.name_key,
        last_seen = NOW(),
        updated_at = NOW()
    `,
    [
      user.userId,
      user.name,
      user.nameKey,
    ],
  );
}

async function persistFriendship(
  firstUserId,
  secondUserId,
) {
  if (!database) {
    return;
  }

  const [
    userIdA,
    userIdB,
  ] =
    friendshipPair(
      firstUserId,
      secondUserId,
    );

  await database.query(
    `
      INSERT INTO collab_friendships (
        user_id_a,
        user_id_b
      )
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING
    `,
    [
      userIdA,
      userIdB,
    ],
  );
}

async function persistFriendRequest(
  fromUserId,
  targetNameKey,
  fromName,
) {
  if (!database) {
    return;
  }

  await database.query(
    `
      INSERT INTO collab_friend_requests (
        from_user_id,
        target_name_key,
        from_name,
        created_at
      )
      VALUES (
        $1,
        $2,
        $3,
        NOW()
      )
      ON CONFLICT (
        from_user_id,
        target_name_key
      )
      DO UPDATE SET
        from_name = EXCLUDED.from_name,
        created_at = NOW()
    `,
    [
      fromUserId,
      targetNameKey,
      fromName,
    ],
  );
}

async function deleteFriendRequest(
  fromUserId,
  targetNameKey,
) {
  if (!database) {
    return;
  }

  await database.query(
    `
      DELETE FROM collab_friend_requests
      WHERE
        from_user_id = $1
        AND target_name_key = $2
    `,
    [
      fromUserId,
      targetNameKey,
    ],
  );
}

async function touchPersistedUser(
  userId,
) {
  if (!database) {
    return;
  }

  try {
    await database.query(
      `
        UPDATE collab_users
        SET
          last_seen = NOW(),
          updated_at = NOW()
        WHERE user_id = $1
      `,
      [
        userId,
      ],
    );
  } catch (error) {
    console.error(
      '[persistence] failed to update last_seen',
      error,
    );
  }
}

function safeText(
  value,
  maxLength,
) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .trim()
    .slice(0, maxLength);
}

function normalizeName(value) {
  return safeText(
    value,
    32,
  )
    .toLocaleLowerCase();
}

function normalizeRoomCode(value) {
  return safeText(value, 10)
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      '',
    );
}

function sanitizeId(value) {
  return safeText(
    value,
    120,
  );
}

function sanitizeIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map(sanitizeId)
        .filter(Boolean)
        .slice(0, 500),
    ),
  );
}

function sanitizeProjectSnapshot(value) {
  if (
    !value
      || typeof value
        !== 'object'
  ) {
    return null;
  }

  const projectName =
    safeText(
      value.projectName,
      160,
    );

  const files =
    Array.isArray(
      value.files,
    )
      ? Array.from(
          new Set(
            value.files
              .map(
                (pathValue) =>
                  safeText(
                    pathValue,
                    1000,
                  ),
              )
              .filter(Boolean)
              .slice(0, 5000),
          ),
        )
      : [];

  const directories =
    Array.isArray(
      value.directories,
    )
      ? Array.from(
          new Set(
            value.directories
              .map(
                (pathValue) =>
                  safeText(
                    pathValue,
                    1000,
                  ),
              )
              .filter(Boolean)
              .slice(0, 5000),
          ),
        )
      : [];

  if (
    !projectName
      || files.length === 0
  ) {
    return null;
  }

  const preferredFile =
    safeText(
      value.preferredFile,
      1000,
    );

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

function isViewport(value) {
  return Boolean(
    value
      && typeof value
        === 'object'
      && typeof value.filePath
        === 'string'
      && Number.isInteger(
        value.startLine,
      )
      && Number.isInteger(
        value.endLine,
      )
      && Number.isInteger(
        value.centerLine,
      ),
  );
}

function send(socket, payload) {
  if (
    socket.readyState
      !== WebSocket.OPEN
  ) {
    return;
  }

  socket.send(
    JSON.stringify(payload),
  );
}

function reject(
  socket,
  code,
  message,
) {
  send(
    socket,
    {
      type: 'error',
      code,
      message,
    },
  );
}

function rejectProtocol(
  socket,
  clientProtocolVersion,
  message,
) {
  send(
    socket,
    {
      type:
        'protocol-error',
      serverProtocolVersion:
        PROTOCOL_VERSION,
      clientProtocolVersion,
      message,
    },
  );

  setTimeout(
    () => {
      if (
        socket.readyState
          === WebSocket.OPEN
      ) {
        socket.close(
          1002,
          'protocol mismatch',
        );
      }
    },
    60,
  );
}

function handleHello(
  socket,
  message,
) {
  const clientProtocolVersion =
    Number.isInteger(
      message.protocolVersion,
    )
      ? message.protocolVersion
      : 0;

  if (
    clientProtocolVersion
      !== PROTOCOL_VERSION
  ) {
    rejectProtocol(
      socket,
      clientProtocolVersion,
      `客户端协议 v${clientProtocolVersion || '未知'} 与服务器协议 v${PROTOCOL_VERSION} 不兼容。`,
    );
    return;
  }

  socket.protocolReady =
    true;

  send(
    socket,
    {
      type: 'hello-ack',
      protocolVersion:
        PROTOCOL_VERSION,
      capabilities:
        PROTOCOL_CAPABILITIES,
    },
  );
}

function ensureFriendSet(userId) {
  let set =
    friendships.get(userId);

  if (!set) {
    set = new Set();
    friendships.set(
      userId,
      set,
    );
  }

  return set;
}

function areFriends(
  firstUserId,
  secondUserId,
) {
  return Boolean(
    friendships
      .get(firstUserId)
      ?.has(secondUserId),
  );
}

function addFriendship(
  firstUserId,
  secondUserId,
) {
  ensureFriendSet(
    firstUserId,
  ).add(
    secondUserId,
  );

  ensureFriendSet(
    secondUserId,
  ).add(
    firstUserId,
  );

  const firstSocket =
    onlineDirectorySockets.get(
      firstUserId,
    );

  const secondSocket =
    onlineDirectorySockets.get(
      secondUserId,
    );

  firstSocket
    ?.friendIds
    ?.add(
      secondUserId,
    );

  secondSocket
    ?.friendIds
    ?.add(
      firstUserId,
    );
}

function publicFriend(userId) {
  const known =
    knownUsers.get(userId);

  return {
    userId,
    name:
      known?.name
        ?? 'Unknown',
    online:
      onlineDirectorySockets
        .has(userId),
  };
}

function sendDirectoryState(socket) {
  const userId =
    socket.directoryUserId;

  if (!userId) {
    return;
  }

  const ids =
    new Set([
      ...(
        socket.friendIds
          ?? []
      ),
      ...(
        friendships.get(userId)
          ?? []
      ),
    ]);

  const friends =
    Array.from(ids)
      .filter(Boolean)
      .map(publicFriend)
      .sort(
        (a, b) =>
          Number(b.online)
            - Number(a.online)
          || a.name.localeCompare(
            b.name,
          ),
      );

  send(
    socket,
    {
      type:
        'directory-state',
      friends,
    },
  );
}

function broadcastDirectoryStates() {
  for (
    const socket
      of onlineDirectorySockets
        .values()
  ) {
    sendDirectoryState(socket);
  }
}

function deliverPendingRequests(
  socket,
  nameKey,
) {
  const pending =
    pendingFriendRequests
      .get(nameKey)
      ?? [];

  for (const request of pending) {
    if (
      request.fromUserId
        === socket.directoryUserId
    ) {
      continue;
    }

    if (
      areFriends(
        request.fromUserId,
        socket.directoryUserId,
      )
    ) {
      continue;
    }

    send(
      socket,
      {
        type:
          'friend-request',
        fromUserId:
          request.fromUserId,
        fromName:
          request.fromName,
      },
    );
  }
}

async function handleDirectoryRegister(
  socket,
  message,
) {
  const userId =
    sanitizeId(
      message.userId,
    );

  const name =
    safeText(
      message.name,
      32,
    );

  const nameKey =
    normalizeName(name);

  if (
    !userId
      || nameKey.length < 2
  ) {
    reject(
      socket,
      'invalid_identity',
      '用户名至少需要 2 个字符。',
    );
    return;
  }

  const claimedBy =
    userIdByName.get(
      nameKey,
    );

  if (
    claimedBy
      && claimedBy !== userId
  ) {
    reject(
      socket,
      'name_taken',
      '这个用户名已经被其他用户使用，请换一个用户名。',
    );
    return;
  }

  try {
    await persistUser({
      userId,
      name,
      nameKey,
    });
  } catch (error) {
    if (
      error
        && typeof error
          === 'object'
        && error.code
          === '23505'
    ) {
      reject(
        socket,
        'name_taken',
        '这个用户名已经被其他用户使用，请换一个用户名。',
      );
      return;
    }

    console.error(
      '[persistence] failed to save user',
      error,
    );

    reject(
      socket,
      'persistence_error',
      '好友资料暂时无法保存，请稍后再试。',
    );
    return;
  }

  const previous =
    knownUsers.get(userId);

  if (
    previous?.nameKey
      && previous.nameKey
        !== nameKey
      && userIdByName.get(
        previous.nameKey,
      ) === userId
  ) {
    userIdByName.delete(
      previous.nameKey,
    );
  }

  const oldSocket =
    onlineDirectorySockets.get(
      userId,
    );

  if (
    oldSocket
      && oldSocket !== socket
  ) {
    oldSocket.directoryUserId =
      '';
  }

  socket.directoryUserId =
    userId;

  socket.friendIds =
    new Set(
      sanitizeIdList(
        message.friendIds,
      ),
    );

  knownUsers.set(
    userId,
    {
      userId,
      name,
      nameKey,
      lastSeen:
        Date.now(),
    },
  );

  userIdByName.set(
    nameKey,
    userId,
  );

  onlineDirectorySockets.set(
    userId,
    socket,
  );

  for (
    const friendId
      of socket.friendIds
  ) {
    if (
      !knownUsers.has(
        friendId,
      )
    ) {
      continue;
    }

    try {
      await persistFriendship(
        userId,
        friendId,
      );
    } catch (error) {
      console.error(
        '[persistence] failed to migrate friendship',
        error,
      );
      continue;
    }

    addFriendship(
      userId,
      friendId,
    );
  }

  const persistedFriends =
    friendships.get(userId)
      ?? [];

  socket.friendIds =
    new Set([
      ...socket.friendIds,
      ...persistedFriends,
    ]);

  sendDirectoryState(socket);
  deliverPendingRequests(
    socket,
    nameKey,
  );

  broadcastDirectoryStates();
}

async function handleFriendSync(
  socket,
  message,
) {
  const userId =
    socket.directoryUserId;

  if (!userId) {
    return;
  }

  const incomingFriendIds =
    new Set(
      sanitizeIdList(
        message.friendIds,
      ),
    );

  for (
    const friendId
      of incomingFriendIds
  ) {
    if (
      !knownUsers.has(
        friendId,
      )
    ) {
      continue;
    }

    try {
      await persistFriendship(
        userId,
        friendId,
      );
    } catch (error) {
      console.error(
        '[persistence] failed to save friendship sync',
        error,
      );
      continue;
    }

    addFriendship(
      userId,
      friendId,
    );
  }

  socket.friendIds =
    new Set([
      ...incomingFriendIds,
      ...(
        friendships.get(userId)
          ?? []
      ),
    ]);

  sendDirectoryState(socket);
  broadcastDirectoryStates();
}

async function handleFriendRequest(
  socket,
  message,
) {
  const fromUserId =
    socket.directoryUserId;

  if (!fromUserId) {
    reject(
      socket,
      'directory_required',
      '请先连接好友服务。',
    );
    return;
  }

  const fromUser =
    knownUsers.get(
      fromUserId,
    );

  if (!fromUser) {
    return;
  }

  const targetName =
    safeText(
      message.targetName,
      32,
    );

  const targetNameKey =
    normalizeName(
      targetName,
    );

  if (
    targetNameKey.length < 2
  ) {
    reject(
      socket,
      'invalid_friend_name',
      '请输入有效用户名。',
    );
    return;
  }

  if (
    targetNameKey
      === fromUser.nameKey
  ) {
    reject(
      socket,
      'self_friend',
      '不能添加自己。',
    );
    return;
  }

  const targetUserId =
    userIdByName.get(
      targetNameKey,
    );

  if (
    targetUserId
      && areFriends(
        fromUserId,
        targetUserId,
      )
  ) {
    try {
      await deleteFriendRequest(
        fromUserId,
        targetNameKey,
      );
    } catch (error) {
      console.error(
        '[persistence] failed to clear stale friend request',
        error,
      );
    }

    forgetPendingRequest(
      targetNameKey,
      fromUserId,
    );

    const target =
      publicFriend(
        targetUserId,
      );

    send(
      socket,
      {
        type:
          'friend-added',
        ...target,
      },
    );
    return;
  }

  try {
    await persistFriendRequest(
      fromUserId,
      targetNameKey,
      fromUser.name,
    );
  } catch (error) {
    console.error(
      '[persistence] failed to save friend request',
      error,
    );

    reject(
      socket,
      'persistence_error',
      '好友请求暂时无法保存，请稍后再试。',
    );
    return;
  }

  rememberPendingRequest(
    targetNameKey,
    {
      fromUserId,
      fromName:
        fromUser.name,
    },
  );

  const targetSocket =
    targetUserId
      ? onlineDirectorySockets
        .get(targetUserId)
      : null;

  if (targetSocket) {
    send(
      targetSocket,
      {
        type:
          'friend-request',
        fromUserId,
        fromName:
          fromUser.name,
      },
    );
  }

  send(
    socket,
    {
      type:
        'friend-request-sent',
      targetName,
      queued:
        !targetSocket,
    },
  );
}

async function handleFriendAccept(
  socket,
  message,
) {
  const userId =
    socket.directoryUserId;

  const targetUserId =
    sanitizeId(
      message.targetUserId,
    );

  if (
    !userId
      || !targetUserId
      || targetUserId === userId
  ) {
    return;
  }

  const target =
    knownUsers.get(
      targetUserId,
    );

  const current =
    knownUsers.get(userId);

  if (
    !target
      || !current
  ) {
    reject(
      socket,
      'friend_unknown',
      '找不到这个好友身份。',
    );
    return;
  }

  try {
    await persistFriendship(
      userId,
      targetUserId,
    );

    await deleteFriendRequest(
      targetUserId,
      current.nameKey,
    );
  } catch (error) {
    console.error(
      '[persistence] failed to accept friendship',
      error,
    );

    reject(
      socket,
      'persistence_error',
      '好友关系暂时无法保存，请稍后再试。',
    );
    return;
  }

  forgetPendingRequest(
    current.nameKey,
    targetUserId,
  );

  addFriendship(
    userId,
    targetUserId,
  );

  send(
    socket,
    {
      type:
        'friend-added',
      ...publicFriend(
        targetUserId,
      ),
    },
  );

  const targetSocket =
    onlineDirectorySockets.get(
      targetUserId,
    );

  if (targetSocket) {
    send(
      targetSocket,
      {
        type:
          'friend-added',
        ...publicFriend(
          userId,
        ),
      },
    );
  }

  broadcastDirectoryStates();
}

async function handleFriendReject(
  socket,
  message,
) {
  const userId =
    socket.directoryUserId;

  const targetUserId =
    sanitizeId(
      message.targetUserId,
    );

  const current =
    userId
      ? knownUsers.get(userId)
      : null;

  if (
    !userId
      || !targetUserId
      || !current
  ) {
    return;
  }

  try {
    await deleteFriendRequest(
      targetUserId,
      current.nameKey,
    );
  } catch (error) {
    console.error(
      '[persistence] failed to reject friend request',
      error,
    );

    reject(
      socket,
      'persistence_error',
      '好友请求状态暂时无法保存，请稍后再试。',
    );
    return;
  }

  forgetPendingRequest(
    current.nameKey,
    targetUserId,
  );
}

function handleCollabInvite(
  socket,
  message,
) {
  const fromUserId =
    socket.directoryUserId;

  const targetUserId =
    sanitizeId(
      message.targetUserId,
    );

  const roomCode =
    normalizeRoomCode(
      message.roomCode,
    );

  if (
    !fromUserId
      || !targetUserId
      || roomCode.length < 4
  ) {
    reject(
      socket,
      'invalid_invite',
      '协作邀请信息不完整。',
    );
    return;
  }

  if (
    !areFriends(
      fromUserId,
      targetUserId,
    )
  ) {
    reject(
      socket,
      'not_friends',
      '只能邀请好友加入协作。',
    );
    return;
  }

  const room =
    rooms.get(roomCode);

  if (!room) {
    reject(
      socket,
      'room_not_ready',
      '协作空间还没有准备好，请再试一次。',
    );
    return;
  }

  const targetSocket =
    onlineDirectorySockets.get(
      targetUserId,
    );

  if (!targetSocket) {
    reject(
      socket,
      'friend_offline',
      '好友当前离线。',
    );
    return;
  }

  const fromUser =
    knownUsers.get(
      fromUserId,
    );

  send(
    targetSocket,
    {
      type:
        'collab-invite',
      fromUserId,
      fromName:
        fromUser?.name
          ?? '好友',
      roomCode,
      repositoryKey:
        room.repositoryKey,
    },
  );

  send(
    socket,
    {
      type:
        'collab-invite-sent',
      targetUserId,
    },
  );
}

function roomForSocket(socket) {
  const roomCode =
    socket.readerRoomCode;

  if (!roomCode) {
    return null;
  }

  return rooms.get(roomCode)
    ?? null;
}

function publicPeer(peer) {
  return {
    peerId:
      peer.peerId,
    name:
      peer.name,
    filePath:
      peer.viewport?.filePath
        ?? '',
    startLine:
      peer.viewport?.startLine
        ?? 1,
    endLine:
      peer.viewport?.endLine
        ?? 1,
    centerLine:
      peer.viewport?.centerLine
        ?? 1,
    focus:
      peer.focus
        ?? null,
    selection:
      peer.selection
        ?? null,
    updatedAt:
      peer.updatedAt,
  };
}

function broadcastRoom(
  roomCode,
  snapshotSocket = null,
) {
  const room =
    rooms.get(roomCode);

  if (!room) {
    return;
  }

  const peers =
    Array.from(
      room.peers.values(),
      publicPeer,
    );

  for (
    const socket
      of room.peers.keys()
  ) {
    send(
      socket,
      {
        type:
          'room-state',
        roomCode,
        repositoryKey:
          room.repositoryKey,
        peers,
        projectSnapshot:
          socket === snapshotSocket
            ? room.projectSnapshot
              ?? null
            : null,
      },
    );
  }
}

function leaveRoom(socket) {
  const roomCode =
    socket.readerRoomCode;

  if (!roomCode) {
    return;
  }

  const room =
    rooms.get(roomCode);

  socket.readerRoomCode =
    '';

  if (!room) {
    return;
  }

  room.peers.delete(
    socket,
  );

  if (
    room.ownerSocket
      === socket
  ) {
    room.ownerSocket =
      null;
  }

  if (
    room.peers.size
      === 0
  ) {
    rooms.delete(
      roomCode,
    );
    return;
  }

  broadcastRoom(
    roomCode,
  );
}

function handleJoin(
  socket,
  message,
) {
  const roomCode =
    normalizeRoomCode(
      message.roomCode,
    );

  const peerId =
    sanitizeId(
      message.peerId,
    );

  const name =
    safeText(
      message.name,
      32,
    );

  const repositoryKey =
    safeText(
      message.repositoryKey,
      500,
    );

  const mode =
    message.mode === 'create'
      ? 'create'
      : 'join';

  const projectSnapshot =
    mode === 'create'
      && repositoryKey
        .startsWith(
          'local://',
        )
      ? sanitizeProjectSnapshot(
          message.projectSnapshot,
        )
      : null;

  if (
    roomCode.length < 4
      || !peerId
      || !name
  ) {
    reject(
      socket,
      'invalid_join',
      '协作信息不完整。',
    );
    return;
  }

  if (
    mode === 'create'
      && repositoryKey
        .startsWith(
          'local://',
        )
      && !projectSnapshot
  ) {
    reject(
      socket,
      'local_snapshot_required',
      '本地协作需要项目文件树，请重新发起邀请。',
    );
    return;
  }

  leaveRoom(socket);

  let room =
    rooms.get(roomCode);

  if (!room) {
    if (
      mode !== 'create'
        || !repositoryKey
    ) {
      reject(
        socket,
        'room_not_found',
        '这个协作已经结束。',
      );
      return;
    }

    room = {
      repositoryKey,
      peers:
        new Map(),
      ownerSocket:
        socket,
      projectSnapshot,
    };

    rooms.set(
      roomCode,
      room,
    );
  }

  if (
    repositoryKey
      && room.repositoryKey
        !== repositoryKey
  ) {
    reject(
      socket,
      'repository_mismatch',
      '这个协作绑定的是另一个仓库或分支。',
    );
    return;
  }

  socket.readerRoomCode =
    roomCode;

  room.peers.set(
    socket,
    {
      peerId,
      name,
      viewport:
        null,
      focus:
        null,
      selection:
        null,
      updatedAt:
        Date.now(),
    },
  );

  broadcastRoom(
    roomCode,
    socket,
  );
}

function handleFileRequest(
  socket,
  message,
) {
  const room =
    roomForSocket(
      socket,
    );

  if (
    !room
      || !room.repositoryKey
        .startsWith(
          'local://',
        )
      || !room.projectSnapshot
  ) {
    reject(
      socket,
      'remote_file_unavailable',
      '当前协作没有可读取的好友本地项目。',
    );
    return;
  }

  const requester =
    room.peers.get(
      socket,
    );

  const requestId =
    safeText(
      message.requestId,
      160,
    );

  const pathValue =
    safeText(
      message.path,
      1000,
    );

  if (
    !requester
      || !requestId
      || !pathValue
      || !room.projectSnapshot
        .files.includes(
          pathValue,
        )
  ) {
    reject(
      socket,
      'invalid_file_request',
      '好友文件请求无效。',
    );
    return;
  }

  const ownerSocket =
    room.ownerSocket;

  if (
    !ownerSocket
      || ownerSocket.readyState
        !== WebSocket.OPEN
  ) {
    reject(
      socket,
      'owner_offline',
      '项目创建者已经离线。',
    );
    return;
  }

  send(
    ownerSocket,
    {
      type:
        'file-request',
      requestId,
      requesterPeerId:
        requester.peerId,
      path:
        pathValue,
    },
  );
}

function handleFileResponse(
  socket,
  message,
) {
  const room =
    roomForSocket(
      socket,
    );

  if (
    !room
      || socket
        !== room.ownerSocket
  ) {
    return;
  }

  const requestId =
    safeText(
      message.requestId,
      160,
    );

  const targetPeerId =
    sanitizeId(
      message.targetPeerId,
    );

  const pathValue =
    safeText(
      message.path,
      1000,
    );

  if (
    !requestId
      || !targetPeerId
      || !pathValue
  ) {
    return;
  }

  let targetSocket = null;

  for (
    const [
      candidateSocket,
      peer,
    ] of room.peers.entries()
  ) {
    if (
      peer.peerId
        === targetPeerId
    ) {
      targetSocket =
        candidateSocket;
      break;
    }
  }

  if (!targetSocket) {
    return;
  }

  const error =
    typeof message.error
      === 'string'
      ? message.error
          .slice(0, 1000)
      : '';

  if (error) {
    send(
      targetSocket,
      {
        type:
          'file-response',
        requestId,
        path:
          pathValue,
        error,
      },
    );
    return;
  }

  if (
    typeof message.content
      !== 'string'
      || message.content.length
        > 2_200_000
  ) {
    send(
      targetSocket,
      {
        type:
          'file-response',
        requestId,
        path:
          pathValue,
        error:
          '好友文件过大或内容无效。',
      },
    );
    return;
  }

  send(
    targetSocket,
    {
      type:
        'file-response',
      requestId,
      path:
        pathValue,
      content:
        message.content,
    },
  );
}

function handleViewport(
  socket,
  message,
) {
  const room =
    roomForSocket(
      socket,
    );

  if (!room) {
    return;
  }

  const peer =
    room.peers.get(
      socket,
    );

  if (
    !peer
      || !isViewport(
        message.viewport,
      )
  ) {
    return;
  }

  peer.viewport = {
    filePath:
      safeText(
        message.viewport.filePath,
        1000,
      ),
    startLine:
      Math.max(
        1,
        message.viewport.startLine,
      ),
    endLine:
      Math.max(
        1,
        message.viewport.endLine,
      ),
    centerLine:
      Math.max(
        1,
        message.viewport.centerLine,
      ),
  };

  peer.updatedAt =
    Date.now();

  broadcastRoom(
    socket.readerRoomCode,
  );
}

function sanitizeFocus(value) {
  if (value === null) {
    return null;
  }

  if (
    !value
      || typeof value
        !== 'object'
      || typeof value.filePath
        !== 'string'
      || !Number.isInteger(
        value.line,
      )
      || !Number.isInteger(
        value.column,
      )
  ) {
    return undefined;
  }

  return {
    filePath:
      safeText(
        value.filePath,
        1000,
      ),
    line:
      Math.max(
        1,
        value.line,
      ),
    column:
      Math.max(
        1,
        value.column,
      ),
  };
}

function handleFocus(
  socket,
  message,
) {
  const room =
    roomForSocket(
      socket,
    );

  if (!room) {
    return;
  }

  const peer =
    room.peers.get(
      socket,
    );

  if (!peer) {
    return;
  }

  const focus =
    sanitizeFocus(
      message.focus,
    );

  if (focus === undefined) {
    return;
  }

  peer.focus =
    focus;
  peer.updatedAt =
    Date.now();

  broadcastRoom(
    socket.readerRoomCode,
  );
}

function sanitizeSelection(value) {
  if (value === null) {
    return null;
  }

  if (
    !value
      || typeof value
        !== 'object'
      || typeof value.filePath
        !== 'string'
      || !Number.isInteger(
        value.startLine,
      )
      || !Number.isInteger(
        value.startColumn,
      )
      || !Number.isInteger(
        value.endLine,
      )
      || !Number.isInteger(
        value.endColumn,
      )
  ) {
    return undefined;
  }

  const startLine =
    Math.max(
      1,
      value.startLine,
    );
  const startColumn =
    Math.max(
      1,
      value.startColumn,
    );
  const endLine =
    Math.max(
      1,
      value.endLine,
    );
  const endColumn =
    Math.max(
      1,
      value.endColumn,
    );

  if (
    endLine < startLine
      || (
        endLine === startLine
          && endColumn
            <= startColumn
      )
  ) {
    return undefined;
  }

  return {
    filePath:
      safeText(
        value.filePath,
        1000,
      ),
    startLine,
    startColumn,
    endLine,
    endColumn,
  };
}

function handleSelection(
  socket,
  message,
) {
  const room =
    roomForSocket(
      socket,
    );

  if (!room) {
    return;
  }

  const peer =
    room.peers.get(
      socket,
    );

  if (!peer) {
    return;
  }

  const selection =
    sanitizeSelection(
      message.selection,
    );

  if (selection === undefined) {
    return;
  }

  peer.selection =
    selection;
  peer.updatedAt =
    Date.now();

  broadcastRoom(
    socket.readerRoomCode,
  );
}

function leaveDirectory(socket) {
  const userId =
    socket.directoryUserId;

  if (!userId) {
    return;
  }

  if (
    onlineDirectorySockets
      .get(userId)
      === socket
  ) {
    onlineDirectorySockets.delete(
      userId,
    );
  }

  const known =
    knownUsers.get(userId);

  if (known) {
    known.lastSeen =
      Date.now();
  }

  void touchPersistedUser(
    userId,
  );

  socket.directoryUserId =
    '';

  broadcastDirectoryStates();
}

await initializePersistence();

const server =
  new WebSocketServer({
    host,
    port,
    maxPayload:
      3 * 1024 * 1024,
  });

server.on(
  'connection',
  (socket) => {
    socket.isAlive = true;
    socket.protocolReady =
      false;
    socket.readerRoomCode =
      '';
    socket.directoryUserId =
      '';
    socket.friendIds =
      new Set();

    socket.on(
      'pong',
      () => {
        socket.isAlive =
          true;
      },
    );

    socket.on(
      'message',
      (raw) => {
        if (
          typeof raw !== 'object'
            && typeof raw !== 'string'
        ) {
          return;
        }

        let message;

        try {
          message =
            JSON.parse(
              raw.toString(),
            );
        } catch {
          reject(
            socket,
            'invalid_json',
            '消息格式无效。',
          );
          return;
        }

        if (
          message.type
            === 'hello'
        ) {
          handleHello(
            socket,
            message,
          );
          return;
        }

        if (!socket.protocolReady) {
          rejectProtocol(
            socket,
            0,
            `客户端没有完成协议握手。服务器要求协议 v${PROTOCOL_VERSION}。`,
          );
          return;
        }

        if (
          message.type
            === 'directory-register'
        ) {
          void handleDirectoryRegister(
            socket,
            message,
          );
          return;
        }

        if (
          message.type
            === 'friend-sync'
        ) {
          void handleFriendSync(
            socket,
            message,
          );
          return;
        }

        if (
          message.type
            === 'friend-request'
        ) {
          void handleFriendRequest(
            socket,
            message,
          );
          return;
        }

        if (
          message.type
            === 'friend-accept'
        ) {
          void handleFriendAccept(
            socket,
            message,
          );
          return;
        }

        if (
          message.type
            === 'friend-reject'
        ) {
          void handleFriendReject(
            socket,
            message,
          );
          return;
        }

        if (
          message.type
            === 'collab-invite'
        ) {
          handleCollabInvite(
            socket,
            message,
          );
          return;
        }

        if (
          message.type
            === 'join'
        ) {
          handleJoin(
            socket,
            message,
          );
          return;
        }

        if (
          message.type
            === 'file-request'
        ) {
          handleFileRequest(
            socket,
            message,
          );
          return;
        }

        if (
          message.type
            === 'file-response'
        ) {
          handleFileResponse(
            socket,
            message,
          );
          return;
        }

        if (
          message.type
            === 'viewport'
        ) {
          handleViewport(
            socket,
            message,
          );
          return;
        }

        if (
          message.type
            === 'focus'
        ) {
          handleFocus(
            socket,
            message,
          );
          return;
        }

        if (
          message.type
            === 'selection'
        ) {
          handleSelection(
            socket,
            message,
          );
        }
      },
    );

    socket.on(
      'close',
      () => {
        leaveRoom(socket);
        leaveDirectory(socket);
      },
    );
  },
);

const heartbeat =
  setInterval(
    () => {
      for (
        const socket
          of server.clients
      ) {
        if (
          socket.isAlive
            === false
        ) {
          leaveRoom(socket);
          leaveDirectory(socket);
          socket.terminate();
          continue;
        }

        socket.isAlive =
          false;
        socket.ping();
      }
    },
    30_000,
  );

server.on(
  'close',
  () => {
    clearInterval(
      heartbeat,
    );

    if (database) {
      void database.end();
    }
  },
);

console.log(
  `Reader collaboration server protocol v${PROTOCOL_VERSION} listening on ws://${host}:${port}`,
);
