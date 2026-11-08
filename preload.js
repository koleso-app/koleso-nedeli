// The only bridge between the page and Windows. The page gets these functions and nothing else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("koleso", {
  load: () => ipcRenderer.invoke("data:load"),
  save: json => ipcRenderer.invoke("data:save", String(json)),
  saveSync: json => ipcRenderer.sendSync("data:save-sync", String(json)),
  exportData: json => ipcRenderer.invoke("data:export", String(json)),
  importData: () => ipcRenderer.invoke("data:import"),
  openDataFolder: () => ipcRenderer.invoke("data:open-folder"),
  timer: info => ipcRenderer.send("timer:update", info ? { start: +info.start, endsAt: +info.endsAt, label: String(info.label || ""), color: /^#[0-9a-fA-F]{6}$/.test(info.color) ? info.color : "#7A8794" } : null),
  notify: n => ipcRenderer.send("timer:notify", { title: String(n.title || ""), body: String(n.body || ""), popup: !!n.popup, next: n.next === undefined ? undefined : String(n.next) }),
  prefs: p => ipcRenderer.send("shell:prefs", { mini: !!(p && p.mini), theme: String((p && p.theme) || "dark") }),
  runningApps: pats => ipcRenderer.invoke("apps:running", (Array.isArray(pats) ? pats : []).slice(0, 20).map(String)),
  onCommand: cb => ipcRenderer.on("shell:cmd", (_e, c) => cb({ type: String((c && c.type) || "") })),
  secretGet: () => ipcRenderer.invoke("secret:get"),
  secretSet: cfg => ipcRenderer.invoke("secret:set", cfg ? { owner: String(cfg.owner), repo: String(cfg.repo), token: String(cfg.token), pass: String(cfg.pass) } : null),
  getAutostart: () => ipcRenderer.invoke("app:get-autostart"),
  setAutostart: on => ipcRenderer.invoke("app:set-autostart", !!on),
});
