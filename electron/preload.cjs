const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tutorIde', {
  openProject: () => ipcRenderer.invoke('project:open'),
  readProjectFile: (relativePath) => ipcRenderer.invoke('project:read-file', relativePath),
});
