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
  void Promise.all([
    import('./file_manager'),
    import('./file_manager_create_dialog'),
  ]);
}
