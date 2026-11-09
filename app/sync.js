/* Колесо недели — private sync.
 *
 * Data leaves the device only as an AES-256-GCM ciphertext. The key is derived from the
 * user's own passphrase (PBKDF2-SHA-256, 600 000 rounds) and never leaves the device.
 * The ciphertext is stored as one file in the user's own PRIVATE GitHub repository,
 * reached with a fine-grained token that can touch only that repository.
 *
 * Works in browsers, in the Electron renderer and in Node 20+ (for tests).
 */
(function (root) {
  "use strict";
  const FORMAT = "koleso-e2e-1";
  const ITER = 600000;
  const FILE = "koleso.enc.json";
  const subtle = (root.crypto || globalThis.crypto).subtle;
  const rnd = n => (root.crypto || globalThis.crypto).getRandomValues(new Uint8Array(n));
  const te = new TextEncoder(), td = new TextDecoder();

  /* ---------- base64 for bytes ---------- */
  function b64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(str) { const s = atob(str), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }

  /* ---------- encryption ---------- */
  const keyCache = new Map();
  async function deriveKey(pass, saltB64) {
    const id = saltB64 + "\u0000" + pass;
    if (keyCache.has(id)) return keyCache.get(id);
    const base = await subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
    const key = await subtle.deriveKey({ name: "PBKDF2", salt: unb64(saltB64), iterations: ITER, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    keyCache.set(id, key);
    return key;
  }
  async function seal(obj, pass, saltB64) {
    const salt = saltB64 || b64(rnd(16)), iv = rnd(12);
    const key = await deriveKey(pass, salt);
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj))));
    return { format: FORMAT, kdf: "PBKDF2-SHA256", iter: ITER, salt, iv: b64(iv), ct: b64(ct) };
  }
  class WrongPassword extends Error { constructor() { super("Неверный пароль шифрования"); this.code = "wrong_password"; } }
  async function open(env, pass) {
    if (!env || env.format !== FORMAT) throw Object.assign(new Error("Файл синхронизации в неизвестном формате"), { code: "bad_format" });
    const key = await deriveKey(pass, env.salt);
    let plain;
    try { plain = await subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv) }, key, unb64(env.ct)); }
    catch { throw new WrongPassword(); }
    return JSON.parse(td.decode(plain));
  }

  /* ---------- GitHub storage (Contents API) ---------- */
  class SyncError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
  const clean = s => String(s || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
  function api(cfg, suffix) {
    const owner = encodeURIComponent(clean(cfg.owner)), repo = encodeURIComponent(clean(cfg.repo));
    return `https://api.github.com/repos/${owner}/${repo}${suffix || ""}`;
  }
  async function gh(cfg, url, init) {
    let res;
    try {
      res = await fetch(url, Object.assign({ cache: "no-store" }, init, {
        headers: Object.assign({ Accept: "application/vnd.github+json", Authorization: "Bearer " + cfg.token.trim(), "X-GitHub-Api-Version": "2022-11-28" }, (init && init.headers) || {}),
      }));
    } catch { throw new SyncError("Нет связи с GitHub. Проверьте интернет.", "offline"); }
    if (res.status === 401) throw new SyncError("GitHub не принял токен. Проверьте, что он скопирован целиком и не истёк.", "auth");
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") throw new SyncError("GitHub временно ограничил запросы. Попробуйте через час.", "rate");
    return res;
  }
  // Refuse to sync into a public repository, even though the file is encrypted.
  async function checkRepo(cfg) {
    const res = await gh(cfg, api(cfg));
    if (res.status === 404 || res.status === 403) throw new SyncError("Репозиторий не найден или токену не дан доступ к нему.", "no_repo");
    if (!res.ok) throw new SyncError("GitHub ответил ошибкой " + res.status + ".", "http");
    const info = await res.json();
    if (!info.private) throw new SyncError("Репозиторий публичный. Для синхронизации нужен приватный репозиторий.", "public_repo");
    return true;
  }
  async function pull(cfg) {
    const res = await gh(cfg, api(cfg, "/contents/" + FILE));
    if (res.status === 404) return { env: null, sha: null };
    if (res.status === 403) throw new SyncError("Токену не хватает прав: нужен доступ Contents — Read and write к этому репозиторию.", "forbidden");
    if (!res.ok) throw new SyncError("GitHub ответил ошибкой " + res.status + ".", "http");
    const body = await res.json();
    let text;
    if (body.content) text = atob(String(body.content).replace(/\s/g, ""));
    else {  // GitHub omits inline content for files over 1 MB
      const raw = await gh(cfg, api(cfg, "/contents/" + FILE), { headers: { Accept: "application/vnd.github.raw" } });
      if (!raw.ok) throw new SyncError("GitHub ответил ошибкой " + raw.status + ".", "http");
      text = await raw.text();
    }
    return { env: JSON.parse(text), sha: body.sha };
  }
  async function push(cfg, env, sha) {
    const res = await gh(cfg, api(cfg, "/contents/" + FILE), {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ message: "sync " + new Date().toISOString(), content: btoa(JSON.stringify(env)) }, sha ? { sha } : {})),
    });
    if (res.status === 409) return false;   // someone else wrote first: pull, merge, retry
    if (res.status === 422) {
      let msg = ""; try { msg = String((await res.json()).message || ""); } catch {}
      if (/sha/i.test(msg)) return false;
      throw new SyncError("GitHub отклонил запись" + (msg ? ": " + msg : "") + ".", "rejected");
    }
    if (res.status === 403 || res.status === 404) throw new SyncError("Токену не хватает прав: нужен доступ Contents — Read and write к этому репозиторию.", "forbidden");
    if (!res.ok) throw new SyncError("GitHub ответил ошибкой " + res.status + ".", "http");
    return true;
  }

  /* ---------- merge: per-record last-writer-wins with tombstones ----------
   * state.meta.u[key]   = when the record was last changed
   * state.meta.del[key] = when it was deleted
   * keys: a:<area> l:<log> i:<idea> k:<task> c:<date>|<area> o:<date> timer order
   *       s:<setting> s:work.<setting> theme:<weekday>   (legacy whole-object keys: settings, theme)
   * On equal stamps the remote copy wins, so two devices always converge.
   * Timer-made logs (id "t<start>") keep the shorter length: a block stopped early on one
   * device must not grow back to full length because another device "finished" it later. */
  function merge(L, R) {
    L = L || {}; R = R || {};
    const u = {}, del = {};
    for (const s of [L, R]) {
      const m = s.meta || {};
      for (const [k, t] of Object.entries(m.u || {})) if (!(u[k] >= t)) u[k] = t;
      for (const [k, t] of Object.entries(m.del || {})) if (!(del[k] >= t)) del[k] = t;
    }
    const st = (s, k) => (s.meta && s.meta.u && s.meta.u[k]) || 0;
    const alive = k => !(k in del) || (u[k] || 0) > del[k];
    const pick = k => (st(R, k) >= st(L, k) ? R : L);

    function list(name, p, prefer) {
      const m = new Map();
      for (const s of [L, R]) for (const r of s[name] || []) {
        const t = st(s, p + r.id), cur = m.get(r.id);
        if (!cur) { m.set(r.id, { r, t }); continue; }
        const forced = prefer && prefer(cur.r, r, cur.t, t);
        if (forced) m.set(r.id, { r: forced, t: Math.max(t, cur.t) });
        else if (t >= cur.t) m.set(r.id, { r, t });
      }
      return [...m.values()].filter(x => alive(p + x.r.id)).map(x => x.r);
    }
    function setMap(get, p) {
      // get(state) -> Set of "<keypart>" currently on
      const on = new Set(), sl = get(L), sr = get(R), all = new Set([...sl, ...sr]);
      for (const k of Object.keys(u)) if (k.startsWith(p)) all.add(k.slice(p.length));
      for (const k of all) {
        const tl = st(L, p + k), tr = st(R, p + k);
        const has = tl === 0 && tr === 0 ? (sl.has(k) || sr.has(k)) : (tr >= tl ? sr : sl).has(k);
        if (has) on.add(k);
      }
      return on;
    }

    const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
    // object fields merged one by one, each with its own stamp (falling back to the old whole-object stamp)
    function fields(get, prefix, legacy, skip) {
      const l = get(L) || {}, r = get(R) || {}, res = {};
      for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
        if (skip && skip.includes(k)) continue;
        const tl = st(L, prefix + k) || st(L, legacy), tr = st(R, prefix + k) || st(R, legacy);
        const src = tr >= tl ? (k in r ? r : l) : (k in l ? l : r);
        res[k] = clone(src[k]);
      }
      return res;
    }
    const settings = fields(x => x.settings, "s:", "settings", ["work"]);
    if ((L.settings && L.settings.work) || (R.settings && R.settings.work)) settings.work = fields(x => x.settings && x.settings.work, "s:work.", "settings");
    const out = {
      v: Math.max(L.v || 1, R.v || 1),
      started: !!(L.started || R.started),
      theme: fields(x => x.theme, "theme:", "theme"),
      settings,
      timer: clone(pick("timer").timer) || null,
      meta: { u, del },
    };
    // areas, keeping the order of whichever side reordered last
    const areas = list("areas", "a:"), orderSrc = pick("order").areas || [];
    const rank = id => { const i = orderSrc.findIndex(a => a.id === id); return i < 0 ? 1e9 : i; };
    out.areas = areas.map((a, i) => [a, i]).sort((x, y) => rank(x[0].id) - rank(y[0].id) || x[1] - y[1]).map(x => x[0]);
    // a timer entry keeps the shorter length (an early stop must not grow back), the rest of it comes from the newer edit
    out.logs = list("logs", "l:", (a, b, ta, tb) => (String(a.id)[0] === "t" && a.m !== b.m ? { ...(tb >= ta ? b : a), m: Math.min(a.m, b.m) } : null)).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    out.ideas = list("ideas", "i:");
    out.tasks = list("tasks", "k:");
    const checkSet = s => { const r = new Set(); for (const [d, arr] of Object.entries(s.checks || {})) for (const a of arr || []) r.add(d + "|" + a); return r; };
    out.checks = {};
    for (const k of setMap(checkSet, "c:")) { const [d, a] = k.split("|"); (out.checks[d] = out.checks[d] || []).push(a); }
    out.off = [...setMap(s => new Set(s.off || []), "o:")].sort();
    // drop records whose area no longer exists only from the theme (logs keep history)
    const ids = new Set(out.areas.map(a => a.id));
    if (out.theme) for (const d of Object.keys(out.theme)) out.theme[d] = (out.theme[d] || []).filter(id => ids.has(id));
    return compact(clone(out));
  }

  /* ---------- compact: drop old history everywhere at once ----------
   * Called by merge and by the app before saving, so records pruned on one device
   * are not brought back from another and the synced file stops growing. */
  const LOG_DAYS = 200, TASK_DAYS = 60;
  function dayKey(now, back) {
    const x = new Date(now.getFullYear(), now.getMonth(), now.getDate()); x.setDate(x.getDate() - back);
    return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
  }
  function compact(s, now) {
    now = now || new Date();
    const cut = dayKey(now, LOG_DAYS), taskCut = dayKey(now, TASK_DAYS);
    s.meta = s.meta || { u: {}, del: {} };
    const u = s.meta.u = s.meta.u || {}, del = s.meta.del = s.meta.del || {};
    s.logs = (s.logs || []).filter(l => { const keep = l.d >= cut; if (!keep) delete u["l:" + l.id]; return keep; });
    s.tasks = (s.tasks || []).filter(t => { const keep = t.d >= taskCut; if (!keep) delete u["k:" + t.id]; return keep; });
    for (const d of Object.keys(s.checks || {})) if (d < cut || !(s.checks[d] || []).length) delete s.checks[d];
    s.off = (s.off || []).filter(d => d >= cut);
    for (const k of Object.keys(u)) {
      if ((k.startsWith("c:") && k.slice(2, 12) < cut) || (k.startsWith("o:") && k.slice(2) < cut)) delete u[k];
    }
    const tombCut = now.getTime() - LOG_DAYS * 864e5;
    for (const [k, t] of Object.entries(del)) if (t < tombCut) delete del[k];
    return s;
  }

  const api_ = { FILE, ITER, seal, open, checkRepo, pull, push, merge, compact, WrongPassword, SyncError };
  if (typeof module === "object" && module.exports) module.exports = api_;
  else root.KolesoSync = api_;
})(typeof window !== "undefined" ? window : globalThis);
