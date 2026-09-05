type DesktopFileManagerBridge = {
  createProjectFile?: unknown;
};

const desktopFileManagerBridge = (
  window as Window & {
    tutorIde?: DesktopFileManagerBridge;
  }
).tutorIde;

if (
  typeof desktopFileManagerBridge?.createProjectFile
    === 'function'
) {
  void (async () => {
    await import('./file_manager');
    await import('./file_manager_create_dialog');
    await import('./file_manager_multiselect_loader');
  })();
}
