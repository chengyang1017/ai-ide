const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tutorIde', {
  openProject: () => ipcRenderer.invoke('project:open'),
  readProjectFile: (relativePath) => ipcRenderer.invoke('project:read-file', relativePath),
  searchProject: (query) => ipcRenderer.invoke('project:search', query),
  findDartSemanticTargets: (focus) => ipcRenderer.invoke('semantic:dart-targets', focus),
  hasOpenAiKey: () => ipcRenderer.invoke('ai:has-key'),
  setOpenAiKey: (apiKey) => ipcRenderer.invoke('ai:set-key', apiKey),
  planTutorTour: (focus) => ipcRenderer.invoke('ai:plan-tour', focus),
});
