import {
  Capacitor,
  registerPlugin,
} from '@capacitor/core';

export interface GitHubLoginState {
  authenticated: boolean;
  login?: string;
  name?: string;
  avatarUrl?: string;
}

export interface GitHubDeviceFlow {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface GitHubDevicePoll {
  status:
    | 'authorized'
    | 'authorization_pending'
    | 'slow_down'
    | 'expired_token'
    | 'access_denied'
    | string;
  description?: string;
}

interface GitHubAuthPlugin {
  beginDeviceFlow(): Promise<GitHubDeviceFlow>;
  getPendingDeviceFlow(): Promise<
    GitHubDeviceFlow & {
      active: boolean;
    }
  >;
  pollDeviceFlow(options: {
    deviceCode: string;
  }): Promise<GitHubDevicePoll>;
  getLoginState(): Promise<GitHubLoginState>;
  logout(): Promise<{ value: boolean }>;
  apiGet(options: {
    path: string;
  }): Promise<{
    status: number;
    body: string;
  }>;
  readRepositoryFile(options: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  }): Promise<{
    path: string;
    content: string;
  }>;
  readRepositoryAsset(options: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  }): Promise<{
    path: string;
    mimeType: string;
    dataUrl: string;
  }>;
}

const GitHubAuth =
  registerPlugin<GitHubAuthPlugin>(
    'GitHubAuth',
  );

export function isAndroidGitHubAuth():
  boolean {
  return Capacitor.getPlatform() === 'android';
}

export function beginGitHubDeviceFlow():
  Promise<GitHubDeviceFlow> {
  return GitHubAuth.beginDeviceFlow();
}

export async function getPendingGitHubDeviceFlow():
  Promise<GitHubDeviceFlow | null> {
  const result =
    await GitHubAuth.getPendingDeviceFlow();

  if (!result.active) {
    return null;
  }

  return {
    deviceCode: result.deviceCode,
    userCode: result.userCode,
    verificationUri: result.verificationUri,
    expiresIn: result.expiresIn,
    interval: result.interval,
  };
}

export function pollGitHubDeviceFlow(
  deviceCode: string,
): Promise<GitHubDevicePoll> {
  return GitHubAuth.pollDeviceFlow({
    deviceCode,
  });
}

export function getGitHubLoginState():
  Promise<GitHubLoginState> {
  return GitHubAuth.getLoginState();
}

export async function logoutGitHub():
  Promise<void> {
  await GitHubAuth.logout();
}

export async function githubApiGetJson<T>(
  path: string,
): Promise<T> {
  const result = await GitHubAuth.apiGet({
    path,
  });

  if (
    result.status < 200
      || result.status >= 300
  ) {
    let detail = '';
    try {
      const parsed = JSON.parse(
        result.body,
      ) as {
        message?: string;
      };
      detail = parsed.message ?? '';
    } catch {
      detail = result.body.slice(0, 180);
    }

    throw new Error(
      `GitHub 请求失败 · HTTP ${result.status}`
        + (detail ? ` · ${detail}` : ''),
    );
  }

  return JSON.parse(result.body) as T;
}

export function githubReadRepositoryFile(
  input: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  },
): Promise<{
  path: string;
  content: string;
}> {
  return GitHubAuth.readRepositoryFile(
    input,
  );
}

export function githubReadRepositoryAsset(
  input: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  },
): Promise<{
  path: string;
  mimeType: string;
  dataUrl: string;
}> {
  return GitHubAuth.readRepositoryAsset(
    input,
  );
}
