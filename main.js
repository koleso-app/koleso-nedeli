// Колесо недели — desktop shell: window, tray, notifications, local data file.
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, nativeTheme, shell, dialog, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");

const APP_ID = "com.yomigo.koleso-nedeli";
const APP_NAME = "Колесо недели";
app.setName(APP_NAME);
app.setAppUserModelId(APP_ID); // Windows needs this for toast notifications

// Developer self-check: KOLESO_SMOKE=<dir> renders the app with throwaway data, saves screenshots, quits.
// It uses its own data folder (set before the single-instance lock), so it never touches real data.
const SMOKE = process.env.KOLESO_SMOKE;
if (SMOKE) app.setPath("userData", path.join(app.getPath("temp"), "koleso-smoke-" + Date.now()));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null, tray = null, quitting = false, timerInfo = null, shellPrefs = {};
const startHidden = process.argv.includes("--hidden");
const icon = file => path.join(__dirname, "app", "icons", file);

/* ---------- data file ---------- */
const dataDir = () => app.getPath("userData");
const dataFile = () => path.join(dataDir(), "koleso-data.json");
const prefsFile = () => path.join(dataDir(), "shell.json");

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}
function isPlannerJSON(text) {
  try { const d = JSON.parse(text); return d && typeof d === "object" && Array.isArray(d.areas); } catch { return false; }
}
let backedUp = false;
function saveData(text) {
  if (!isPlannerJSON(text)) throw new Error("неверный формат данных");
  if (text.length > 5 * 1024 * 1024) throw new Error("слишком большой файл");
  // keep one backup of the previous file per launch
  if (!backedUp && fs.existsSync(dataFile())) { try { fs.copyFileSync(dataFile(), dataFile().replace(/\.json$/, ".backup.json")); } catch {} backedUp = true; }
  writeAtomic(dataFile(), text);
}
function loadPrefs() { try { shellPrefs = JSON.parse(fs.readFileSync(prefsFile(), "utf8")) || {}; } catch { shellPrefs = {}; } }
function savePrefs() { try { writeAtomic(prefsFile(), JSON.stringify(shellPrefs)); } catch {} }

ipcMain.handle("data:load", () => {
  const file = dataFile();
  if (!fs.existsSync(file)) return { data: null, path: file };
  const text = fs.readFileSync(file, "utf8");
  try { return { data: JSON.parse(text), path: file }; }
  catch {
    const keep = file.replace(/\.json$/, `.broken-${Date.now()}.json`);
    try { fs.renameSync(file, keep); } catch {}
    return { data: null, path: file, error: "Копия: " + path.basename(keep) };
  }
});
ipcMain.handle("data:save", (_e, text) => { saveData(text); return true; });
ipcMain.on("data:save-sync", (e, text) => { try { saveData(text); e.returnValue = true; } catch { e.returnValue = false; } });
ipcMain.handle("data:open-folder", () => shell.openPath(dataDir()));
ipcMain.handle("data:export", async (_e, text) => {
  const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const r = await dialog.showSaveDialog(win, {
    title: "Резервная копия", defaultPath: path.join(app.getPath("documents"), `koleso-nedeli-${stamp}.json`),
    filters: [{ name: "Колесо недели", extensions: ["json"] }],
  });
  if (r.canceled || !r.filePath) return null;
  if (!isPlannerJSON(text)) throw new Error("неверный формат");
  fs.writeFileSync(r.filePath, text, "utf8");
  return r.filePath;
});
ipcMain.handle("data:import", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Загрузить из копии", properties: ["openFile"], filters: [{ name: "Колесо недели", extensions: ["json"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const st = fs.statSync(r.filePaths[0]);
  if (st.size > 5 * 1024 * 1024) throw new Error("слишком большой файл");
  return JSON.parse(fs.readFileSync(r.filePaths[0], "utf8"));
});

/* ---------- sync secrets: encrypted with Windows DPAPI, never stored in plain text ---------- */
const secretFile = () => path.join(dataDir(), "sync.bin");
ipcMain.handle("secret:get", () => {
  try {
    if (!fs.existsSync(secretFile()) || !safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(secretFile())));
  } catch { return null; }
});
ipcMain.handle("secret:set", (_e, cfg) => {
  if (!cfg) { try { fs.unlinkSync(secretFile()); } catch {} return true; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows не дал зашифровать ключи синхронизации");
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(secretFile(), safeStorage.encryptString(JSON.stringify(cfg)));
  return true;
});

/* ---------- autostart ---------- */
const loginArgs = ["--hidden"];
const getAutostart = () => app.getLoginItemSettings({ args: loginArgs }).openAtLogin;
function setAutostart(on) { app.setLoginItemSettings({ openAtLogin: !!on, args: loginArgs }); refreshTrayMenu(); return getAutostart(); }
ipcMain.handle("app:get-autostart", () => getAutostart());
ipcMain.handle("app:set-autostart", (_e, on) => setAutostart(on));

/* ---------- timer: tray tooltip + taskbar progress ---------- */
ipcMain.on("timer:update", (_e, info) => {
  timerInfo = info && Number.isFinite(info.start) && Number.isFinite(info.endsAt) && info.endsAt > info.start ? info : null;
  updateTimerShell();
});
ipcMain.on("timer:notify", (_e, n) => {
  if (Notification.isSupported()) {
    const toast = new Notification({ title: n.title || APP_NAME, body: n.body || "", icon: icon("icon.png"), silent: false });
    toast.on("click", showWindow);
    toast.show();
  }
  if (win) win.flashFrame(true);
  if (n.popup) popWindow();
});
function updateTimerShell() {
  if (!win || win.isDestroyed()) return;
  if (!timerInfo) { win.setProgressBar(-1); if (tray) tray.setToolTip(APP_NAME); return; }
  const now = Date.now(), frac = Math.min(1, Math.max(0, (now - timerInfo.start) / (timerInfo.endsAt - timerInfo.start)));
  const left = Math.max(0, Math.ceil((timerInfo.endsAt - now) / 60000));
  win.setProgressBar(frac);
  if (tray) tray.setToolTip(`${timerInfo.label} — осталось ${left} мин`);
}
setInterval(updateTimerShell, 5000);

/* ---------- window + tray ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 840, minWidth: 380, minHeight: 500,
    title: APP_NAME, icon: icon("icon.png"), show: false, autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#12161B" : "#F1F3EE",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: false, // the timer must keep ticking while minimised
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "app", "index.html"));
  win.once("ready-to-show", () => { if (!startHidden) win.show(); if (SMOKE) runSmoke(); });

  // links open in the normal browser; the app window never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    const target = new URL(url), current = new URL(win.webContents.getURL());
    if (target.protocol === "file:" && target.pathname === current.pathname) return; // hash links between tabs
    e.preventDefault();
    if (/^https?:$/i.test(target.protocol)) shell.openExternal(url);
  });
  win.on("focus", () => win.flashFrame(false));
  win.on("close", e => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!shellPrefs.trayHintShown && Notification.isSupported()) {
      new Notification({ title: APP_NAME, body: "Программа продолжает работать в трее — таймер не остановится. Выход — через значок в трее.", icon: icon("icon.png") }).show();
      shellPrefs.trayHintShown = true; savePrefs();
    }
  });
}
async function runSmoke() {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const errors = [];
  win.webContents.on("console-message", (e) => { if (e.level === "error" || e.level === 3) errors.push(e.message); });
  const shot = async name => fs.writeFileSync(path.join(SMOKE, name), (await win.webContents.capturePage()).toPNG());
  const js = code => win.webContents.executeJavaScript(code, true);
  try {
    fs.mkdirSync(SMOKE, { recursive: true });
    await wait(1200); await shot("1-onboard.png");
    await js(`document.querySelector('[data-act="seed"]').click()`); await wait(500); await shot("2-today.png");
    await js(`document.querySelector('[data-act="start"]').click()`); await wait(1500); await shot("3-timer.png");
    await js(`location.hash = "#week"`); await wait(500); await shot("4-week.png");
    await js(`location.hash = "#areas"`); await wait(500); await shot("5-areas.png");
    await wait(500);
    const saved = fs.existsSync(dataFile()) ? JSON.parse(fs.readFileSync(dataFile(), "utf8")) : null;
    fs.writeFileSync(path.join(SMOKE, "report.json"), JSON.stringify({
      errors, dataFile: dataFile(), savedAreas: saved && saved.areas.length, timerRunning: !!(saved && saved.timer), trayTip: timerInfo,
    }, null, 2));
  } catch (err) { fs.writeFileSync(path.join(SMOKE, "report.json"), JSON.stringify({ crash: String(err && err.stack || err), errors })); }
  quitting = true; app.exit(0);
}
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function popWindow() {
  showWindow();
  win.setAlwaysOnTop(true, "floating");
  setTimeout(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(false); }, 1500);
}
function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Открыть", click: showWindow },
    { label: "Запускать вместе с Windows", type: "checkbox", checked: getAutostart(), click: item => setAutostart(item.checked) },
    { type: "separator" },
    { label: "Выход", click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(icon("tray.png")));
  tray.setToolTip(APP_NAME);
  tray.on("click", showWindow);
  refreshTrayMenu();
}

app.on("second-instance", showWindow);
app.on("before-quit", () => { quitting = true; });
if (gotLock) app.whenReady().then(() => {
  loadPrefs();
  createWindow();
  createTray();
});
app.on("window-all-closed", () => { /* stay in tray */ });
