const { spawn } = require('node:child_process');
const path = require('node:path');

const POWERSHELL = process.env.ComSpec
  ? 'powershell.exe'
  : 'powershell.exe';
const SCRIPT_PATH = path.join(__dirname, 'windows_tts.ps1');
const MAX_STDOUT_BYTES = 16 * 1024 * 1024;

class WindowsTtsBridge {
  constructor() {
    this.platformSupported = process.platform === 'win32';
  }

  isSupported() {
    return this.platformSupported;
  }

  async listVoices() {
    if (!this.platformSupported) {
      return [];
    }

    const result = await runPowerShell('list', {});
    return Array.isArray(result.voices) ? result.voices : [];
  }

  async synthesize({ text, voiceId, rate }) {
    if (!this.platformSupported) {
      throw new Error('Windows 原生 TTS 只在 Windows 上可用。');
    }

    const content = typeof text === 'string' ? text.trim() : '';
    if (!content) {
      throw new Error('没有可朗读的文字。');
    }

    if (content.length > 6000) {
      throw new Error('单次朗读内容过长，请拆成更短的教学步骤。');
    }

    const normalizedRate = Number.isFinite(rate)
      ? Math.min(2, Math.max(0.5, rate))
      : 1;

    return runPowerShell('synthesize', {
      text: content,
      voiceId: typeof voiceId === 'string' ? voiceId : '',
      rate: normalizedRate,
    });
  }
}

function runPowerShell(mode, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      POWERSHELL,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        SCRIPT_PATH,
        '-Mode',
        mode,
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    child.on('error', (error) => {
      fail(new Error(`无法启动 Windows 原生语音服务：${error.message}`));
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, 'utf8') > MAX_STDOUT_BYTES) {
        child.kill();
        fail(new Error('Windows 原生语音返回的数据过大。'));
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;

      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || `退出码 ${code}`;
        reject(new Error(`Windows 原生语音失败：${detail}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim() || '{}'));
      } catch {
        reject(new Error('Windows 原生语音返回了无法解析的数据。'));
      }
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

module.exports = {
  WindowsTtsBridge,
};
