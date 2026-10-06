import { app, BrowserWindow, dialog } from "electron";
import path from "node:path";
import { resolveFfmpegPath } from "../ui/ffmpeg-bin.js";
import { startUiServer, type UiServer } from "../ui/server.js";

const devPublicDir = path.resolve(process.cwd(), "src/ui/public");

let desk: UiServer | undefined;
let window: BrowserWindow | undefined;

app.setName("Frame Desk");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window === undefined) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  });

  app
    .whenReady()
    .then(() => {
      void openDesk();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      app.exit(1);
    });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  void desk?.close();
});

async function openDesk(): Promise<void> {
  desk = await startUiServer({
    port: 0,
    ...(app.isPackaged ? {} : { publicDir: devPublicDir }),
    ffmpegPath: resolveFfmpegPath({
      resourcesDir: app.isPackaged ? process.resourcesPath : undefined,
      override: process.env.FRAME_DESK_FFMPEG,
    }),
    pickFolder: () => chooseProjectFolder(window),
  });
  window = new BrowserWindow({
    width: 1240,
    height: 880,
    minWidth: 880,
    minHeight: 640,
    title: "Frame Desk",
    backgroundColor: "#100e0c",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const origin = new URL(desk.url).origin;
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.once("ready-to-show", () => {
    window?.show();
  });
  await window.loadURL(desk.url);
}

async function chooseProjectFolder(
  parent: BrowserWindow | undefined,
): Promise<string | null> {
  const defaultPath = path.join(
    app.getPath("home"),
    "Library",
    "Application Support",
    "DJI Studio",
    "project",
  );
  const options = {
    title: "Choose a project folder",
    defaultPath,
    properties: ["openDirectory" as const],
  };
  const result =
    parent === undefined
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(parent, options);
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0] ?? null;
}
