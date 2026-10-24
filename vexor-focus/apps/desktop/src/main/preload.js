const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vexor', {
  focus: {
    get:     () => ipcRenderer.invoke('focus:get'),
    toggle:  () => ipcRenderer.invoke('focus:toggle'),
    reset:   () => ipcRenderer.invoke('focus:reset'),
    skip:    () => ipcRenderer.invoke('focus:skip'),
    setMode: (mode) => ipcRenderer.invoke('focus:set-mode', mode),
    onState: (cb) => {
      const handler = (_e, state) => cb(state);
      ipcRenderer.on('focus:state', handler);
      return () => ipcRenderer.removeListener('focus:state', handler);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  bridge: {
    info: () => ipcRenderer.invoke('bridge:info'),
    onStatus: (cb) => {
      const handler = (_e, s) => cb(s);
      ipcRenderer.on('bridge:status', handler);
      return () => ipcRenderer.removeListener('bridge:status', handler);
    },
  },
  stats: {
    range:    (r) => ipcRenderer.invoke('stats:range', r),
    timeline: (r) => ipcRenderer.invoke('stats:timeline', r),
  },
  categories: {
    get: () => ipcRenderer.invoke('categories:get'),
    set: (rows) => ipcRenderer.invoke('categories:set', rows),
  },
  data: {
    wipe: () => ipcRenderer.invoke('data:wipe'),
  },
  quit: () => ipcRenderer.invoke('quit-app'),
});
