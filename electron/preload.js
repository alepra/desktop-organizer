const { contextBridge, ipcRenderer } = require('electron');

// Expose secure IPC bridge to renderer process
contextBridge.exposeInMainWorld('ipc', {
  invoke: (channel, ...args) => {
    const validChannels = [
      'scan-desktop',
      'get-initial-state',
      'perform-placeholder-action'
    ];
    
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    throw new Error(`Invalid IPC channel: ${channel}`);
  }
});
