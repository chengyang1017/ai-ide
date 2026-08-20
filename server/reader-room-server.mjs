import {
  WebSocket,
  WebSocketServer,
} from 'ws';

const port =
  Number.parseInt(
    process.env.PORT ?? '8787',
    10,
  );

const host =
  process.env.HOST
    ?? '0.0.0.0';

const server =
  new WebSocketServer({
    host,
    port,
    maxPayload:
      32 * 1024,
  });

const rooms =
  new Map();

function safeText(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .trim()
    .slice(0, maxLength);
}

function normalizeRoomCode(value) {
  return safeText(value, 10)
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      '',
    );
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

function broadcastRoom(roomCode) {
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

  const payload = {
    type:
      'room-state',
    roomCode,
    repositoryKey:
      room.repositoryKey,
    peers,
  };

  for (
    const socket
      of room.peers.keys()
  ) {
    send(
      socket,
      payload,
    );
  }
}

function leave(socket) {
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

function reject(socket, code, message) {
  send(
    socket,
    {
      type: 'error',
      code,
      message,
    },
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
    safeText(
      message.peerId,
      80,
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

  if (
    roomCode.length < 4
      || !peerId
      || !name
  ) {
    reject(
      socket,
      'invalid_join',
      '房间信息不完整。',
    );
    return;
  }

  leave(socket);

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
        '这个房间不存在或已经结束。',
      );
      return;
    }

    room = {
      repositoryKey,
      peers:
        new Map(),
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
      '这个房间绑定的是另一个仓库或分支。',
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

server.on(
  'connection',
  (socket) => {
    socket.isAlive = true;
    socket.readerRoomCode =
      '';

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
        leave(socket);
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
          leave(socket);
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
  },
);

console.log(
  `Reader room server listening on ws://${host}:${port}`,
);
