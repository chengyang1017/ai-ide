const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tutorIde', {
  openProject: () => ipcRenderer.invoke('project:open'),
  readProjectFile: (relativePath) => ipcRenderer.invoke('project:read-file', relativePath),
  searchProject: (query) => ipcRenderer.invoke('project:search', query),
  hasOpenAiKey: () => ipcRenderer.invoke('ai:has-key'),
  setOpenAiKey: (apiKey) => ipcRenderer.invoke('ai:set-key', apiKey),
  planTutorTour: (focus) => ipcRenderer.invoke('ai:plan-tour', focus),
});
