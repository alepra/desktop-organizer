// Placeholder IPC handlers for Electron backend
// No real filesystem operations yet - will be added in later phases

function registerHandlers(ipcMain) {
  // Placeholder: scan desktop directory
  ipcMain.handle('scan-desktop', async () => {
    return {
      success: true,
      files: [],
      message: 'Placeholder scan - no files returned yet'
    };
  });

  // Placeholder: get initial application state
  ipcMain.handle('get-initial-state', async () => {
    return {
      success: true,
      message: 'IPC connection successful! (Placeholder state)',
      desktopFiles: [],
      clusters: []
    };
  });

  // Placeholder: perform actions
  ipcMain.handle('perform-placeholder-action', async (event, action) => {
    return {
      success: true,
      message: `Placeholder action "${action}" received`
    };
  });
}

module.exports = { registerHandlers };

