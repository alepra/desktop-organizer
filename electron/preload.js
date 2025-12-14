const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
});

contextBridge.exposeInMainWorld("desktopApi", {
  restoreDesktop: () => ipcRenderer.invoke("restoreDesktop")
});
