const { ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const sessions = new Map();
const MAX_INPUT_LENGTH = 64 * 1024;

async function validateProjectRoot(rawRoot) {
  if (typeof rawRoot !== 'string' || !rawRoot.trim()) {
    throw new Error('请先打开一个本地真实项目。');
  }

  const root = path.resolve(rawRoot);
  if (!path.isAbsolute(root)) {
    throw new Error('终端工作目录无效。');
  }

  const stat = await fs.stat(root);
  if (!stat.isDirectory()) {
    throw new Error('终端工作目录不是文件夹。');
  }

  return root;
}

function shellConfiguration() {
  if (process.platform === 'win32') {
    const startup = [
      '$utf8 = [System.Text.UTF8Encoding]::new($false)',
      '[Console]::InputEncoding = $utf8',
      '[Console]::OutputEncoding = $utf8',
      '$OutputEncoding = $utf8',
    ].join('; ');

    return {
      command: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NoExit',
        '-Command',
        startup,
      ],
      label: 'PowerShell',
    };
  }

  const command = process.env.SHELL?.trim() || '/bin/bash';
  return {
    command,
    args: [],
    label: path.basename(command),
  };
}

function send(sender, channel, payload) {
  if (!sender.isDestroyed()) {
    sender.send(channel, payload);
  }
}

function stopSession(senderId) {
  const session = sessions.get(senderId);
  if (!session) {
    return false;
  }

  sessions.delete(senderId);
  try {
    session.child.stdin.end();
  } catch {
    // Ignore shutdown races.
  }

  if (!session.child.killed) {
    try {
      session.child.kill();
    } catch {
      // Process may already be gone.
    }
  }

  return true;
}

ipcMain.handle('terminal:start', async (event, rawRoot) => {
  const root = await validateProjectRoot(rawRoot);
  const senderId = event.sender.id;
  stopSession(senderId);

  const shell = shellConfiguration();
  const child = spawn(shell.command, shell.args, {
    cwd: root,
    env: {
      ...process.env,
      TERM: process.env.TERM || 'xterm-256color',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  const session = {
    child,
    root,
    shell: shell.label,
  };
  sessions.set(senderId, session);

  const forward = (stream) => {
    stream.on('data', (data) => {
      send(event.sender, 'terminal:data', {
        data: String(data),
      });
    });
  };

  forward(child.stdout);
  forward(child.stderr);

  child.on('error', (error) => {
    send(event.sender, 'terminal:data', {
      data: `\r\n[terminal error] ${error.message}\r\n`,
    });
  });

  child.on('exit', (code, signal) => {
    if (sessions.get(senderId)?.child === child) {
      sessions.delete(senderId);
    }
    send(event.sender, 'terminal:exit', {
      code,
      signal,
    });
  });

  event.sender.once('destroyed', () => {
    if (sessions.get(senderId)?.child === child) {
      stopSession(senderId);
    }
  });

  return {
    cwd: root,
    shell: shell.label,
  };
});

ipcMain.handle('terminal:write', (event, rawInput) => {
  const session = sessions.get(event.sender.id);
  if (!session || session.child.killed) {
    throw new Error('终端尚未启动。');
  }

  if (typeof rawInput !== 'string') {
    throw new Error('终端输入无效。');
  }

  if (rawInput.length > MAX_INPUT_LENGTH) {
    throw new Error('单次终端输入过长。');
  }

  session.child.stdin.write(`${rawInput}\r\n`);
  return true;
});

ipcMain.handle('terminal:stop', (event) => {
  return stopSession(event.sender.id);
});
