
# DroidGrid Pro | Electron Setup Guide

This guide will help you package DroidGrid Pro into a standalone Windows (.exe) application. Since DroidGrid uses a **Full-Stack** architecture (React Frontend + Node.js Backend), we need to ensure both are bundled correctly.

## 1. Prerequisites
Ensure you have the following installed on your local machine:
- [Node.js](https://nodejs.org/) (v18 or higher)
- [Git](https://git-scm.com/) (Optional, to clone your repo)

## 2. Installation
Open your project folder in a terminal and run:

```bash
# Install core dependencies
npm install

# Install Electron and Packaging tools
npm install --save-dev electron electron-builder tsx
```

## 3. Local Development Mode
To run the DroidGrid app as a desktop window locally:

```bash
# Start the Express server + Electron Main Process
npm run electron:dev
```

## 4. Building the .EXE Application
To generate a standalone portable `.exe` for Windows:

```bash
# 1. Clear previous builds
npm run clean

# 2. Build the React frontend
npm run build

# 3. Package everything into an EXE
npm run electron:build
```

### Output Location
Your final app will be located in the `/release` folder.
- `DroidGrid Pro [Version].exe`

## 5. Customizing the Icon
1. Create a `public` folder in your root directory.
2. Place a `icon.png` (at least 256x256) inside.
3. The build script is already configured to pick this up!

## 6. How it Works (Architecture)
- **Frontend:** Built with Vite/React, served as static files by the Express server.
- **Backend:** `server.ts` runs a local Express server on port 3000.
- **Electron:** `electron-main.cjs` acts as the browser wrapper. It starts the Node.js server in the background and loads `http://localhost:3000` into a native window.

---
**DroidGrid Pro** | *Kernel-Level Monitoring, Local Execution.*
