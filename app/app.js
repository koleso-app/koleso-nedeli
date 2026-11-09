(() => {
"use strict";
/* ---------- utils ---------- */
const DAYS = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
const DAYS_FULL = ["понедельник","вторник","среда","четверг","пятница","суббота","воскресенье"];
const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
const COLORS = ["#3D8BD9","#2A9D8F","#E9B44C","#8E6CCF","#E07A5F","#D16BA5","#5BAA4E","#7A8794","#4F6D7A"];
const WORK_COLOR = "#4F6D7A";
const uid = () => Math.random().toString(36).slice(2, 9);
const pad = n => String(n).padStart(2, "0");
const key = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const dayIdx = d => (d.getDay() + 6) % 7;
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const weekStart = d => addDays(d, -dayIdx(d));
function isoWeek(d){ const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = new Date(Date.UTC(t.getUTCFullYear(),0,1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); }
function fmt(m){ m = Math.round(m); if (m <= 0) return "0 мин"; const h = Math.floor(m/60), r = m % 60; if (!h) return r + " мин"; if (!r) return h + " ч"; return h + " ч " + r + " мин"; }
function fmtH(m){ const h = m/60; return (Math.round(h*10)/10).toString().replace(".", ",") + " ч"; }
const hm = s => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0)*60 + (m || 0); };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $ = s => document.querySelector(s);
function stable(v){ if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]"; if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}"; return JSON.stringify(v); }
const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const S = window.KolesoSync || null;   // sync.js
const bridge = window.koleso || null;  // preload.js in the Windows app
const isPhoneLike = !bridge;

/* ---------- state ---------- */
const WORK_AREA = () => ({ id: "work", name: "Работа", color: WORK_COLOR, goal: 40, mini: "", active: true, kind: "work", breakOk: false });
function starter(){
  const A = [
    ["en","Английский","#3D8BD9",3,"15 минут: слова в приложении или эпизод подкаста",true],
    ["go","Го","#7A8794",2,"Один урок правил или 3 задачи-цумего",true],
    ["books","Книги","#E9B44C",3,"10 страниц",true],
    ["games","Игры","#8E6CCF",0,"",false,90],
    ["dev","Своя игра","#2A9D8F",4,"25 минут на одну маленькую задачу",false],
  ];
  return normalize({
    started: true,
    areas: [WORK_AREA(), ...A.map(([id,name,color,goal,mini,breakOk,cap]) => ({id,name,color,goal,mini,active:true,kind:"hobby",breakOk,cap:cap||0}))],
    theme: {0:["en","dev"],1:["go","books"],2:["en","dev"],3:["go","books"],4:["games","books"],5:["dev","games"],6:["books","go"]},
    settings: { workAdded: true, capsAdded: true },
  });
}
// everything that comes from storage, sync or an imported file is checked before use
const sid = v => String(v ?? "").replace(/[^\w.:-]/g, "_").slice(0, 48);
const okColor = c => (/^#[0-9a-fA-F]{6}$/.test(String(c)) ? String(c) : COLORS[0]);
const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const okTime = (v, d) => (/^\d{2}:\d{2}$/.test(String(v)) ? String(v) : d);
const okDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
const arr = v => (Array.isArray(v) ? v : []);
const stamps = o => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([k, v]) => typeof k === "string" && Number.isFinite(v)));
function normalize(s){
  s = s && typeof s === "object" ? s : {};
  const areas = arr(s.areas).filter(a => a && a.id).map(a => ({
    id: sid(a.id), name: String(a.name ?? "").slice(0, 120), color: okColor(a.color), goal: num(a.goal, 0, 0, 80), cap: num(a.cap, 0, 0, 1440),
    mini: String(a.mini || "").slice(0, 120), active: a.active !== false, kind: a.kind === "work" ? "work" : "hobby",
    breakOk: typeof a.breakOk === "boolean" ? a.breakOk : (a.kind !== "work" && !/игр/i.test(a.name || "")),
  }));
  const st = s.settings && typeof s.settings === "object" ? s.settings : {};
  const sw = st.work && typeof st.work === "object" ? st.work : {};
  const meta = s.meta && typeof s.meta === "object" ? s.meta : {};
  const theme = {}; for (let i = 0; i < 7; i++) theme[i] = arr((s.theme || {})[i]).map(sid);
  const checks = {};
  for (const [d, list] of Object.entries(s.checks && typeof s.checks === "object" ? s.checks : {})) if (okDate(d)) checks[d] = arr(list).map(sid);
  const t = s.timer && typeof s.timer === "object" && Number.isFinite(Number(s.timer.start)) ? s.timer : null;
  return {
    v: 2,
    started: !!s.started || areas.length > 0,
    areas,
    theme,
    logs: arr(s.logs).filter(l => l && okDate(l.d)).map(l => ({ id: sid(l.id) || uid(), a: sid(l.a), d: l.d, m: num(l.m, 0, 0, 1440) })),
    checks,
    ideas: arr(s.ideas).filter(i => i && i.id).map(i => ({ id: sid(i.id), t: String(i.t ?? "").slice(0, 200) })),
    tasks: arr(s.tasks).filter(k => k && k.id && okDate(k.d)).map(k => ({ id: sid(k.id), d: k.d, t: String(k.t ?? "").slice(0, 200), done: !!k.done })),
    off: arr(s.off).filter(okDate),
    settings: {
      block: num(st.block, 45, 5, 240), maxExt: num(st.maxExt, 1, 0, 5), freeWeekday: num(st.freeWeekday, 3, 0, 24), freeWeekend: num(st.freeWeekend, 8, 0, 24),
      popup: st.popup !== false, mini: st.mini !== false, workAdded: !!st.workAdded, capsAdded: !!st.capsAdded,
      theme: ["dark", "light", "auto"].includes(st.theme) ? st.theme : "dark",
      watch: (st.watch === undefined || st.watch === "Unity.exe, Godot*.exe" ? "" : String(st.watch)).slice(0, 300),
      work: {
        on: sw.on !== false, days: (Array.isArray(sw.days) ? sw.days : [0,1,2,3,4]).map(Number).filter(d => d >= 0 && d <= 6),
        from: okTime(sw.from, "10:00"), to: okTime(sw.to, "19:00"), block: num(sw.block, 50, 10, 240), brk: num(sw.brk, 10, 3, 60),
      },
    },
    timer: t ? { a: t.a ? sid(t.a) : null, start: Number(t.start), dur: num(t.dur, 25, 1, 600), kind: t.kind === "break" ? "break" : "focus", ext: num(t.ext, 0, 0, 10), ret: !!t.ret } : null,
    meta: { u: stamps(meta.u), del: stamps(meta.del) },
  };
}
// change stamps for sync (see sync.js)
let clockMax = 0;
function noteStamps(st){ if (!st) return; for (const o of [st.meta.u, st.meta.del]) for (const v of Object.values(o)) if (v > clockMax) clockMax = v; }
function stampNow(){ const t = Math.max(Date.now(), clockMax + 1); clockMax = t; return t; }
function touch(...keys){ const t = stampNow(); for (const k of keys) state.meta.u[k] = t; }
function touchAt(k, t){ state.meta.u[k] = Math.max(state.meta.u[k] || 0, t); }
function tomb(k){ state.meta.del[k] = stampNow(); delete state.meta.u[k]; }
function stampAll(){
  const t = stampNow(), u = state.meta.u;
  for (const k of Object.keys(state.settings)) if (k !== "work") u["s:" + k] = t;
  for (const k of Object.keys(state.settings.work)) u["s:work." + k] = t;
  for (let d = 0; d < 7; d++) u["theme:" + d] = t;
  for (const a of state.areas) u["a:" + a.id] = t;
  for (const l of state.logs) u["l:" + l.id] = t;
  for (const i of state.ideas) u["i:" + i.id] = t;
  for (const k of state.tasks) u["k:" + k.id] = t;
  for (const [d, arr] of Object.entries(state.checks)) for (const a of arr) u["c:" + d + "|" + a] = t;
  for (const d of state.off) u["o:" + d] = t;
  u.theme = u.settings = u.timer = u.order = t;
}

/* ---------- local storage: file (Windows app) or browser ---------- */
const LS = "koleso-nedeli-v1", LS_SYNC = "koleso-sync";
let state = null, ready = false, saveTimer = null, storeNote = "", dataPath = "", autostart = false, loadFailed = "", saveWarned = 0;
function readLocal(){ try { const s = localStorage.getItem(LS); return s ? normalize(JSON.parse(s)) : null; } catch(e){ return null; } }
function prune(){ S.compact(state); }   // same rule as the merge, so pruned history never comes back
function persist(){
  if (!state) return;
  if (!bridge){
    try { localStorage.setItem(LS, JSON.stringify(state)); }
    catch(e){ if (Date.now() - saveWarned > 60000){ saveWarned = Date.now(); toast("Не удалось сохранить на этом устройстве: нет места или включён приватный режим. Скачайте резервную копию во вкладке «Занятия»."); } }
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
function flush(){
  clearTimeout(saveTimer); saveTimer = null;
  if (!bridge || !state) return;
  bridge.save(JSON.stringify(state)).catch(e => toast("Не удалось сохранить: " + ((e && e.message) || "ошибка диска")));
}
function save(){ if (!state) return; prune(); persist(); scheduleSync(); }
window.addEventListener("beforeunload", () => { if (bridge && saveTimer && state){ clearTimeout(saveTimer); bridge.saveSync(JSON.stringify(state)); } });

/* ---------- sync ---------- */
let syncCfg = null, syncing = false, syncAgain = false, syncTimer = null, syncPending = false, syncAttempted = false;
let syncStatus = { state: "off", msg: "", at: 0 };
async function loadSyncCfg(){
  if (bridge){ try { return await bridge.secretGet(); } catch(e){ return null; } }
  try { return JSON.parse(localStorage.getItem(LS_SYNC) || "null"); } catch(e){ return null; }
}
async function storeSyncCfg(c){
  if (bridge) return bridge.secretSet(c);
  try { if (c) localStorage.setItem(LS_SYNC, JSON.stringify(c)); else localStorage.removeItem(LS_SYNC); } catch(e){}
}
function scheduleSync(){ if (!syncCfg) return; syncPending = true; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 4000); }
function syncSoon(){ if (!syncCfg) return; clearTimeout(syncTimer); syncNow(); }   // timer starts and stops reach other devices at once
async function syncNow(cfg){
  const c = cfg || syncCfg;
  if (!S || !c) return false;
  if (syncing){ syncAgain = true; return false; }
  syncing = true; syncPending = false; clearTimeout(syncTimer);
  syncStatus = Object.assign({}, syncStatus, { state: "busy" }); renderSyncStatus();
  let ok = false;
  try {
    for (let attempt = 0; attempt < 4; attempt++){
      const { env, sha } = await S.pull(c);
      const remote = env ? normalize(await S.open(env, c.pass)) : null;
      const merged = remote ? normalize(S.merge(state || normalize({}), remote)) : state;
      if (merged && stable(merged) !== stable(state)){
        state = merged; noteStamps(state); persist(); if (!editingNow()) render(); syncTimerToShell();
      }
      if (!state || (remote && stable(remote) === stable(state))) { ok = true; break; }
      const snapshot = JSON.parse(JSON.stringify(state));
      if (await S.push(c, await S.seal(snapshot, c.pass, env && env.salt), sha)) { ok = true; break; }
    }
    syncStatus = ok ? { state: "ok", msg: "", at: Date.now() } : { state: "error", msg: "Не получилось записать: другое устройство меняет данные. Попробую ещё раз.", at: syncStatus.at };
  } catch(e){
    syncStatus = { state: "error", msg: (e && e.message) || String(e), at: syncStatus.at, code: e && e.code };
  }
  syncing = false; syncAttempted = true; renderSyncStatus();
  if (syncAgain){ syncAgain = false; setTimeout(syncNow, 500); }
  return ok;
}
setInterval(() => { if (syncCfg && (bridge || !document.hidden)) syncNow(); }, 120000);
window.addEventListener("online", () => syncNow());

/* ---------- boot ---------- */
async function boot(){
  if (bridge){
    try {
      const r = await bridge.load();
      dataPath = r.path || "";
      if (r.readError) loadFailed = r.readError;
      else {
        state = r.data ? normalize(r.data) : null;
        if (r.error) storeNote = "Файл данных был повреждён — сохранена его копия, начинаем заново. " + r.error;
      }
    } catch(e){ loadFailed = (e && e.message) || String(e); }
    if (loadFailed){ ready = true; render(); return; }   // never offer a fresh start over data we could not read
    try { autostart = await bridge.getAutostart(); } catch(e){}
    ensureAudio();   // so a block started on the phone can ring here without a click
    bridge.onCommand(c => { if (c.type === "stop" && state && state.timer) stopTimer(false); });
  } else {
    state = readLocal();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch(e){}
  }
  if (state) noteStamps(state);
  // add the work area once for people who started before work mode existed
  if (state && state.started && !state.settings.workAdded){
    if (!state.areas.some(a => a.kind === "work")){ state.areas.unshift(WORK_AREA()); touch("a:work", "order"); }
    state.settings.workAdded = true; touch("s:workAdded"); save();
  }
  // games get a daily cap instead of a weekly goal, once (it was pushing towards more gaming)
  if (state && state.started && !state.settings.capsAdded){
    for (const a of state.areas) if (a.kind !== "work" && /^игры$/i.test(a.name.trim()) && !a.cap){ a.cap = 90; a.goal = 0; a.mini = ""; touch("a:" + a.id); capsNote = true; }
    state.settings.capsAdded = true; touch("s:capsAdded"); save();
  }
  if (state) applyTheme();
  syncCfg = await loadSyncCfg();
  ready = true;
  render(); tick(); syncTimerToShell();
  if (syncCfg) syncNow();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
function syncTimerToShell(){
  if (!bridge) return;
  const t = state && state.timer;
  if (!t){ bridge.timer(null); return; }
  const a = t.a ? areaById(t.a) : null;
  bridge.timer({ start: t.start, endsAt: t.start + t.dur*60000, label: t.kind === "break" ? "Перерыв" : (a ? a.name : "Занятие"), color: t.kind === "break" ? "#7A8794" : (a ? a.color : "#7A8794") });
}
function editingNow(){ const a = document.activeElement; return a && a.closest && a.closest("#main, #overlay-root") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }

/* ---------- derived ---------- */
const today = () => new Date();
const todayKey = () => key(today());
const areaById = id => state.areas.find(a => a.id === id);
const activeAreas = () => state.areas.filter(a => a.active);
const hobbies = () => activeAreas().filter(a => a.kind !== "work");
const workArea = () => state.areas.find(a => a.kind === "work" && a.active);
const W = () => state.settings.work;
const isOff = d => state.off.includes(key(d));
const isWorkday = d => !!(W().on && workArea() && W().days.includes(dayIdx(d)) && !isOff(d));
function inWork(d){
  d = d || new Date();
  const f = hm(W().from), t = hm(W().to), m = d.getHours()*60 + d.getMinutes();
  if (f < t) return isWorkday(d) && m >= f && m < t;
  if (f === t) return false;
  return (isWorkday(d) && m >= f) || (isWorkday(addDays(d, -1)) && m < t);   // a shift that crosses midnight
}
function todayMinutes(aid){
  const tk = todayKey(), t = state.timer;
  return state.logs.filter(l => l.d === tk && l.a === aid).reduce((s, l) => s + l.m, 0)
    + (t && t.a === aid && t.kind === "focus" ? Math.floor((Date.now() - t.start) / 60000) : 0);
}
const tasksFor = d => state.tasks.filter(t => t.d === d);
function weekRange(offset){ const s = addDays(weekStart(today()), offset*7); return { start: s, keys: [...Array(7)].map((_,i) => key(addDays(s,i))) }; }
function minutesByArea(keys){ const set = new Set(keys), m = {}; for (const l of state.logs) if (set.has(l.d)) m[l.a] = (m[l.a]||0) + l.m; return m; }
function minutesGrid(keys){ const idx = Object.fromEntries(keys.map((k,i)=>[k,i])), g = {}; for (const l of state.logs){ if (l.d in idx){ (g[l.a] = g[l.a] || Array(7).fill(0))[idx[l.d]] += l.m; } } return g; }
function streak(aid){
  let d = today(), n = 0;
  const has = dd => (state.checks[key(dd)] || []).includes(aid);
  if (!has(d)) d = addDays(d, -1);
  while (has(d)){ n++; d = addDays(d, -1); }
  return n;
}
function lastAreaToday(){ const t = todayKey(); const ls = state.logs.filter(l => l.d === t); return ls.length ? ls[ls.length-1].a : null; }

// What to do next. During work hours that is work; a break suggests something short.
function suggest(exclude, forBreak){
  const wa = workArea();
  if (!forBreak && inWork() && wa && wa.id !== exclude){
    const left = tasksFor(todayKey()).filter(t => !t.done).length;
    return { area: wa, work: true, dur: W().block,
      why: `Рабочее время до ${W().to}. ` + (left ? `Незакрытых задач на сегодня: ${left}.` : "Запиши 1–3 главные задачи на сегодня.") };
  }
  const t = dayIdx(today());
  const done = minutesByArea(weekRange(0).keys);
  const theme = state.theme[t] || [];
  const last = lastAreaToday();
  let best = null;
  for (const a of hobbies()){
    if (a.id === exclude || !(a.goal > 0)) continue;
    if (forBreak && !a.breakOk) continue;
    if (a.cap > 0 && todayMinutes(a.id) >= a.cap) continue;
    const goalM = a.goal * 60, d = done[a.id] || 0;
    const expected = goalM * (t + 1) / 7;
    let score = expected - d;
    const inTheme = theme.includes(a.id);
    if (inTheme) score += 45;
    if (a.id === last) score -= 60;
    if (d >= goalM) score -= 10000;
    if (!best || score > best.score) best = { a, score, inTheme, deficit: expected - d, left: goalM - d, met: d >= goalM };
  }
  if (!best) return null;
  if (forBreak) return { area: best.a, dur: W().brk, why: best.a.mini ? "Мини-шаг: " + best.a.mini : "Короткий подход на " + W().brk + " минут." };
  let why;
  if (best.met) why = "Все цели недели выполнены. Можно отдохнуть или выбрать что угодно.";
  else if (best.inTheme && best.deficit > 0) why = "Тема сегодняшнего дня. До плана недели не хватает " + fmt(best.deficit) + ".";
  else if (best.inTheme) why = "Тема сегодняшнего дня. До цели недели осталось " + fmt(best.left) + ".";
  else if (best.deficit > 0) why = "Отстаёт от плана недели на " + fmt(best.deficit) + ".";
  else why = "До цели недели осталось " + fmt(best.left) + ".";
  return { area: best.a, why, dur: state.settings.block };
}

/* ---------- timer ---------- */
let audioCtx = null, overlay = null, guard = null, finishing = false, wakeLock = null, lastFinish = null, capsNote = false;
function ensureAudio(){ try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch(e){} }
function beep(){
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    [0, .28, .56].forEach((dt, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = i === 2 ? 880 : 660;
      g.gain.setValueAtTime(0.0001, t0+dt); g.gain.exponentialRampToValueAtTime(0.25, t0+dt+.02); g.gain.exponentialRampToValueAtTime(0.0001, t0+dt+.24);
      o.connect(g).connect(audioCtx.destination); o.start(t0+dt); o.stop(t0+dt+.26);
    });
  } catch(e){}
}
function addLog(aid, m, d, id, at){
  if (!aid || m < 1) return;
  id = id || uid();
  if (state.logs.some(l => l.id === id)) return;
  state.logs.push({ id, a: aid, d: d || todayKey(), m: Math.round(m) });
  if (at) touchAt("l:" + id, at); else touch("l:" + id);
}
// starting a block goes through the guards: work hours, the daily cap, the same thing again right away
function requestStart(aid, dur, force){
  const a = areaById(aid); if (!a) return;
  dur = Number(dur);
  if (!force){
    if (a.kind !== "work" && inWork()){ guard = { a: aid, why: "work" }; render(); return; }
    if (a.cap > 0 && todayMinutes(aid) >= a.cap){ guard = { a: aid, why: "cap" }; render(); return; }
    if (a.kind !== "work" && lastFinish && lastFinish.a === aid && Date.now() - lastFinish.at < 15*60000){ guard = { a: aid, why: "again", dur }; render(); return; }
    if (a.cap > 0){ const left = a.cap - todayMinutes(aid); if (left < dur){ dur = Math.max(5, left); toast("Блок укорочен до дневного лимита: " + fmt(dur)); } }
  }
  startTimer(aid, dur, "focus", 0, false);
}
function startTimer(aid, dur, kind, ext, ret){
  ensureAudio();
  if (state.timer) stopTimer(true);
  picked = null;
  state.timer = { a: aid || null, start: Date.now(), dur: Number(dur), kind: kind || "focus", ext: ext || 0, ret: !!ret };
  touch("timer"); overlay = null; guard = null; save(); render(); syncTimerToShell(); syncSoon();
}
function stopTimer(silent){
  const t = state.timer; if (!t) return;
  const mins = Math.min(t.dur, Math.floor((Date.now() - t.start) / 60000));
  if (t.kind === "focus") addLog(t.a, mins, key(new Date(t.start)), "t" + t.start);
  state.timer = null; touch("timer"); document.title = "Колесо недели";
  if (!silent){ save(); render(); syncTimerToShell(); syncSoon(); if (t.kind === "focus") toast(mins >= 1 ? "Записано: " + fmt(mins) : "Меньше минуты — не записываю"); }
}
function finishTimer(){
  const t = state.timer; if (!t || finishing) return;
  finishing = true;
  // stamp with the moment the block really ended, so a device that wakes up late
  // cannot override a block started elsewhere since then
  const end = t.start + t.dur*60000;
  if (t.kind === "focus") addLog(t.a, t.dur, key(new Date(t.start)), "t" + t.start, end);
  state.timer = null; touchAt("timer", end);
  const a = areaById(t.a);
  const late = Date.now() - end > 90000;          // the app was closed when the timer ran out
  const veryLate = Date.now() - end > 10*60000;
  if (t.kind === "focus" && a && a.kind !== "work" && !t.ret) lastFinish = { a: t.a, at: end };
  save(); syncTimerToShell(); syncSoon();
  if (veryLate){
    if (t.kind === "focus") toast(`Блок «${a ? a.name : "Занятие"}» закончился, пока приложение было закрыто — записано ${fmt(t.dur)}.`);
    render(); finishing = false; return;
  }
  overlay = { kind: t.kind, a: t.a, dur: t.dur, ext: t.ext, ret: t.ret, wasWork: !!(a && a.kind === "work") };
  beep(); render();
  try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch(e){}
  document.title = "Пора переключиться · Колесо недели";
  if (bridge && !late){
    const nx = nextAfter(overlay);
    bridge.notify({
      title: overlay.wasWork ? "Перерыв!" : (t.kind === "focus" ? "Пора переключиться" : "Перерыв окончен"),
      body: (t.kind === "focus" ? `«${a ? a.name : "Занятие"}» — ${fmt(t.dur)} записано.` : "Возвращаемся.") + (nx.main ? ` Дальше: ${nx.main.area.name}.` : ""),
      next: nx.main ? nx.main.area.name : "",
      popup: !!state.settings.popup,
    });
  }
  finishing = false;
}
// what the "block finished" card offers
function nextAfter(o){
  const working = inWork();
  if (o.wasWork && working) return { title: "Пора на перерыв", main: suggest(null, true), isBreak: true };
  if (working) return { title: "Возвращаемся к работе", main: suggest(o.a) };
  return { title: o.kind === "focus" ? "Пора переключиться" : "Перерыв окончен", main: suggest(o.kind === "focus" ? o.a : null) };
}
function tick(){
  if (!state || !state.timer) return;
  const t = state.timer, total = t.dur * 60000, left = t.start + total - Date.now();
  if (left <= 0){
    // overdue while this device was asleep: ask the other devices first, they may have stopped it
    if (syncCfg && !syncAttempted && -left > 90000){ if (!syncing) syncNow(); return; }
    finishTimer(); return;
  }
  const s = Math.ceil(left / 1000), el = $("#clock"), bar = $("#tbar");
  if (el) el.textContent = pad(Math.floor(s/60)) + ":" + pad(s % 60);
  if (bar) bar.style.width = (100 * (1 - left/total)).toFixed(2) + "%";
}
setInterval(tick, 1000);
// phone: keep the screen on while a block runs, so the signal is not missed
async function updateWakeLock(){
  const want = !bridge && state && state.timer && !document.hidden;
  try {
    if (want && !wakeLock && navigator.wakeLock){ wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); }
    else if (!want && wakeLock){ await wakeLock.release(); wakeLock = null; }
  } catch(e){}
}

/* ---------- wheel ---------- */
function sector(cx, cy, r0, r1, a0, a1){
  const p = (r, a) => (cx + r*Math.sin(a)).toFixed(2) + " " + (cy - r*Math.cos(a)).toFixed(2);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1,a0)} A${r1} ${r1} 0 ${large} 1 ${p(r1,a1)} L${p(r0,a1)} A${r0} ${r0} 0 ${large} 0 ${p(r0,a0)} Z`;
}
function wheelSVG(areas, done){
  const cx = 120, cy = 120, r0 = 36, rmax = 112, n = areas.length;
  if (!n) return "";
  const gap = n > 1 ? 0.035 : 0, step = (Math.PI*2) / n;
  let bg = "", fg = "", marks = "", sumGoal = 0, sumDone = 0;
  areas.forEach((a, i) => {
    const a0 = i*step + gap, a1 = (i+1)*step - gap - (n === 1 ? 0.0001 : 0);
    const goalM = a.goal*60, d = done[a.id] || 0, f = goalM > 0 ? Math.min(d/goalM, 1) : 0;
    sumGoal += goalM; sumDone += Math.min(d, goalM);
    bg += `<path d="${sector(cx,cy,r0,rmax,a0,a1)}" fill="${a.color}" fill-opacity="0.14"/>`;
    if (f > 0) fg += `<path d="${sector(cx,cy,r0,r0+(rmax-r0)*f,a0,a1)}" fill="${a.color}"><title>${esc(a.name)}: ${fmt(d)} из ${fmt(goalM)}</title></path>`;
    if (goalM > 0 && d > goalM){ const m = (a0+a1)/2; marks += `<circle cx="${(cx+(rmax+5)*Math.sin(m)).toFixed(1)}" cy="${(cy-(rmax+5)*Math.cos(m)).toFixed(1)}" r="3" fill="${a.color}"/>`; }
  });
  const pct = sumGoal ? Math.round(100*sumDone/sumGoal) : 0;
  const halfR = r0 + (rmax-r0)/2;
  return `<svg viewBox="-4 -4 248 248" role="img" aria-label="Колесо недели: выполнено ${pct}% целей">
    <circle cx="${cx}" cy="${cy}" r="${halfR}" fill="none" stroke="var(--line)" stroke-dasharray="2 4"/>
    ${bg}${fg}${marks}
    <circle cx="${cx}" cy="${cy}" r="${r0-4}" fill="var(--surface)"/>
    <text x="${cx}" y="${cy+2}" text-anchor="middle" font-family="var(--f-num)" font-weight="700" font-size="20" fill="var(--ink)">${pct}%</text>
    <text x="${cx}" y="${cy+17}" text-anchor="middle" font-family="var(--f-ui)" font-size="9" fill="var(--muted)">целей</text>
  </svg>`;
}
function legendHTML(areas, done, dayI){
  return areas.map(a => {
    const goalM = a.goal*60, d = done[a.id] || 0, expected = goalM*(dayI+1)/7;
    const cls = goalM && d >= goalM ? "met" : (goalM && dayI !== null && d < expected - 30 ? "behind" : "");
    return `<div class="row ${cls}"><span class="dot" style="background:${a.color}"></span><span class="nm">${esc(a.name)}</span><span class="v">${fmtH(d)} / ${fmtH(goalM)}</span></div>`;
  }).join("");
}
function workBar(done){
  const wa = workArea(); if (!wa || !(wa.goal > 0)) return "";
  const d = done[wa.id] || 0, f = Math.min(1, d / (wa.goal*60));
  return `<div class="workbar"><div class="wb-head"><span><span class="dot" style="background:${wa.color}"></span> ${esc(wa.name)} за неделю</span><span class="num small">${fmtH(d)} / ${fmtH(wa.goal*60)}</span></div><div class="wb-track"><i style="width:${(f*100).toFixed(1)}%;background:${wa.color}"></i></div></div>`;
}

/* ---------- views ---------- */
let tab = "today", weekOffset = 0, confirmDel = null, picked = null;

function viewOnboard(){
  return `<div class="onboard">
    <span class="label">Начало</span>
    <h1>Неделя, в которой хватает места всему</h1>
    <p>Здесь будет колесо твоей недели: у каждого занятия свой сектор, и он заполняется по мере того, как ты на него тратишь время. В рабочие часы приложение держит фокус на работе, а хобби оставляет на перерывы и вечер.</p>
    <p class="muted">Стартовый набор: работа, английский, го, книги, игры и своя игра. Всё потом можно поменять.</p>
    <div class="btn-row">
      <button class="btn primary" data-act="seed" ${ready ? "" : "disabled"}>Создать мой набор</button>
      <button class="btn" data-act="blank" ${ready ? "" : "disabled"}>Начать с пустого</button>
    </div>
    ${S ? `<details class="panel" ${syncCfg ? "open" : ""}><summary><b>Уже пользуюсь на другом устройстве</b></summary><div style="margin-top:12px">${viewSyncBody()}</div></details>` : ""}
  </div>`;
}

function viewNextCard(){
  const t = state.timer;
  if (t){
    const a = areaById(t.a);
    const isBreak = t.kind === "break";
    const total = t.dur*60000, left = Math.max(0, t.start + total - Date.now()), s = Math.ceil(left/1000);
    return `<section class="panel next ${isBreak ? "is-break" : ""} ${a && a.kind === "work" ? "is-work" : ""}" aria-live="polite">
      <div class="ring"></div>
      <span class="label">${isBreak ? "Перерыв" : t.ret ? "Перерыв с пользой" : "Идёт блок" + (t.ext ? " · продление" : "")}</span>
      <h2>${isBreak ? "Отдых" : esc(a ? a.name : "Занятие")}</h2>
      <div class="clock" id="clock">${pad(Math.floor(s/60))}:${pad(s%60)}</div>
      <div class="bar"><i id="tbar" style="width:${(100*(1-left/total)).toFixed(2)}%"></i></div>
      <p class="why small" style="margin-top:10px">${isBreak ? "Встань, попей воды, посмотри в окно." : t.ret ? "По сигналу — обратно к работе." : "По сигналу — смена занятия. Время запишется само."}</p>
      ${isPhoneLike ? '<p class="small" style="opacity:.75;margin-top:4px">Экран не погаснет, пока идёт блок. Если свернуть приложение, сигнал прозвучит, когда вернёшься.</p>' : ""}
      <div class="btn-row" style="margin-top:14px">
        <button class="btn" data-act="stop">${isBreak ? "Закончить перерыв" : "Завершить и записать"}</button>
      </div>
    </section>`;
  }
  const hint = suggest();
  if (!hint) return `<section class="panel next"><div class="ring"></div><span class="label">Что дальше</span><h2>Добавь занятия</h2><p class="why">Во вкладке «Занятия» задай интересы и цели на неделю — тогда здесь появится подсказка.</p><div class="btn-row" style="margin-top:14px"><a class="btn solid" href="#areas">Открыть «Занятия»</a></div></section>`;
  // an activity chosen in the list takes over the whole card, so every button starts what you picked
  const pa = picked && areaById(picked);
  const own = !!(pa && pa.active && pa.id !== hint.area.id);
  if (!own) picked = null;
  const sg = own ? { area: pa, work: pa.kind === "work", dur: pa.kind === "work" ? W().block : state.settings.block } : hint;
  const b = sg.dur;
  const opts = activeAreas().map(a => `<option value="${a.id}" ${a.id === sg.area.id ? "selected" : ""}>${esc(a.name)}${a.id === hint.area.id ? " — подсказка" : ""}</option>`).join("");
  return `<section class="panel next ${sg.work ? "is-work" : ""}">
    <div class="ring"></div>
    <span class="label">${own ? "Твой выбор" : sg.work ? "Сейчас — работа" : "Что дальше"}</span>
    <h2>${esc(sg.area.name)}</h2>
    <p class="why">${own ? `Подсказка была: «${esc(hint.area.name)}». <button class="linkbtn" data-act="unpick">Вернуть</button>` : esc(sg.why)}</p>
    ${sg.area.mini ? `<div class="mini small"><b>Мини-шаг:</b> ${esc(sg.area.mini)}</div>` : ""}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn solid" data-act="start" data-a="${sg.area.id}" data-dur="${b}">Старт · ${b} мин</button>
      ${sg.work || b === 25 ? "" : `<button class="btn" data-act="start" data-a="${sg.area.id}" data-dur="25">25 мин</button>`}
      ${b === 15 ? "" : `<button class="btn" data-act="start" data-a="${sg.area.id}" data-dur="15">15 мин</button>`}
    </div>
    <div class="btn-row" style="margin-top:10px">
      <label class="small" for="pick-area" style="opacity:.8">Выбрать другое:</label>
      <select class="input small" id="pick-area">${opts}</select>
    </div>
  </section>`;
}

function viewWork(){
  const wa = workArea(); if (!wa || !W().on) return "";
  const d = today(), tk = todayKey();
  if (!W().days.includes(dayIdx(d)) && !tasksFor(tk).length) return "";
  if (isOff(d)) return `<section class="panel"><div class="head"><h3>Работа</h3><span class="chip">выходной</span></div>
    <p class="small muted">Сегодня отмечен как нерабочий — подсказки только про хобби.</p>
    <div class="btn-row" style="margin-top:10px"><button class="btn small" data-act="offday">Всё-таки работаю</button></div></section>`;
  const m = d.getHours()*60 + d.getMinutes();
  const phase = !W().days.includes(dayIdx(d)) ? "" : m < hm(W().from) ? `<span class="chip">с ${W().from}</span>` : m < hm(W().to) ? `<span class="chip on">рабочее время до ${W().to}</span>` : `<span class="chip">рабочий день закончен</span>`;
  const list = tasksFor(tk);
  const workedToday = state.logs.filter(l => l.d === tk && l.a === wa.id).reduce((s,l) => s + l.m, 0);
  const carry = state.tasks.filter(t => !t.done && t.d < tk && t.d >= key(addDays(d, -7)));
  return `<section class="panel">
    <div class="head"><h3>Работа · ${W().from}–${W().to}</h3>${phase}</div>
    <p class="small muted" style="margin-bottom:8px">Сегодня в работе: <span class="num">${fmt(workedToday)}</span></p>
    <div class="checks">${list.map(t => `<div class="check ${t.done ? "done" : ""}" style="--c:${wa.color}">
        <button class="box" data-act="task" data-id="${t.id}" aria-pressed="${!!t.done}" aria-label="Задача выполнена">${CHECK_SVG}</button>
        <div class="t"><span class="m">${esc(t.t)}</span></div>
        <button class="x" data-act="del-task" data-id="${t.id}" aria-label="Удалить задачу">×</button>
      </div>`).join("") || '<p class="small muted">Утром запиши 1–3 главные рабочие задачи. Своя игра — когда они закрыты или рабочий день закончился.</p>'}</div>
    <form class="btn-row" data-form="task" style="margin-top:10px">
      <input class="input" id="task-in" placeholder="Главная задача на сегодня" style="flex:1;min-width:160px" aria-label="Новая рабочая задача" maxlength="200">
      <button class="btn small" type="submit">Добавить</button>
    </form>
    <div class="btn-row" style="margin-top:10px">
      ${carry.length ? `<button class="btn small" data-act="carry">Перенести незаконченные (${carry.length})</button>` : ""}
      <button class="btn small ghost" data-act="offday">Сегодня не работаю</button>
    </div>
  </section>`;
}

function viewChecks(){
  const tk = todayKey(), done = state.checks[tk] || [];
  const list = hobbies().filter(a => a.mini);
  if (!list.length) return "";
  const n = list.filter(a => done.includes(a.id)).length;
  return `<section class="panel">
    <div class="head"><h3>Мини-шаги на сегодня</h3><span class="small muted num">${n} из ${list.length}</span></div>
    <div class="checks">${list.map(a => {
      const on = done.includes(a.id), st = streak(a.id);
      return `<div class="check ${on ? "done" : ""}" style="--c:${a.color}">
        <button class="box" data-act="check" data-a="${a.id}" aria-pressed="${on}" aria-label="${esc(a.name)}: мини-шаг выполнен">${CHECK_SVG}</button>
        <div class="t"><b>${esc(a.name)}</b>${a.breakOk ? ' <span class="tag">в перерыв</span>' : ""}<div class="m small">${esc(a.mini)}</div></div>
        <span class="streak ${st >= 3 ? "hot" : ""}">${st ? "серия " + st + " дн." : ""}</span>
      </div>`; }).join("")}
    </div>
    <p class="small muted" style="margin-top:10px">Маленький шаг каждый день важнее большого раз в неделю. Отмеченные «в перерыв» удобно делать между рабочими блоками.</p>
  </section>`;
}

function viewTodayLog(){
  const tk = todayKey();
  const items = state.logs.filter(l => l.d === tk);
  const opts = activeAreas().map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
  const total = items.reduce((s,l) => s + l.m, 0);
  return `<section class="panel">
    <div class="head"><h3>Записано сегодня</h3><span class="small muted num">${fmt(total)}</span></div>
    <div class="log">${items.length ? items.map(l => { const a = areaById(l.a); const own = state.areas.filter(x => x.active || x.id === l.a).map(x => `<option value="${x.id}" ${x.id === l.a ? "selected" : ""}>${esc(x.name)}</option>`).join(""); return `<div class="it"><span class="dot" style="background:${a ? a.color : "var(--muted)"}"></span><span class="grow"><select class="log-area" data-log="${l.id}" aria-label="Занятие этой записи — можно поменять">${a ? "" : '<option value="" selected>Удалённое занятие</option>'}${own}</select></span><span class="num small">${fmt(l.m)}</span><button class="x" data-act="del-log" data-id="${l.id}" aria-label="Удалить запись">×</button></div>`; }).join("") : '<p class="small muted">Пока пусто. Запусти блок таймером или запиши время вручную.</p>'}</div>
    <div class="btn-row" style="margin-top:12px">
      <select class="input small" id="man-area" aria-label="Занятие">${opts}</select>
      <input class="input small num" id="man-min" type="number" min="1" max="600" step="5" value="30" style="width:80px" aria-label="Минуты">
      <span class="small muted">мин</span>
      <button class="btn small" data-act="manual">Записать</button>
    </div>
  </section>`;
}

function viewToday(){
  const ti = dayIdx(today());
  const theme = (state.theme[ti] || []).map(areaById).filter(a => a && a.active && a.kind !== "work");
  const wk = weekRange(0), done = minutesByArea(wk.keys);
  const areas = hobbies().filter(a => a.goal > 0);
  return `<div class="grid cols">
    <div class="stack">
      ${viewNextCard()}
      <section class="panel">
        <div class="head"><h3>Колесо этой недели</h3><a class="small" href="#week">Подробно</a></div>
        ${areas.length ? `<div class="wheel-wrap">${wheelSVG(areas, done)}<div class="legend">${legendHTML(areas, done, ti)}</div></div>` : '<p class="small muted">Задай цели во вкладке «Занятия».</p>'}
        ${workBar(done)}
      </section>
    </div>
    <div class="stack">
      ${viewWork()}
      <section class="panel">
        <div class="head"><h3>Тема дня · ${DAYS_FULL[ti]}</h3><a class="small" href="#week">Изменить</a></div>
        <div class="btn-row">${theme.length ? theme.map(a => `<span class="chip"><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</span>`).join("") : '<span class="small muted">Тема не задана — сегодня свободный выбор.</span>'}</div>
        <p class="small muted" style="margin-top:10px">${isWorkday(today()) ? "После работы — в первую очередь эти занятия. Остальные — только мини-шагами." : "Сегодня в первую очередь эти занятия. Остальные — только мини-шагами."}</p>
      </section>
      ${viewChecks()}
      ${viewTodayLog()}
    </div>
  </div>`;
}

function viewWeek(){
  const wk = weekRange(weekOffset), done = minutesByArea(wk.keys), grid = minutesGrid(wk.keys);
  const tk = todayKey(), ti = weekOffset === 0 ? dayIdx(today()) : (weekOffset < 0 ? 6 : null);
  const hob = state.areas.filter(a => a.kind !== "work" && ((a.active && a.goal > 0) || grid[a.id]));
  const rows = state.areas.filter(a => (a.active && (a.goal > 0 || a.kind === "work")) || grid[a.id]);
  const total = hob.reduce((s,a) => s + (done[a.id] || 0), 0);
  const end = addDays(wk.start, 6);
  const label = `${wk.start.getDate()} ${MONTHS[wk.start.getMonth()]} — ${end.getDate()} ${MONTHS[end.getMonth()]}`;
  const max = Math.max(60, ...Object.values(grid).flat());
  const heatRows = rows.map(a => `<tr><th class="rowh" scope="row"><span class="dot" style="background:${a.color};margin-right:6px"></span>${esc(a.name)}</th>${wk.keys.map((k,i) => {
    const m = (grid[a.id] || [])[i] || 0, pct = m ? Math.round(18 + 72*m/max) : 0;
    return `<td class="${k === tk ? "today" : ""}" style="${m ? `background:color-mix(in srgb, ${a.color} ${pct}%, var(--sunk));color:${pct > 55 ? "#fff" : "var(--ink)"}` : ""}" title="${esc(a.name)}, ${DAYS[i]}: ${fmt(m)}">${m ? Math.round(m) : ""}</td>`; }).join("")}</tr>`).join("");
  const themeRows = hobbies().map(a => `<tr><th class="rowh" scope="row"><span class="dot" style="background:${a.color};margin-right:6px"></span>${esc(a.name)}</th>${DAYS.map((d,i) => {
    const on = (state.theme[i] || []).includes(a.id);
    return `<td class="theme-cell ${on ? "on" : ""}" style="--c:${a.color}"><button data-act="theme" data-a="${a.id}" data-d="${i}" aria-pressed="${on}" aria-label="${esc(a.name)} — ${DAYS_FULL[i]}">${on ? "●" : ""}</button></td>`; }).join("")}</tr>`).join("");
  const perDay = DAYS.map((d,i) => (state.theme[i] || []).filter(id => { const a = areaById(id); return a && a.active && a.kind !== "work"; }).length);
  const crowded = perDay.some(n => n > 3);
  const hobGoal = hob.filter(a => a.goal > 0);
  return `<div class="stack">
    <section class="panel">
      <div class="head">
        <div><span class="label">Неделя ${isoWeek(wk.start)}</span><h2>${label}</h2></div>
        <div class="btn-row">
          <button class="btn small" data-act="wk" data-d="-1" aria-label="Предыдущая неделя">←</button>
          <button class="btn small" data-act="wk" data-d="0" ${weekOffset === 0 ? "disabled" : ""}>Эта неделя</button>
          <button class="btn small" data-act="wk" data-d="1" ${weekOffset >= 0 ? "disabled" : ""} aria-label="Следующая неделя">→</button>
        </div>
      </div>
      ${hobGoal.length ? `<div class="wheel-wrap">${wheelSVG(hobGoal, done)}<div class="legend">${legendHTML(hobGoal, done, ti)}<p class="small muted" style="margin-top:6px">Хобби за неделю: <span class="num">${fmt(total)}</span>. Сектор заполнен до края — цель недели выполнена; точка за краем — перебор.</p></div></div>` : '<p class="muted">Нет занятий с целями.</p>'}
      ${workBar(done)}
    </section>
    <section class="panel">
      <div class="head"><h3>Минуты по дням</h3><span class="small muted">клетка — минуты за день</span></div>
      ${rows.length ? `<div class="scroll-x"><table class="heat"><thead><tr><th></th>${DAYS.map((d,i) => `<th scope="col">${d}<br><span class="num">${addDays(wk.start,i).getDate()}</span></th>`).join("")}</tr></thead><tbody>${heatRows}</tbody></table></div>` : ""}
    </section>
    <section class="panel">
      <div class="head"><h3>Темы дней</h3><span class="small muted">нажми клетку, чтобы добавить или убрать</span></div>
      <p class="small muted" style="margin-bottom:10px">Шаблон на каждую неделю: 1–3 главных хобби на день. В будни они идут после работы. В другие дни для них хватает мини-шага.</p>
      <div class="scroll-x"><table class="heat"><thead><tr><th></th>${DAYS.map(d => `<th scope="col">${d}</th>`).join("")}</tr></thead><tbody>${themeRows}</tbody></table></div>
      ${crowded ? '<p class="note" style="margin-top:10px">В некоторых днях больше трёх тем. Так снова получится «всё понемногу и ничего толком» — оставь 1–3.</p>' : ""}
    </section>
  </div>`;
}

function viewAreas(){
  const s = state.settings, w = s.work;
  const free = (s.freeWeekday*5 + s.freeWeekend*2) * 60;
  const act = hobbies();
  const goals = act.reduce((t,a) => t + (Number(a.goal)||0)*60, 0);
  const over = goals > free;
  const track = act.filter(a => a.goal > 0).map(a => `<i style="width:${(100*a.goal*60/Math.max(goals, free)).toFixed(2)}%;background:${a.color}" title="${esc(a.name)}: ${a.goal} ч"></i>`).join("");
  const hasWork = state.areas.some(a => a.kind === "work");
  const rows = state.areas.map(a => `<div class="area ${a.active ? "" : "paused"} ${a.kind === "work" ? "is-work" : ""}" data-id="${a.id}">
      <button class="sw" style="background:${a.color}" data-act="color" data-id="${a.id}" aria-label="Сменить цвет: ${esc(a.name)}"></button>
      <input class="input" id="nm-${a.id}" data-field="name" data-id="${a.id}" value="${esc(a.name)}" aria-label="Название">
      <div class="goal"><input class="input num" id="gl-${a.id}" type="number" min="0" max="80" step="0.5" data-field="goal" data-id="${a.id}" value="${a.goal}" aria-label="Цель, часов в неделю"><span class="small muted">ч/нед</span>${a.kind === "work" ? "" : `<input class="input num cap" id="cp-${a.id}" type="number" min="0" max="600" step="15" data-field="cap" data-id="${a.id}" value="${a.cap || ""}" placeholder="—" aria-label="Лимит, минут в день" title="Не больше стольких минут в день. Пусто — без лимита."><span class="small muted">мин/день макс</span>`}</div>
      ${a.kind === "work"
        ? `<span class="mini-in small muted">Рабочие часы — в <a href="#settings">настройках</a>, задачи — на «Сегодня»</span><span class="spacer"></span>`
        : `<input class="input mini-in" id="mi-${a.id}" data-field="mini" data-id="${a.id}" value="${esc(a.mini || "")}" placeholder="Мини-шаг на каждый день" aria-label="Мини-шаг">
           <button class="pill ${a.breakOk ? "on" : ""}" data-act="breakok" data-id="${a.id}" aria-pressed="${a.breakOk}" title="Можно ли делать в коротких перерывах между рабочими блоками">${a.breakOk ? "в перерыв: да" : "в перерыв: нет"}</button>`}
      <div class="acts">
        <button class="btn small ghost" data-act="toggle" data-id="${a.id}">${a.active ? "Пауза" : "Вернуть"}</button>
        <button class="btn small ${confirmDel === a.id ? "warn" : "ghost"}" data-act="del-area" data-id="${a.id}">${confirmDel === a.id ? "Точно удалить?" : "Удалить"}</button>
      </div>
    </div>`).join("");
  return `<div class="stack">
    <section class="panel">
      <div class="head"><h2>Бюджет свободного времени</h2><a class="small" href="#settings">Свободные часы — в настройках</a></div>
      <div class="budget" id="budget">
        <div class="track">${track}</div>
        <p class="note ${over ? "" : "ok"}">${over
          ? `Цели хобби на неделю — <b class="num">${fmtH(goals)}</b>, а свободного времени — <b class="num">${fmtH(free)}</b>. Всё не влезет: уменьши цели или поставь что-то на паузу.`
          : `Цели хобби на неделю — <b class="num">${fmtH(goals)}</b> из <b class="num">${fmtH(free)}</b> свободного времени. Запас <span class="num">${fmtH(free-goals)}</span> — на отдых и неожиданности.`}</p>
        ${act.length > 6 ? '<p class="note">Активных хобби больше шести. Чем больше параллельных занятий, тем медленнее движется каждое. Поставь часть на паузу, а идеи держи в «Хотелках».</p>' : ""}
      </div>
    </section>
    <section class="panel">
      <div class="head"><h2>Занятия</h2><div class="btn-row">${hasWork ? "" : '<button class="btn small" data-act="add-work">Добавить работу</button>'}<button class="btn small" data-act="add-area">Добавить занятие</button></div></div>
      <div class="areas">${rows || '<p class="muted">Пока нет ни одного занятия.</p>'}</div>
      <p class="small muted" style="margin-top:12px">Цель — сколько часов в неделю ты хочешь на это тратить. Лимит в день — потолок для затягивающих занятий: когда он набран, приложение предложит другое. «В перерыв: да» — занятие можно делать короткими подходами между рабочими блоками; затягивающие (игры, своя игра) лучше оставить на вечер. Пауза убирает занятие из колеса, история остаётся.</p>
    </section>
  </div>`;
}

/* Settings tab */
function viewSettings(){
  const s = state.settings, w = s.work;
  const hasWork = state.areas.some(a => a.kind === "work");
  return `<div class="stack">
    <section class="panel">
      <div class="head"><h2>Таймер и свободное время</h2></div>
      <div class="settings">
        <label>Свободных часов в будний день<input class="input num" id="set-wd" type="number" min="0" max="16" step="0.5" data-set="freeWeekday" value="${s.freeWeekday}"></label>
        <label>Свободных часов в выходной<input class="input num" id="set-we" type="number" min="0" max="18" step="0.5" data-set="freeWeekend" value="${s.freeWeekend}"></label>
        <label>Длина блока по умолчанию, мин<input class="input num" id="set-bl" type="number" min="10" max="180" step="5" data-set="block" value="${s.block}"></label>
        <label>Сколько раз можно продлить блок<input class="input num" id="set-ex" type="number" min="0" max="5" step="1" data-set="maxExt" value="${s.maxExt}"></label>
      </div>
    </section>
    ${hasWork ? `<section class="panel">
      <div class="head"><h2>Рабочее время</h2></div>
      <div class="stack" style="gap:12px">
        <label class="toggle"><input type="checkbox" id="w-on" data-wflag="on" ${w.on ? "checked" : ""}> Включить рабочий режим: в рабочие часы подсказка — работа, хобби — только в перерывах</label>
        <div class="btn-row" role="group" aria-label="Рабочие дни">${DAYS.map((d,i) => `<button class="pill ${w.days.includes(i) ? "on" : ""}" data-act="wday" data-d="${i}" aria-pressed="${w.days.includes(i)}">${d}</button>`).join("")}</div>
        <div class="settings">
          <label>Начало рабочего дня<input class="input num" id="w-from" type="time" data-wset="from" value="${esc(w.from)}"></label>
          <label>Конец рабочего дня<input class="input num" id="w-to" type="time" data-wset="to" value="${esc(w.to)}"></label>
          <label>Рабочий блок, мин<input class="input num" id="w-block" type="number" min="15" max="180" step="5" data-wset="block" value="${w.block}"></label>
          <label>Перерыв между блоками, мин<input class="input num" id="w-brk" type="number" min="3" max="30" step="1" data-wset="brk" value="${w.brk}"></label>
        </div>
        ${bridge ? `<label class="field">Окна-отвлечения в рабочее время<input class="input" id="w-watch" data-sset="watch" value="${esc(s.watch)}" placeholder="например: MyGame, Dota2.exe" maxlength="300"></label>
        <p class="small muted">Впиши название проекта своей игры — его видно в заголовке окна Unity. Тогда рабочие проекты в Unity не мешают, а окно своей игры в рабочие часы вызовет вопрос «это перерыв?». Можно добавить и программы целиком — с «.exe» на конце. Через запятую. Пусто — слежение выключено. Заголовки окон проверяются только на этом компьютере и никуда не отправляются.</p>` : ""}
      </div>
    </section>` : ""}
    <section class="panel">
      <div class="head"><h2>Оформление</h2></div>
      <div class="btn-row" role="group" aria-label="Тема">${[["dark","Тёмная"],["light","Светлая"],["auto","Как в системе"]].map(([v,l]) => `<button class="pill ${s.theme === v ? "on" : ""}" data-act="theme-set" data-v="${v}" aria-pressed="${s.theme === v}">${l}</button>`).join("")}</div>
    </section>
    ${viewSync()}
    ${bridge ? `<section class="panel">
      <div class="head"><h2>Программа и данные</h2></div>
      <div class="stack" style="gap:10px">
        <label class="toggle"><input type="checkbox" id="set-mini" data-flag="mini" ${s.mini ? "checked" : ""}> Мини-таймер поверх окон, когда главное окно свёрнуто</label>
        <label class="toggle"><input type="checkbox" id="set-popup" data-flag="popup" ${s.popup ? "checked" : ""}> Когда блок закончился, показывать главное окно (если мини-таймер выключен)</label>
        <label class="toggle"><input type="checkbox" id="set-auto" data-act="autostart" ${autostart ? "checked" : ""}> Запускать вместе с Windows (в трее, без окна)</label>
        <p class="small muted">Все данные лежат в файле на этом компьютере${dataPath ? `: <span class="num">${esc(dataPath)}</span>` : "."}</p>
        <div class="btn-row">
          <button class="btn small" data-act="export">Сохранить резервную копию…</button>
          <button class="btn small" data-act="import">Загрузить из копии…</button>
          <button class="btn small ghost" data-act="open-folder">Открыть папку данных</button>
        </div>
      </div>
    </section>` : `<section class="panel">
      <div class="head"><h2>Данные на этом устройстве</h2></div>
      <p class="small muted">Данные лежат в памяти браузера на телефоне. Резервная копия — файл, который можно сохранить себе.</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn small" data-act="export-web">Скачать резервную копию</button>
        <label class="btn small" for="import-file">Загрузить из копии…</label>
        <input type="file" id="import-file" accept=".json,application/json" hidden>
      </div>
    </section>`}
  </div>`;
}

function syncStatusText(){
  if (!syncCfg) return "Не подключено.";
  if (syncStatus.state === "busy") return "Синхронизирую…";
  if (syncStatus.state === "error") return "Ошибка: " + syncStatus.msg;
  if (syncStatus.at) { const d = new Date(syncStatus.at); return `Синхронизировано в ${pad(d.getHours())}:${pad(d.getMinutes())}.`; }
  return "Подключено.";
}
function viewSyncBody(){
  if (!S) return "";
  if (syncCfg) return `<p class="small">Репозиторий: <span class="num">${esc(syncCfg.owner)}/${esc(syncCfg.repo)}</span></p>
      <p class="small ${syncStatus.state === "error" ? "warn-text" : "muted"}" id="sync-status" role="status">${esc(syncStatusText())}</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn small" data-act="sync-now">Синхронизировать сейчас</button>
        <button class="btn small ghost" data-act="sync-off">Отключить на этом устройстве</button>
      </div>`;
  return `<p class="small">Данные шифруются на устройстве твоим паролем и только потом уходят в твой <b>приватный</b> репозиторий на GitHub. Ни GitHub, ни кто-либо ещё не может их прочитать — без пароля это набор случайных байтов.</p>
    <details class="howto"><summary class="small">Как подготовить GitHub (5 минут)</summary>
      <ol class="small">
        <li>На github.com создай новый репозиторий, например <span class="num">koleso-data</span>, и выбери <b>Private</b>.</li>
        <li>Открой Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
        <li>Repository access: <b>Only select repositories</b> → koleso-data. Permissions → Repository → <b>Contents: Read and write</b>. Срок — например, год.</li>
        <li>Скопируй токен и вставь ниже. На каждом устройстве используй тот же репозиторий и тот же пароль шифрования.</li>
      </ol>
    </details>
    <form class="sync-form" data-form="sync" autocomplete="off">
      <label>Имя на GitHub<input class="input" id="sy-owner" name="owner" required placeholder="например, PlayWithMao"></label>
      <label>Репозиторий<input class="input" id="sy-repo" name="repo" required value="koleso-data"></label>
      <label class="wide">Токен доступа<input class="input num" id="sy-token" name="token" type="password" required placeholder="github_pat_…"></label>
      <label>Пароль шифрования<input class="input" id="sy-pass" name="pass" type="password" required minlength="8" placeholder="не меньше 8 символов"></label>
      <label>Повторите пароль<input class="input" id="sy-pass2" name="pass2" type="password" placeholder="нужно на первом устройстве"></label>
      <p class="small muted wide">Запомни пароль: восстановить его нельзя, и без него данные не расшифровать. Токен и пароль хранятся только на этом устройстве${bridge ? " (зашифрованы средствами Windows)" : ""}.</p>
      <div class="wide"><button class="btn primary" type="submit" id="sy-go">Подключить</button> <span class="small" id="sync-status" role="status">${syncStatus.state === "error" ? esc("Ошибка: " + syncStatus.msg) : ""}</span></div>
    </form>`;
}
function viewSync(){
  if (!S) return "";
  return `<section class="panel" id="sync-panel">
    <div class="head"><h2>${bridge ? "Синхронизация с телефоном" : "Синхронизация с компьютером"}</h2>${syncCfg ? '<span class="chip on">включена</span>' : ""}</div>
    ${viewSyncBody()}
  </section>`;
}
function renderSyncStatus(){
  const el = $("#sync-status");
  if (el){ el.textContent = syncCfg ? syncStatusText() : (syncStatus.state === "error" ? "Ошибка: " + syncStatus.msg : syncStatus.state === "busy" ? "Проверяю…" : ""); el.classList.toggle("warn-text", syncStatus.state === "error"); }
  renderFooter();
}

function viewIdeas(){
  return `<div class="grid cols">
    <section class="panel">
      <div class="head"><h2>Хотелки</h2><span class="small muted num">${state.ideas.length}</span></div>
      <form class="btn-row" data-form="idea" style="margin-bottom:12px">
        <input class="input" id="idea-in" placeholder="Например: научиться рисовать пиксель-арт" style="flex:1;min-width:200px" aria-label="Новая хотелка" maxlength="200">
        <button class="btn primary" type="submit">Отложить</button>
      </form>
      <div class="ideas">${state.ideas.length ? state.ideas.map(i => `<div class="idea"><span class="t">${esc(i.t)}</span>
        <button class="btn small" data-act="promote" data-id="${i.id}">Сделать занятием</button>
        <button class="x" data-act="del-idea" data-id="${i.id}" aria-label="Удалить">×</button></div>`).join("") : '<p class="small muted">Сюда — всё, что хочется попробовать, но не сейчас. Записанная идея не потеряется, и голова освобождается.</p>'}</div>
    </section>
    <section class="panel">
      <h3 style="margin-bottom:8px">Зачем это нужно</h3>
      <div class="prose small">
        <p>Желаний всегда больше, чем часов. Если браться за всё сразу, каждое движется медленно, и кажется, что не успеваешь ничего.</p>
        <p>Держи активными 4–6 занятий. Новая идея сначала попадает сюда. Раз в месяц, на обзоре, реши: что из хотелок взять в работу и что поставить на паузу вместо этого.</p>
      </div>
    </section>
  </div>`;
}

function viewMethod(){
  const cards = [
    ["Блоки с таймером", "timeboxing", "Ты залипаешь в одно занятие, потому что у остальных нет «будильника». Заранее отведи занятию блок на 25–60 минут. По сигналу закончи, даже если хочется ещё. Продлить блок можно один раз, не больше."],
    ["Работа — в рабочие часы", "рабочий режим", "В рабочее время карточка «Что дальше» предлагает только работу. Хобби можно взять лишь в перерыв на 10 минут, а затягивающие (своя игра, игры) приложение просит отложить на вечер. Утром — 1–3 главные задачи: так видно, что «работа сделана», и вечером своя игра идёт без чувства вины."],
    ["Перерывы с пользой", "50 + 10", "Между рабочими блоками — короткий перерыв. Его удобно отдать мини-шагу: 10 минут английских слов или 3 задачи го. Мозг отдыхает от работы, а хобби продвигаются."],
    ["Темы дней", "day theming", "Не пытайся каждый день делать всё. Дай каждому дню 1–3 главных хобби, например вторник — го и книги. Так меньше переключений, а за неделю каждое занятие получит своё время."],
    ["Мини-шаг каждый день", "tiny habits", "Для важного (английский!) задай крошечное ежедневное действие: 15 минут слов, 3 задачи-цумего, 10 страниц. В загруженный день хватит и этого, и навык не забывается. Подход Би Джей Фогга (Стэнфорд)."],
    ["План «если — то»", "implementation intentions", "Привяжи занятие к моменту: «После работы — 45 минут своей игры», «В метро — книга». Такие планы заметно повышают шанс довести дело до конца: метаанализ 94 исследований (Gollwitzer и Sheeran, 2006) показал средне-сильный эффект."],
    ["Бюджет, а не список желаний", "часы в неделю", "Сначала посчитай свободные часы, потом распределяй их. Если цели не влезают, это видно сразу во вкладке «Занятия». Лишнее — на паузу или в «Хотелки», без чувства вины."],
    ["Обзор недели", "10 минут в воскресенье", "Открой вкладку «Неделя»: какие сектора пустые, где перебор? Поправь цели и темы дней. Привычка складывается в среднем около 66 дней (Lally и др., 2009). Разброс большой, и один пропуск ничего не ломает."],
  ];
  return `<div class="stack">
    <section class="panel">
      <div class="prose">
        <span class="label">Как пользоваться</span>
        <h2>Пять минут в день, десять в воскресенье</h2>
        <p>1) Утром: запиши 1–3 рабочие задачи, глянь тему дня и мини-шаги. 2) В рабочие часы жми «Старт» — это рабочий блок; по сигналу — перерыв с мини-шагом. 3) После работы карточка «Что дальше» сама переключится на хобби. 4) Отмечай мини-шаги. 5) В воскресенье — обзор колеса и поправка целей.</p>
      </div>
    </section>
    <div class="method">${cards.map(([h,k,p]) => `<section class="panel"><span class="k">${k}</span><h3>${h}</h3><p class="small">${p}</p></section>`).join("")}</div>
    <section class="panel">
      <div class="prose small">
        <span class="label">Для твоих занятий</span>
        <p><b>Английский</b> лучше всего растёт от ежедневных коротких подходов: это главный кандидат на мини-шаг и на рабочие перерывы. <b>Го</b>: правила учатся за вечер в интерактивном уроке, например на <a href="https://online-go.com/learn-to-play-go" target="_blank" rel="noopener">online-go.com</a>, дальше — задачи-цумего и партии на доске 9×9. <b>Своя игра</b>: блок 45–60 минут после работы, мини-шаг помогает не терять нить. <b>Игры</b> — самое «липкое» занятие, поэтому для них таймер особенно важен.</p>
      </div>
    </section>
    <p class="src">Источники: <a href="https://puttylike.com/how-to-juggle-your-interests-without-dropping-any/" target="_blank" rel="noopener">Puttylike — как жонглировать интересами</a> · <a href="https://concepts.dsebastien.net/concept/day-theming/" target="_blank" rel="noopener">Day theming</a> · <a href="https://www.jibble.io/article/time-blocking" target="_blank" rel="noopener">Time blocking</a> · <a href="https://doi.org/10.1016/S0065-2601(06)38002-1" target="_blank" rel="noopener">Gollwitzer &amp; Sheeran, 2006</a> · <a href="https://doi.org/10.1002/ejsp.674" target="_blank" rel="noopener">Lally et al., 2009</a></p>
  </div>`;
}

function viewGuardOther(a){
  const sg = suggest(a.id);
  if (!sg) return "";
  return sg.work
    ? `<button class="btn primary" data-act="start-work">Работа · ${W().block} мин</button>`
    : `<button class="btn primary" data-act="start" data-a="${sg.area.id}" data-dur="${sg.dur}">${esc(sg.area.name)} · ${sg.dur} мин</button>`;
}
function viewOverlay(){
  if (guard && guard.why === "watch"){
    const a = guard.a ? areaById(guard.a) : null, wa = workArea();
    return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="ov-h"><div class="card">
      <span class="label">Рабочее время до ${esc(W().to)}</span>
      <h2 id="ov-h">${/\.exe$/i.test(guard.app) ? esc(guard.app) + " открыт" : "Открыт проект «" + esc(guard.app) + "»"}</h2>
      <p>Это перерыв? Тогда пусть он будет на ${W().brk} минут — с таймером. Если программа нужна по работе, отметьте это, и сегодня я больше не спрошу.</p>
      <div class="btn-row">
        ${a ? `<button class="btn primary" data-act="start-ret" data-a="${a.id}">Перерыв: ${esc(a.name)} · ${W().brk} мин</button>` : ""}
        ${wa ? `<button class="btn" data-act="start-work">Закрою и вернусь к работе</button>` : ""}
        <button class="btn ghost" data-act="watch-ok" data-app="${esc(guard.app)}">Это по работе — не спрашивать сегодня</button>
      </div></div></div>`;
  }
  if (guard && (guard.why === "cap" || guard.why === "again")){
    const a = areaById(guard.a);
    if (!a) { guard = null; return ""; }
    const cap = guard.why === "cap";
    return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="ov-h"><div class="card">
      <span class="label">${cap ? "Лимит на сегодня" : "Только что было"}</span>
      <h2 id="ov-h">${cap ? `«${esc(a.name)}» — уже ${fmt(todayMinutes(a.id))}` : `Снова «${esc(a.name)}»?`}</h2>
      <p>${cap ? `Дневной лимит — ${fmt(a.cap)}. Хватит на сегодня? Колесо подскажет, что давно ждёт своей очереди.` : "Блок только что закончился. Переключись хотя бы на один блок — так день не уйдёт в одно занятие."}</p>
      <div class="btn-row">
        ${viewGuardOther(a)}
        <button class="btn ghost" data-act="start-force" data-a="${a.id}" data-dur="${cap ? 15 : (guard.dur || state.settings.block)}">${cap ? "Ещё 15 минут" : "Всё равно продолжить"}</button>
        <button class="btn ghost" data-act="close-ov">Отмена</button>
      </div></div></div>`;
  }
  if (guard){
    const a = areaById(guard.a), wa = workArea();
    if (!a) { guard = null; return ""; }
    return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="ov-h"><div class="card">
      <span class="label">Рабочее время до ${esc(W().to)}</span>
      <h2 id="ov-h">${a.breakOk ? "Это перерыв?" : "Может, вечером?"}</h2>
      <p>${a.breakOk
        ? `«${esc(a.name)}» хорошо подходит для короткого перерыва. ${W().brk} минут — и обратно к работе.`
        : `«${esc(a.name)}» легко затягивает на часы, а рабочие задачи ждут. После ${esc(W().to)} подсказка сама предложит это занятие.`}</p>
      <div class="btn-row">
        ${a.breakOk ? `<button class="btn primary" data-act="start-ret" data-a="${a.id}">Перерыв: ${esc(a.name)} · ${W().brk} мин</button>` : ""}
        ${wa ? `<button class="btn ${a.breakOk ? "" : "primary"}" data-act="start-work">Сначала работа · ${W().block} мин</button>` : ""}
        ${a.breakOk ? "" : `<button class="btn ghost" data-act="start-ret" data-a="${a.id}">Всё равно ${W().brk} минут</button>`}
        <button class="btn ghost" data-act="close-ov">Отмена</button>
      </div></div></div>`;
  }
  if (!overlay) return "";
  const o = overlay, a = areaById(o.a), s = state.settings;
  const nx = nextAfter(o), sg = nx.main;
  const canExt = o.kind === "focus" && !o.ret && o.ext < s.maxExt && a;
  return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="ov-h">
    <div class="card">
      <span class="label">${o.kind === "focus" ? "Блок закончен" : "Перерыв окончен"}</span>
      <h2 id="ov-h">${esc(nx.title)}</h2>
      ${o.kind === "focus" ? `<p>«${esc(a ? a.name : "Занятие")}» — записано <b class="num">${fmt(o.dur)}</b>.</p>` : ""}
      ${sg ? `<div class="nextbox"><span class="label">${nx.isBreak ? "Можно в перерыв" : "Дальше"}</span><div style="font-size:18px;font-weight:600">${esc(sg.area.name)}</div><div class="small muted">${esc(sg.why)}</div></div>` : ""}
      <div class="btn-row">
        ${sg ? (nx.isBreak
          ? `<button class="btn primary" data-act="start-ret" data-a="${sg.area.id}">Перерыв: ${esc(sg.area.name)} · ${W().brk} мин</button>`
          : `<button class="btn primary" data-act="start" data-a="${sg.area.id}" data-dur="${sg.dur}">Начать «${esc(sg.area.name)}» · ${sg.dur} мин</button>`) : ""}
        ${o.kind === "focus" ? `<button class="btn" data-act="break">Просто отдохнуть · ${nx.isBreak ? W().brk : 5} мин</button>` : ""}
        ${canExt ? `<button class="btn ghost" data-act="extend" data-a="${o.a}" data-ext="${o.ext+1}">Ещё 10 минут «${esc(a.name)}»</button>` : (o.kind === "focus" && !o.ret ? `<p class="small muted">Продления закончились. Это специально, чтобы не залипнуть.</p>` : "")}
        <button class="btn ghost" data-act="close-ov">Закрыть</button>
      </div>
    </div>
  </div>`;
}

// colour theme: dark by default; "auto" follows the system
function applyTheme(){
  const t = state ? state.settings.theme : "dark", root = document.documentElement;
  if (t === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t);
  const dark = t === "dark" || (t === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute("content", dark ? "#12161B" : "#2E5B4E");
  if (bridge && bridge.prefs && state) bridge.prefs({ mini: state.settings.mini, theme: t });
}
function renderFooter(){
  const base = storeNote || (!ready ? "Загружаю данные…" : bridge ? "Данные хранятся на этом компьютере." : "Данные хранятся на этом устройстве.");
  const sync = syncCfg ? (syncStatus.state === "error" ? " Синхронизация: ошибка." : syncStatus.state === "busy" ? " Синхронизирую…" : " Синхронизация зашифрована.") : "";
  $("#store-note").textContent = base + sync;
}
function render(){
  const now = today();
  $("#hdr-date").textContent = `${now.getDate()} ${MONTHS[now.getMonth()]}, ${DAYS_FULL[dayIdx(now)]}`;
  $("#hdr-week").textContent = "Неделя " + isoWeek(now);
  const h = (location.hash || "#today").slice(1);
  tab = ["today","week","areas","ideas","method","settings"].includes(h) ? h : "today";
  document.querySelectorAll("nav.tabs a").forEach(a => { if (a.dataset.tab === tab) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  const main = $("#main");
  if (loadFailed){
    main.innerHTML = `<div class="onboard"><span class="label">Данные не прочитаны</span><h1>Файл данных сейчас недоступен</h1>
      <p>Программа не смогла открыть файл с твоими записями (${esc(loadFailed)}). Чаще всего его ненадолго блокирует антивирус или синхронизация облака. Ничего не стёрто: я ничего не записываю, пока файл не прочитан.</p>
      <div class="btn-row"><button class="btn primary" data-act="reload">Попробовать снова</button>${bridge ? '<button class="btn" data-act="open-folder">Открыть папку данных</button>' : ""}</div></div>`;
    $("#overlay-root").innerHTML = ""; renderFooter(); return;
  }
  if (!state || !state.started){
    main.innerHTML = tab === "method" ? viewMethod() : viewOnboard();
  } else {
    main.innerHTML = ({ today: viewToday, week: viewWeek, areas: viewAreas, ideas: viewIdeas, method: viewMethod, settings: viewSettings })[tab]();
  }
  $("#overlay-root").innerHTML = state ? viewOverlay() : "";
  renderFooter();
  applyTheme();
  updateWakeLock();
}

/* ---------- events ---------- */
let toastT = null;
function toast(msg){
  let el = $(".toast"); if (!el){ el = document.createElement("div"); el.className = "toast"; el.setAttribute("role","status"); document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2800);
}
function closeOverlay(){ overlay = null; guard = null; document.title = "Колесо недели"; render(); }
function nextColor(){ const used = new Set(state.areas.map(a => a.color)); return COLORS.find(c => !used.has(c)) || COLORS[state.areas.length % COLORS.length]; }
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
  const act = b.dataset.act, id = b.dataset.id, aid = b.dataset.a;
  if (act !== "del-area") confirmDel = null;
  switch (act){
    case "seed": state = starter(); save(); render(); break;
    case "blank": state = normalize({ started: true, settings: { workAdded: true } }); save(); location.hash = "#areas"; render(); break;
    case "start": requestStart(aid, b.dataset.dur); break;
    case "start-ret": startTimer(aid, W().brk, "focus", 0, true); break;
    case "start-work": { const wa = workArea(); if (wa) startTimer(wa.id, W().block, "focus", 0, false); break; }
    case "unpick": picked = null; render(); break;
    case "start-picked": { const v = $("#pick-area").value, a = areaById(v); if (a) requestStart(v, a.kind === "work" ? W().block : state.settings.block); break; }
    case "extend": {
      const a = areaById(aid); if (!a) break;
      if (a.kind !== "work" && inWork()){ guard = { a: aid, why: "work" }; render(); break; }
      if (a.cap > 0 && todayMinutes(aid) >= a.cap){ guard = { a: aid, why: "cap" }; render(); break; }
      startTimer(aid, 10, "focus", Number(b.dataset.ext), false); break;
    }
    case "start-force": requestStart(aid, b.dataset.dur, true); break;
    case "watch-ok": watchSnooze[b.dataset.app] = todayKey(); closeOverlay(); break;
    case "reload": location.reload(); break;
    case "theme-set": state.settings.theme = b.dataset.v; touch("s:theme"); save(); render(); break;
    case "export-web": {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "koleso-nedeli-" + todayKey() + ".json"; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000); break;
    }
    case "break": startTimer(null, overlay && overlay.wasWork && inWork() ? W().brk : 5, "break", 0, false); break;
    case "stop": stopTimer(false); break;
    case "close-ov": closeOverlay(); break;
    case "check": { const tk = todayKey(), arr = state.checks[tk] = state.checks[tk] || []; const i = arr.indexOf(aid); if (i >= 0) arr.splice(i,1); else arr.push(aid); touch("c:" + tk + "|" + aid); save(); render(); break; }
    case "manual": { const a = $("#man-area").value, m = Number($("#man-min").value); if (a && m > 0){ addLog(a, Math.min(m, 600)); save(); render(); toast("Записано: " + fmt(m)); } break; }
    case "del-log": state.logs = state.logs.filter(l => l.id !== id); tomb("l:" + id); save(); render(); break;
    case "wk": { const d = Number(b.dataset.d); weekOffset = d === 0 ? 0 : Math.min(0, weekOffset + d); render(); break; }
    case "theme": { const d = b.dataset.d, list = state.theme[d] = state.theme[d] || []; const i = list.indexOf(aid); if (i >= 0) list.splice(i,1); else list.push(aid); touch("theme:" + d); save(); render(); break; }
    case "color": { const a = areaById(id); if (!a) break; a.color = COLORS[(COLORS.indexOf(a.color) + 1) % COLORS.length]; touch("a:" + id); save(); render(); break; }
    case "toggle": { const a = areaById(id); if (!a) break; a.active = !a.active; touch("a:" + id); save(); render(); break; }
    case "breakok": { const a = areaById(id); if (!a) break; a.breakOk = !a.breakOk; touch("a:" + id); save(); render(); break; }
    case "del-area":
      if (confirmDel !== id){ confirmDel = id; render(); break; }
      confirmDel = null;
      state.areas = state.areas.filter(a => a.id !== id); tomb("a:" + id);
      for (const d in state.theme) if (state.theme[d].includes(id)){ state.theme[d] = state.theme[d].filter(x => x !== id); touch("theme:" + d); }
      if (state.timer && state.timer.a === id){ state.timer = null; touch("timer"); }
      touch("order"); save(); render(); syncTimerToShell(); toast("Занятие удалено"); break;
    case "add-area": {
      const a = { id: uid(), name: "Новое занятие", color: nextColor(), goal: 1, mini: "", active: true, kind: "hobby", breakOk: true };
      state.areas.push(a); touch("a:" + a.id, "order"); save(); render();
      const inp = document.getElementById("nm-" + a.id); if (inp){ inp.focus(); inp.select(); } break;
    }
    case "add-work": { const a = WORK_AREA(); if (areaById(a.id)) a.id = uid(); state.areas.unshift(a); touch("a:" + a.id, "order"); save(); render(); break; }
    case "wday": { const d = Number(b.dataset.d), w = W(); w.days = w.days.includes(d) ? w.days.filter(x => x !== d) : [...w.days, d].sort(); touch("s:work.days"); save(); render(); break; }
    case "offday": { const tk = todayKey(); state.off = state.off.includes(tk) ? state.off.filter(x => x !== tk) : [...state.off, tk]; touch("o:" + tk); save(); render(); break; }
    case "task": { const t = state.tasks.find(x => x.id === id); if (t){ t.done = !t.done; touch("k:" + id); save(); render(); } break; }
    case "del-task": state.tasks = state.tasks.filter(x => x.id !== id); tomb("k:" + id); save(); render(); break;
    case "carry": { const tk = todayKey(), from = key(addDays(today(), -7)); for (const t of state.tasks) if (!t.done && t.d < tk && t.d >= from){ t.d = tk; touch("k:" + t.id); } save(); render(); break; }
    case "promote": {
      const i = state.ideas.find(x => x.id === id); if (!i) break;
      const a = { id: uid(), name: i.t.slice(0, 40), color: nextColor(), goal: 1, mini: "", active: true, kind: "hobby", breakOk: true };
      state.areas.push(a); touch("a:" + a.id, "order");
      state.ideas = state.ideas.filter(x => x.id !== id); tomb("i:" + id);
      save(); location.hash = "#areas"; render(); toast("Добавлено в занятия: цель 1 ч в неделю"); break;
    }
    case "del-idea": state.ideas = state.ideas.filter(x => x.id !== id); tomb("i:" + id); save(); render(); break;
    case "autostart": if (bridge) bridge.setAutostart(b.checked).then(v => { autostart = v; }).catch(() => toast("Не удалось изменить автозапуск")); break;
    case "open-folder": if (bridge) bridge.openDataFolder(); break;
    case "export": if (bridge){ flush(); bridge.exportData(JSON.stringify(state, null, 2)).then(p => { if (p) toast("Копия сохранена"); }).catch(() => toast("Не удалось сохранить копию")); } break;
    case "import":
      if (bridge) bridge.importData().then(d => {
        if (!d) return;
        if (!Array.isArray(d.areas)){ toast("Это не файл «Колеса недели»"); return; }
        importState(d);
      }).catch(() => toast("Не удалось прочитать файл"));
      break;
    case "sync-now": syncNow(); break;
    case "sync-off": syncCfg = null; syncStatus = { state: "off", msg: "", at: 0 }; storeSyncCfg(null); render(); toast("Синхронизация на этом устройстве отключена. Данные остались."); break;
  }
});
document.addEventListener("submit", async e => {
  const f = e.target.closest("[data-form]"); if (!f) return;
  e.preventDefault();
  if (f.dataset.form === "idea"){
    const inp = $("#idea-in"), t = inp.value.trim(); if (!t) return;
    const i = { id: uid(), t: t.slice(0, 200) }; state.ideas.unshift(i); touch("i:" + i.id); save(); render(); const n = $("#idea-in"); if (n) n.focus();
  } else if (f.dataset.form === "task"){
    const inp = $("#task-in"), t = inp.value.trim(); if (!t) return;
    const k = { id: uid(), d: todayKey(), t: t.slice(0, 200), done: false }; state.tasks.push(k); touch("k:" + k.id); save(); render(); const n = $("#task-in"); if (n) n.focus();
  } else if (f.dataset.form === "sync"){
    const fd = new FormData(f);
    const cfg = { owner: String(fd.get("owner") || "").trim(), repo: String(fd.get("repo") || "").trim(), token: String(fd.get("token") || "").trim(), pass: String(fd.get("pass") || "") };
    if (!cfg.owner || !cfg.repo || !cfg.token || cfg.pass.length < 8){ syncStatus = { state: "error", msg: "Заполни все поля; пароль — не меньше 8 символов." }; renderSyncStatus(); return; }
    const btn = $("#sy-go"); if (btn) btn.disabled = true;
    syncStatus = { state: "busy", msg: "" }; renderSyncStatus();
    try {
      await S.checkRepo(cfg);
      const probe = await S.pull(cfg);
      const pass2 = String(fd.get("pass2") || "");
      if (!probe.env && pass2 !== cfg.pass) throw new Error(pass2 ? "Пароль и повтор не совпадают." : "Это первое устройство: повторите пароль, чтобы не ошибиться в нём.");
      if (probe.env) await S.open(probe.env, cfg.pass);   // wrong passphrase stops here, before anything is written
      if (!(await syncNow(cfg))) throw new Error(syncStatus.msg || "не получилось");
      syncCfg = cfg; await storeSyncCfg(cfg);
      syncStatus = { state: "ok", msg: "", at: Date.now() };
      render(); toast("Синхронизация включена");
    } catch(err){
      syncStatus = { state: "error", msg: (err && err.message) || String(err) };
      if (btn) btn.disabled = false; renderSyncStatus();
    }
  }
});
document.addEventListener("input", e => {
  const el = e.target;
  if (el.dataset.field){
    const a = areaById(el.dataset.id); if (!a) return;
    if (el.dataset.field === "goal") a.goal = num(el.value, 0, 0, 80);
    else if (el.dataset.field === "cap") a.cap = el.value === "" ? 0 : num(el.value, 0, 0, 1440);
    else a[el.dataset.field] = el.value.slice(0, 120);
    touch("a:" + a.id); save(); refreshBudget();
  } else if (el.dataset.flag){
    state.settings[el.dataset.flag] = el.checked; touch("s:" + el.dataset.flag); save();
    if (el.dataset.flag === "mini" && bridge) bridge.prefs({ mini: el.checked });
  } else if (el.dataset.sset){
    state.settings[el.dataset.sset] = el.value.slice(0, 300); touch("s:" + el.dataset.sset); save();
  } else if (el.dataset.wflag){
    W()[el.dataset.wflag] = el.checked; touch("s:work." + el.dataset.wflag); save();
  } else if (el.dataset.wset){
    const k = el.dataset.wset;
    if (k === "from" || k === "to"){ if (/^\d{2}:\d{2}$/.test(el.value)){ W()[k] = el.value; touch("s:work." + k); save(); } }
    else { const v = Number(el.value); if (isFinite(v) && v > 0){ W()[k] = v; touch("s:work." + k); save(); } }
  } else if (el.dataset.set){
    const v = Number(el.value); if (isFinite(v) && v >= 0){ state.settings[el.dataset.set] = v; touch("s:" + el.dataset.set); save(); refreshBudget(); }
  }
});
document.addEventListener("change", e => {
  if (e.target.id === "pick-area"){ picked = e.target.value; render(); return; }
  if (e.target.dataset.log){   // an entry logged under the wrong activity: move it
    const l = state.logs.find(x => x.id === e.target.dataset.log), a = areaById(e.target.value);
    if (l && a && l.a !== a.id){ l.a = a.id; touch("l:" + l.id); save(); render(); toast(`Перенесено в «${a.name}»: ${fmt(l.m)}`); }
    return;
  }
  if (e.target.dataset.field === "name" && !e.target.value.trim()){ const a = areaById(e.target.dataset.id); if (!a) return; a.name = "Без названия"; e.target.value = a.name; touch("a:" + a.id); save(); }
  if (e.target.id === "import-file" && e.target.files && e.target.files[0]){
    const f = e.target.files[0]; e.target.value = "";
    if (f.size > 5*1024*1024){ toast("Файл слишком большой для резервной копии"); return; }
    f.text().then(t => importState(JSON.parse(t))).catch(() => toast("Не удалось прочитать файл"));
  }
});
function importState(d){
  if (!d || !Array.isArray(d.areas)){ toast("Это не файл «Колеса недели»"); return; }
  state = normalize(d); state.started = true; state.timer = null;   // an old running timer would "finish" at once
  stampAll(); save(); render(); syncTimerToShell(); toast("Данные загружены из копии");
}
function refreshBudget(){
  const cur = $("#budget"); if (!cur) return;
  const tmp = document.createElement("div"); tmp.innerHTML = viewAreas();
  const fresh = tmp.querySelector("#budget"); if (fresh) cur.replaceWith(fresh);
}
window.addEventListener("hashchange", () => { confirmDel = null; render(); window.scrollTo(0,0); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && (overlay || guard)) closeOverlay(); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden){ syncAttempted = false; if (syncCfg) syncNow(); tick(); }
  else if (syncCfg && syncPending) syncNow();   // edits made just before switching away
  updateWakeLock();
});
// Windows: in work hours, notice when a program from the list (Unity, Godot…) is open
const watchSnooze = {};
async function watchApps(){
  if (!bridge || !state || !state.started || loadFailed || !W().on || !inWork() || guard || overlay) return;
  const t = state.timer; if (t && (t.ret || t.kind === "break")) return;   // already on a timed break
  const pats = String(state.settings.watch || "").split(/[,;\n]/).map(p => p.trim()).filter(Boolean);
  if (!pats.length) return;
  let found = [];
  try { found = await bridge.runningApps(pats); } catch(e){ return; }
  const tk = todayKey();
  found = found.filter(p => watchSnooze[p] !== tk);
  if (!found.length || guard || overlay) return;
  const target = areaById("dev") || hobbies().find(a => !a.breakOk) || hobbies()[0];   // own game is the usual suspect
  guard = { why: "watch", app: found[0], a: target ? target.id : null };
  render();
  bridge.notify({ title: "Рабочее время", body: `${/\.exe$/i.test(found[0]) ? found[0] + " открыт" : "Открыт проект «" + found[0] + "»"}. Это перерыв на ${W().brk} минут?`, popup: false });
}
setInterval(watchApps, 60000);
// re-render at midnight and when work hours start or end
let lastMark = "";
setInterval(() => { if (!state) return; const mark = todayKey() + inWork(); if (mark !== lastMark){ const first = !lastMark; lastMark = mark; if (!first && !editingNow()) render(); } }, 30000);

boot().then(() => { if (capsNote) toast("«Игры»: вместо цели в неделю теперь лимит 90 минут в день. Поменять можно в «Занятиях»."); })
  .catch(e => { storeNote = "Ошибка запуска: " + ((e && e.message) || e); ready = true; try { render(); } catch(_){} });
})();
