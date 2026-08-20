export interface CollabRemoteProjectSnapshot {
  rootPath: string;
  projectName: string;
  files: string[];
  directories?: string[];
}

type CollabRemoteFileReader =
  (
    path: string,
  ) => Promise<{
    path: string;
    content: string;
  }>;

interface ActiveCollabRemoteProject {
  snapshot:
    CollabRemoteProjectSnapshot;
  files: Set<string>;
  readFile:
    CollabRemoteFileReader;
}

let active:
  ActiveCollabRemoteProject | null =
    null;

export function setCollabRemoteProject(
  snapshot:
    CollabRemoteProjectSnapshot,
  readFile:
    CollabRemoteFileReader,
): void {
  active = {
    snapshot,
    files:
      new Set(
        snapshot.files,
      ),
    readFile,
  };
}

export function clearCollabRemoteProject():
  void {
  active = null;
}

export function hasCollabRemoteProject(
  rootPath?: string,
): boolean {
  if (!active) {
    return false;
  }

  if (!rootPath) {
    return true;
  }

  return (
    active.snapshot.rootPath
      === rootPath
  );
}

export async function readCollabRemoteProjectFile(
  path: string,
): Promise<{
  path: string;
  content: string;
}> {
  const project =
    active;

  if (!project) {
    throw new Error(
      '当前没有好友远程项目。',
    );
  }

  if (
    !project.files.has(path)
  ) {
    throw new Error(
      `好友项目中没有这个文件：${path}`,
    );
  }

  return project.readFile(path);
}
