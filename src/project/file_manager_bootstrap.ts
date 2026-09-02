type DesktopFileManagerBridge = {
  createProjectFile?: unknown;
};

const bridge = (
  window as Window & {
    tutorIde?: DesktopFileManagerBridge;
  }
).tutorIde;

if (
  typeof bridge?.createProjectFile
    === 'function'
) {
  void import('./file_manager');
}
