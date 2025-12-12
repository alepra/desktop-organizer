const { ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

ipcMain.handle("scan-desktop", async () => {
  const possible = [
    path.join(os.homedir(), "Desktop"),
    path.join(os.homedir(), "OneDrive", "Desktop"),
    "C:\\Users\\alepr\\OneDrive\\Desktop",
    "C:\\Users\\Public\\Desktop"
  ];

  for (const p of possible) {
    try {
      const entries = fs.readdirSync(p, { withFileTypes: true });
      return entries
        .filter(e => e.isFile())
        .map(e => ({
          name: e.name,
          path: path.join(p, e.name)
        }));
    } catch (_) {}
  }

  return [{ name: "Desktop not found", path: "" }];
});
