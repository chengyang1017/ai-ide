const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tutorIde', {
  openProject: () => ipcRenderer.invoke('project:open'),
  restoreProject: () => ipcRenderer.invoke('project:restore'),
  readProjectFile: (relativePath) => ipcRenderer.invoke('project:read-file', relativePath),
  writeProjectFile: (relativePath, content) => ipcRenderer.invoke('project:write-file', relativePath, content),
  searchProject: (query) => ipcRenderer.invoke('project:search', query),
  listCodeNotes: (relativePath) => ipcRenderer.invoke('notes:list', relativePath),
  upsertCodeNote: (note) => ipcRenderer.invoke('notes:upsert', note),
  deleteCodeNote: (id) => ipcRenderer.invoke('notes:delete', id),
  findDartSemanticTargets: (focus) => ipcRenderer.invoke('semantic:dart-targets', focus),
  getAppState: () => ipcRenderer.invoke('app:get-state'),
  updateVoiceState: (voiceState) => ipcRenderer.invoke('app:update-voice-state', voiceState),
  listNativeVoices: () => ipcRenderer.invoke('voice:list'),
  synthesizeSpeech: (request) => ipcRenderer.invoke('voice:synthesize', request),
  hasOpenAiKey: () => ipcRenderer.invoke('ai:has-key'),
  setOpenAiKey: (apiKey) => ipcRenderer.invoke('ai:set-key', apiKey),
  clearOpenAiKey: () => ipcRenderer.invoke('ai:clear-key'),
  planTutorTour: (focus) => ipcRenderer.invoke('ai:plan-tour', focus),
  planDartSemanticTour: (focus, mode) => ipcRenderer.invoke('ai:plan-dart-semantic-tour', focus, mode),
});
