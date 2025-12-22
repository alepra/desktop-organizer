# Desktop Organizer - Scaffolding Phase

## Project Overview
This is the foundational scaffolding for Desktop Organizer, an Electron + React desktop application.
**NO REAL FUNCTIONALITY IS IMPLEMENTED YET** - this is structure only.

## Tech Stack
- **Electron** - Desktop application framework
- **React** - Frontend UI library
- **Node.js** - Backend filesystem operations
- **IPC** - Secure communication between Electron and React

## Project Structure

```
desktop-organizer/
│
├─ package.json                  # Dependencies and scripts
├─ electron.js                   # Main Electron process
├─ preload.js                    # Secure IPC bridge
├─ index.html                    # Entry HTML file
│
├─ /src                          # React frontend
│   ├─ index.jsx                 # React entry point
│   ├─ App.jsx                   # Main App component
│   ├─ global.css                # Global styles
│   │
│   ├─ /components               # UI placeholder components
│   │    ├─ GaugePlaceholder.jsx
│   │    ├─ FolderGridPlaceholder.jsx
│   │    ├─ ActionButtonsPlaceholder.jsx
│   │    └─ TopBarPlaceholder.jsx
│   │
│   ├─ /logic                    # Business logic (placeholders)
│   │    ├─ filesystem.js
│   │    ├─ state.js
│   │    └─ undoManager.js
│   │
│   ├─ /animations               # Animation placeholders
│   │    ├─ haloAnimations.js
│   │    ├─ folderAnimations.js
│   │    └─ sparkle.js
│   │
│   └─ /assets                   # Images, icons (empty for now)
│
└─ /electron                     # Electron backend
    └─ ipcHandlers.js            # IPC handlers (placeholder only)
```

## UI Layout

The application displays these placeholder regions:

```
┌────────────────────────────────────────┐
│ TOP BAR PLACEHOLDER                    │
│ (Settings gear later)                  │
├────────────────────────────────────────┤
│ ┌──────────┐                           │
│ │ GAUGE    │                           │
│ │ PLACE-   │    FOLDER GRID            │
│ │ HOLDER   │    PLACEHOLDER            │
│ └──────────┘                           │
│                                        │
│                      ┌──────────────┐  │
│                      │ ACTION       │  │
│                      │ BUTTONS      │  │
│                      └──────────────┘  │
└────────────────────────────────────────┘
```

## Setup Instructions

### 1. Install Dependencies

Run the following command to install all required packages:

```bash
npm install
```

### 2. Start the Application

Run the following command to launch the Electron app:

```bash
npm start
```

This will:
- Start the Vite dev server on port 5173
- Launch Electron once the dev server is ready
- Open a 1200x800 window with DevTools

The application window will display:
- Four placeholder UI regions
- DevTools automatically opened
- IPC communication test message

### Alternative: Run Electron Only

If you need to run Electron separately:

```bash
npm run dev
```

Then in another terminal:

```bash
npm run electron
```

## What's Working

✅ Electron window launches  
✅ React renders placeholder components  
✅ IPC bridge established (preload script)  
✅ Secure communication between main and renderer  
✅ Basic layout structure visible  

## What's NOT Implemented Yet

❌ Desktop file scanning  
❌ File grouping/clustering logic  
❌ Colored halos  
❌ Folder animations  
❌ Cleanup engine  
❌ Undo/backup system  
❌ Cleanliness Score gauge  
❌ Real state management  
❌ Filesystem operations  

All of the above will be added in future phases.

## IPC Channels Available (Placeholder)

- `scan-desktop` - Will scan desktop files (returns empty array)
- `get-initial-state` - Returns placeholder state
- `perform-placeholder-action` - Generic action handler

## Next Steps

This scaffolding is ready for:
1. Implementing desktop scanning logic
2. Adding file grouping algorithms
3. Building the Cleanliness Score gauge
4. Creating animation systems
5. Implementing undo/backup functionality
6. Adding real filesystem operations

## Notes

- Window is set to non-resizable for now
- DevTools open automatically for development
- All placeholder functions log to console when called
- IPC bridge uses contextIsolation for security

