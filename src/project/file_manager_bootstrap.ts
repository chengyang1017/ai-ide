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
  void (async () => {
    await import('./file_manager');
    await import('./file_manager_create_dialog');
    await import('./file_manager_multiselect');
  })();
}
