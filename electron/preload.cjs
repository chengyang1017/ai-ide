const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tutorIde', {
  openProject: () => ipcRenderer.invoke('project:open'),
  restoreProject: () => ipcRenderer.invoke('project:restore'),
  readProjectFile: (relativePath) => ipcRenderer.invoke('project:read-file', relativePath),
  readProjectAsset: (relativePath) => ipcRenderer.invoke('project:read-asset', relativePath),
  openExternal: (url) => ipcRenderer.invoke('project:open-external', url),
  writeProjectFile: (relativePath, content) => ipcRenderer.invoke('project:write-file', relativePath, content),
  watchProjectFile: (relativePath) => ipcRenderer.invoke('project:watch-file', relativePath),
  unwatchProjectFile: () => ipcRenderer.invoke('project:unwatch-file'),
  onProjectFileChanged: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('project:file-changed', wrapped);
    return () => ipcRenderer.removeListener('project:file-changed', wrapped);
  },
  searchProject: (query) => ipcRenderer.invoke('project:search', query),
  listCodeNotes: (relativePath) => ipcRenderer.invoke('notes:list', relativePath),
  upsertCodeNote: (note) => ipcRenderer.invoke('notes:upsert', note),
  deleteCodeNote: (id) => ipcRenderer.invoke('notes:delete', id),
  importCodeNoteImage: (image) => ipcRenderer.invoke('notes:import-image', image),
  readCodeNoteImage: (assetPath) => ipcRenderer.invoke('notes:read-image', assetPath),
  findDartSemanticTargets: (focus) => ipcRenderer.invoke('semantic:dart-targets', focus),
  getAppState: () => ipcRenderer.invoke('app:get-state'),
  updateVoiceState: (voiceState) => ipcRenderer.invoke('app:update-voice-state', voiceState),
  updateAppearanceState: (appearance) => ipcRenderer.invoke('app:update-appearance-state', appearance),
  chooseAppearanceBackground: () => ipcRenderer.invoke('appearance:choose-background'),
  getAppearanceBackground: () => ipcRenderer.invoke('appearance:get-background'),
  clearAppearanceBackground: () => ipcRenderer.invoke('appearance:clear-background'),
  listNativeVoices: () => ipcRenderer.invoke('voice:list'),
  synthesizeSpeech: (request) => ipcRenderer.invoke('voice:synthesize', request),
  hasOpenAiKey: () => ipcRenderer.invoke('ai:has-key'),
  setOpenAiKey: (apiKey) => ipcRenderer.invoke('ai:set-key', apiKey),
  clearOpenAiKey: () => ipcRenderer.invoke('ai:clear-key'),
  explainCurrentCode: (context) => ipcRenderer.invoke('ai:explain-current-code', context),
  planTutorTour: (focus) => ipcRenderer.invoke('ai:plan-tour', focus),
  planDartSemanticTour: (focus, mode) => ipcRenderer.invoke('ai:plan-dart-semantic-tour', focus, mode),
});
