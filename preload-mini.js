// Bridge for the mini timer window: it can only show state and ask the main process to act.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mini", {
  onState: cb => ipcRenderer.on("mini:state", (_e, s) => cb(s && typeof s === "object" ? {
    mode: s.mode === "done" ? "done" : "run", label: String(s.label || ""), next: String(s.next || ""),
    color: /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : "#7A8794", start: +s.start || 0, endsAt: +s.endsAt || 0,
  } : null)),
  open: () => ipcRenderer.send("mini:open"),
  stop: () => ipcRenderer.send("mini:stop"),
  dismiss: () => ipcRenderer.send("mini:dismiss"),
});
