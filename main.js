// Колесо недели — desktop shell: window, tray, notifications, local data file.
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, nativeTheme, shell, dialog, safeStorage, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

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
let mini = null, miniState = null, miniEnabled = true, miniDoneTimer = null;
const startHidden = process.argv.includes("--hidden");
const icon = file => path.join(__dirname, "app", "icons", file);

/* ---------- data file ---------- */
const dataDir = () => app.getPath("userData");
const dataFile = () => path.join(dataDir(), "koleso-data.json");
const prefsFile = () => path.join(dataDir(), "shell.json");

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, text, null, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function isPlannerJSON(text) {
  try { const d = JSON.parse(text); return d && typeof d === "object" && Array.isArray(d.areas); } catch { return false; }
}
// one dated copy per day (the first save of the day keeps yesterday's state), the last 14 days kept
let backupDay = "";
function dailyBackup() {
  const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (backupDay === day || !fs.existsSync(dataFile())) return;
  backupDay = day;
  try {
    const dir = path.join(dataDir(), "backups"), target = path.join(dir, `koleso-${day}.json`);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(target)) fs.copyFileSync(dataFile(), target);
    const old = fs.readdirSync(dir).filter(f => /^koleso-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -14);
    for (const f of old) fs.unlinkSync(path.join(dir, f));
  } catch {}
}
function saveData(text) {
  if (!isPlannerJSON(text)) throw new Error("неверный формат данных");
  if (text.length > 5 * 1024 * 1024) throw new Error("слишком большой файл");
  dailyBackup();
  writeAtomic(dataFile(), text);
}
function loadPrefs() { try { shellPrefs = JSON.parse(fs.readFileSync(prefsFile(), "utf8")) || {}; } catch { shellPrefs = {}; } }
function savePrefs() { try { writeAtomic(prefsFile(), JSON.stringify(shellPrefs)); } catch {} }

ipcMain.handle("data:load", () => {
  const file = dataFile();
  if (!fs.existsSync(file)) return { data: null, path: file };
  let text;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (e) { return { data: null, path: file, readError: e.code || e.message }; }   // e.g. locked by antivirus
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

/* ---------- which of the given programs are running (work-hours check); nothing leaves the PC ---------- */
ipcMain.handle("apps:running", (_e, pats) => new Promise(resolve => {
  const list = (Array.isArray(pats) ? pats : []).map(String).map(p => p.trim())
    .filter(p => /^[\w .*()+-]{1,60}$/.test(p))
    .map(p => ({ p, re: new RegExp("^" + p.replace(/[.+()]/g, "\\$&").replace(/\*/g, ".*") + "$", "i") }));
  if (!list.length) return resolve([]);
  execFile("tasklist", ["/FO", "CSV", "/NH"], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
    if (err) return resolve([]);
    const names = String(out).split(/\r?\n/).map(l => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean);
    resolve(list.filter(({ re }) => names.some(n => re.test(n))).map(({ p }) => p));
  });
}));
ipcMain.on("shell:prefs", (_e, p) => {
  miniEnabled = !!(p && p.mini);
  if (p && ["dark", "light", "auto"].includes(p.theme)) nativeTheme.themeSource = p.theme === "auto" ? "system" : p.theme;
  updateMini();
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
  if (timerInfo) { clearTimeout(miniDoneTimer); miniState = { mode: "run", label: timerInfo.label, color: timerInfo.color, start: timerInfo.start, endsAt: timerInfo.endsAt }; }
  else if (miniState && miniState.mode === "run") miniState = null;
  updateTimerShell(); updateMini();
});
ipcMain.on("timer:notify", (_e, n) => {
  if (Notification.isSupported()) {
    const toast = new Notification({ title: n.title || APP_NAME, body: n.body || "", icon: icon("icon.png"), silent: false });
    toast.on("click", showWindow);
    toast.show();
  }
  if (win) win.flashFrame(true);
  if (n.next !== undefined) {   // a block ended: the mini window turns into a gentle "time to switch"
    clearTimeout(miniDoneTimer);
    miniState = { mode: "done", label: n.title || "Пора переключиться", next: n.next || "" };
    miniDoneTimer = setTimeout(() => { if (miniState && miniState.mode === "done") { miniState = null; updateMini(); } }, 10 * 60000);
    updateMini();
  }
  if (n.popup && !miniEnabled) popWindow();
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

/* ---------- mini window: a small always-on-top timer while the main window is away ---------- */
const MINI_W = 252, MINI_H = 64;
function miniPosition() {
  const saved = shellPrefs.mini;
  const disp = saved ? screen.getDisplayMatching({ x: saved.x, y: saved.y, width: MINI_W, height: MINI_H }) : screen.getPrimaryDisplay();
  const wa = disp.workArea;
  const x = saved ? saved.x : wa.x + wa.width - MINI_W - 16, y = saved ? saved.y : wa.y + wa.height - MINI_H - 16;
  return { x: Math.min(Math.max(x, wa.x), wa.x + wa.width - MINI_W), y: Math.min(Math.max(y, wa.y), wa.y + wa.height - MINI_H) };
}
function createMini() {
  const p = miniPosition();
  mini = new BrowserWindow({
    width: MINI_W, height: MINI_H, x: p.x, y: p.y, frame: false, resizable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, show: false, alwaysOnTop: true, backgroundColor: "#1A2027", title: "Колесо недели — таймер",
    webPreferences: { preload: path.join(__dirname, "preload-mini.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  mini.setAlwaysOnTop(true, "floating");
  mini.loadFile(path.join(__dirname, "app", "mini.html"));
  mini.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mini.webContents.on("will-navigate", e => e.preventDefault());
  mini.on("moved", () => { if (!mini) return; const [x, y] = mini.getPosition(); shellPrefs.mini = { x, y }; savePrefs(); mini.setSize(MINI_W, MINI_H); });
  mini.on("closed", () => { mini = null; });
}
function sendMini() {
  if (!mini) return;
  const send = () => mini && mini.webContents.send("mini:state", miniState);
  if (mini.webContents.isLoading()) mini.webContents.once("did-finish-load", send); else send();
}
function updateMini() {
  if (!app.isReady()) return;
  const mainInFront = win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();
  const want = miniEnabled && miniState && !mainInFront;
  if (want) {
    if (!mini) createMini();
    sendMini();
    if (!mini.isVisible()) { const p = miniPosition(); mini.setPosition(p.x, p.y); mini.showInactive(); }
    mini.setAlwaysOnTop(true, "floating");
  } else if (mini && mini.isVisible()) mini.hide();
}
ipcMain.on("mini:open", () => { if (miniState && miniState.mode === "done") miniState = null; showWindow(); });
ipcMain.on("mini:stop", () => { if (win) win.webContents.send("shell:cmd", { type: "stop" }); });
ipcMain.on("mini:dismiss", () => { miniState = null; updateMini(); });
setInterval(() => { if (mini && mini.isVisible()) mini.setAlwaysOnTop(true, "floating"); }, 30000);

/* ---------- window + tray ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 840, minWidth: 380, minHeight: 500,
    title: APP_NAME, icon: icon("icon.png"), show: false, autoHideMenuBar: true,
    backgroundColor: "#12161B",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      backgroundThrottling: false, // the timer must keep ticking while minimised
      autoplayPolicy: "no-user-gesture-required",   // the end-of-block sound must play even if nobody clicked here
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
  win.on("focus", () => { win.flashFrame(false); updateMini(); });
  for (const ev of ["show", "hide", "minimize", "restore"]) win.on(ev, () => updateMini());
  win.on("blur", () => setTimeout(updateMini, 150));
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
    win.hide(); await wait(1500);
    if (mini) fs.writeFileSync(path.join(SMOKE, "6-mini.png"), (await mini.webContents.capturePage()).toPNG());
    win.show(); await wait(500);
    const saved = fs.existsSync(dataFile()) ? JSON.parse(fs.readFileSync(dataFile(), "utf8")) : null;
    fs.writeFileSync(path.join(SMOKE, "report.json"), JSON.stringify({
      errors, dataFile: dataFile(), savedAreas: saved && saved.areas.length, timerRunning: !!(saved && saved.timer), trayTip: timerInfo,
      miniShown: !!mini, miniHiddenAgain: !!mini && !mini.isVisible(),
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
app.on("ready", () => {
  screen.on("display-removed", () => { if (mini && mini.isVisible()) { const p = miniPosition(); mini.setPosition(p.x, p.y); } });
  screen.on("display-metrics-changed", () => { if (mini && mini.isVisible()) { const p = miniPosition(); mini.setPosition(p.x, p.y); } });
});
app.on("before-quit", () => { quitting = true; });
if (gotLock) app.whenReady().then(() => {
  loadPrefs();
  createWindow();
  createTray();
});
app.on("window-all-closed", () => { /* stay in tray */ });
