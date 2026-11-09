// Tests for app/sync.js: encryption, merge rules and a two-device sync against a fake GitHub.
// Run: node scripts/test-sync.js
const assert = require("assert/strict");
const S = require("../app/sync.js");

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok  -", name); };

// --- a tiny in-memory imitation of the GitHub Contents API ---
function fakeGitHub({ isPrivate = true } = {}) {
  const store = { file: null, sha: null, n: 0, puts: 0 };
  global.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    const json = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });
    if (!/^Bearer good-token$/.test(init.headers.Authorization)) return json(401, {});
    if (!url.includes("/contents/")) return json(200, { private: isPrivate });
    if (method === "GET") return store.file ? json(200, { content: store.file, sha: store.sha }) : json(404, {});
    const body = JSON.parse(init.body);
    if ((body.sha || null) !== store.sha) return json(409, {});
    store.file = Buffer.from(body.content, "base64").toString("base64").replace(/(.{60})/g, "$1\n"); // GitHub wraps base64
    store.sha = "sha" + ++store.n; store.puts++;
    return json(200, {});
  };
  return store;
}
// the same loop the app runs (app.js syncNow), on a plain object "device"
async function sync(dev, cfg) {
  for (let i = 0; i < 4; i++) {
    const { env, sha } = await S.pull(cfg);
    const remote = env ? await S.open(env, cfg.pass) : null;
    dev.state = remote ? S.merge(dev.state, remote) : S.compact(dev.state);   // like the app: state is always a merge result
    if (remote && same(remote, dev.state)) return;
    if (await S.push(cfg, await S.seal(dev.state, cfg.pass, env && env.salt), sha)) return;
  }
  throw new Error("sync did not settle");
}
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k2 => [k2, x[k2]])) : x));
const same = (a, b) => canon(a) === canon(b);
const base = () => ({ v: 2, started: true, areas: [{ id: "en", name: "Английский" }, { id: "dev", name: "Своя игра" }], logs: [], ideas: [], tasks: [], checks: {}, off: [], theme: { 0: ["en"] }, settings: { block: 45 }, timer: null, meta: { u: {}, del: {} } });

(async () => {
  await test("encrypt → decrypt round trip; ciphertext hides the text", async () => {
    const data = base(); data.ideas.push({ id: "i1", t: "секретная идея" });
    const env = await S.seal(data, "correct horse battery");
    assert.equal(env.format, "koleso-e2e-1");
    assert.ok(!JSON.stringify(env).includes("секрет") && !JSON.stringify(env).includes("Английский"));
    assert.deepEqual(await S.open(env, "correct horse battery"), data);
  });
  await test("wrong passphrase is refused", async () => {
    const env = await S.seal(base(), "right-password");
    await assert.rejects(S.open(env, "wrong-password"), e => e.code === "wrong_password");
  });
  await test("merge: edits on two devices to different records are both kept", async () => {
    const a = base(), b = base();
    a.logs.push({ id: "l1", a: "en", d: "2026-11-09", m: 30 }); a.meta.u["l:l1"] = 100;
    b.logs.push({ id: "l2", a: "dev", d: "2026-11-09", m: 45 }); b.meta.u["l:l2"] = 110;
    b.areas[0].name = "English"; b.meta.u["a:en"] = 120;
    const m = S.merge(a, b);
    assert.deepEqual(m.logs.map(l => l.id).sort(), ["l1", "l2"]);
    assert.equal(m.areas.find(x => x.id === "en").name, "English");
  });
  await test("merge: the newer edit of the same record wins, in both directions", async () => {
    const a = base(), b = base();
    a.areas[1].name = "Игра (старое)"; a.meta.u["a:dev"] = 100;
    b.areas[1].name = "Игра (новое)"; b.meta.u["a:dev"] = 200;
    assert.equal(S.merge(a, b).areas[1].name, "Игра (новое)");
    assert.equal(S.merge(b, a).areas[1].name, "Игра (новое)");
  });
  await test("merge: a deletion is not undone by the other device's older copy", async () => {
    const a = base(), b = base();
    a.ideas.push({ id: "i1", t: "x" }); a.meta.u["i:i1"] = 100;
    b.ideas.push({ id: "i1", t: "x" }); b.meta.u["i:i1"] = 100;
    b.ideas = []; delete b.meta.u["i:i1"]; b.meta.del["i:i1"] = 150;
    assert.equal(S.merge(a, b).ideas.length, 0);
    assert.equal(S.merge(b, a).ideas.length, 0);
  });
  await test("merge: unticking a mini-step on one device survives", async () => {
    const a = base(), b = base();
    a.checks = { "2026-11-09": ["en"] }; a.meta.u["c:2026-11-09|en"] = 100;
    b.checks = {}; b.meta.u["c:2026-11-09|en"] = 200;
    assert.deepEqual(S.merge(a, b).checks, {});
    assert.deepEqual(S.merge(b, a).checks, {});
  });
  await test("merge: the same timer finishing on two devices is logged once", async () => {
    const a = base(), b = base();
    a.logs.push({ id: "t1700", a: "en", d: "2026-11-09", m: 45 }); a.meta.u["l:t1700"] = 100;
    b.logs.push({ id: "t1700", a: "en", d: "2026-11-09", m: 45 }); b.meta.u["l:t1700"] = 101;
    assert.equal(S.merge(a, b).logs.length, 1);
  });
  await test("merge does not modify its inputs", async () => {
    const a = base(), b = base(); b.theme = { 0: ["en", "gone"] }; b.meta.u.theme = 5;
    const before = canon(b); S.merge(a, b); assert.equal(canon(b), before);
  });
  await test("GitHub: public repository is refused", async () => {
    fakeGitHub({ isPrivate: false });
    await assert.rejects(S.checkRepo({ owner: "me", repo: "r", token: "good-token" }), e => e.code === "public_repo");
  });
  await test("GitHub: bad token gives a clear error", async () => {
    fakeGitHub();
    await assert.rejects(S.pull({ owner: "me", repo: "r", token: "bad" }), e => e.code === "auth");
  });
  await test("two devices converge through the encrypted file, with a write conflict in between", async () => {
    const gh = fakeGitHub();
    const cfg = { owner: "me", repo: "koleso-data", token: "good-token", pass: "my secret phrase" };
    const pc = { state: base() }, phone = { state: { v: 2, started: false, areas: [], logs: [], ideas: [], tasks: [], checks: {}, off: [], theme: {}, settings: {}, timer: null, meta: { u: {}, del: {} } } };
    pc.state.logs.push({ id: "l1", a: "en", d: "2026-11-09", m: 30 }); pc.state.meta.u["l:l1"] = 10;
    await sync(pc, cfg);                       // PC uploads first
    assert.ok(gh.file && !Buffer.from(gh.file, "base64").toString().includes("Английский"), "stored file must be ciphertext");
    await sync(phone, cfg);                    // phone downloads everything
    assert.ok(same(phone.state, pc.state));
    // both change something; PC writes while the phone holds an old sha -> 409 -> phone merges and retries
    phone.state.tasks.push({ id: "k1", d: "2026-11-09", t: "отчёт", done: false }); phone.state.meta.u["k:k1"] = 20;
    pc.state.ideas.push({ id: "i9", t: "пиксель-арт" }); pc.state.meta.u["i:i9"] = 21;
    const stale = await S.pull(cfg);
    await sync(pc, cfg);
    assert.equal(await S.push(cfg, await S.seal(phone.state, cfg.pass, stale.env.salt), stale.sha), false, "stale write must be rejected");
    await sync(phone, cfg); await sync(pc, cfg);
    assert.ok(same(phone.state, pc.state));
    assert.equal(pc.state.tasks.length, 1); assert.equal(phone.state.ideas.length, 1);
  });
  await test("audit #1: a stale device finishing an old timer does not stretch a block stopped early", async () => {
    const pc = base(), phone = base();
    // PC stopped the block at 20 min; the phone, unaware, later "finishes" it at full length
    pc.logs.push({ id: "t1000", a: "en", d: "2026-11-09", m: 20 }); pc.meta.u["l:t1000"] = 5000;
    phone.logs.push({ id: "t1000", a: "en", d: "2026-11-09", m: 45 }); phone.meta.u["l:t1000"] = 9000;
    assert.equal(S.merge(pc, phone).logs[0].m, 20);
    assert.equal(S.merge(phone, pc).logs[0].m, 20);
  });
  await test("a split block stays split when another device finishes the same timer late", async () => {
    const pc = base(), phone = base();
    // PC: 50-min work block split into 40 work + 10 game; phone wakes up later and logs the full 50 min
    pc.logs.push({ id: "t3000", a: "en", d: "2026-11-09", m: 40 }, { id: "sabc", a: "dev", d: "2026-11-09", m: 10 });
    pc.meta.u["l:t3000"] = 9000; pc.meta.u["l:sabc"] = 9000;
    phone.logs.push({ id: "t3000", a: "en", d: "2026-11-09", m: 50 }); phone.meta.u["l:t3000"] = 9500;
    for (const m of [S.merge(pc, phone), S.merge(phone, pc)]) {
      assert.equal(m.logs.reduce((s, l) => s + l.m, 0), 50);
      assert.equal(m.logs.find(l => l.id === "t3000").m, 40);
    }
  });
  await test("a timer entry moved to another activity keeps the move and the shorter length", async () => {
    const pc = base(), phone = base();
    // the phone still has the old copy; on the PC the entry was moved to "dev" afterwards
    phone.logs.push({ id: "t2000", a: "en", d: "2026-11-09", m: 15 }); phone.meta.u["l:t2000"] = 5000;
    pc.logs.push({ id: "t2000", a: "dev", d: "2026-11-09", m: 15 }); pc.meta.u["l:t2000"] = 9000;
    assert.equal(S.merge(pc, phone).logs[0].a, "dev"); assert.equal(S.merge(phone, pc).logs[0].a, "dev");
    // same, while the phone also holds a longer length for it
    phone.logs[0].m = 50;
    for (const m of [S.merge(pc, phone), S.merge(phone, pc)]) { assert.equal(m.logs[0].a, "dev"); assert.equal(m.logs[0].m, 15); }
  });
  await test("audit #1: clearing a timer stamped at its end time does not wipe a newer block", async () => {
    const pc = base(), phone = base();
    pc.timer = { a: "dev", start: 7000, dur: 45 }; pc.meta.u.timer = 7000;          // new block started at 7000
    phone.timer = null; phone.meta.u.timer = 1000 + 45 * 60000 > 7000 ? 6000 : 6000; // old block ended at 6000
    assert.equal(S.merge(phone, pc).timer.start, 7000);
    assert.equal(S.merge(pc, phone).timer.start, 7000);
  });
  await test("audit #4: settings edited on two devices keep both changes", async () => {
    const a = base(), b = base();
    a.settings = { block: 45, popup: true, work: { from: "10:00", to: "19:00" } };
    b.settings = JSON.parse(JSON.stringify(a.settings));
    a.settings.work.from = "09:00"; a.meta.u["s:work.from"] = 100;
    b.settings.popup = false; b.meta.u["s:popup"] = 200;
    b.theme = { 0: ["en"], 1: ["dev"] }; b.meta.u["theme:1"] = 210;
    a.theme = { 0: ["en", "dev"], 1: [] }; a.meta.u["theme:0"] = 205;
    for (const m of [S.merge(a, b), S.merge(b, a)]) {
      assert.equal(m.settings.work.from, "09:00");
      assert.equal(m.settings.popup, false);
      assert.deepEqual(m.theme[0], ["en", "dev"]);
      assert.deepEqual(m.theme[1], ["dev"]);
    }
  });
  await test("audit #3: history pruned on one device is not resurrected, and stamps are dropped", async () => {
    const now = new Date(2026, 10, 9);
    const old = { id: "l-old", a: "en", d: "2025-01-01", m: 30 };
    const a = base(), b = base();
    b.logs.push(old); b.meta.u["l:l-old"] = 1; b.checks = { "2025-01-01": ["en"] }; b.meta.u["c:2025-01-01|en"] = 1;
    const m = S.compact(S.merge(a, b), now);
    assert.equal(m.logs.length, 0);
    assert.ok(!("l:l-old" in m.meta.u) && !("c:2025-01-01|en" in m.meta.u));
    assert.deepEqual(m.checks, {});
  });
  await test("GitHub: files over 1 MB are read through the raw endpoint", async () => {
    const env = await S.seal(base(), "phrase-1234");
    global.fetch = async (url, init = {}) => {
      const raw = /raw/.test((init.headers || {}).Accept || "");
      return { ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ content: "", encoding: "none", sha: "s1" }), text: async () => (raw ? JSON.stringify(env) : "") };
    };
    const r = await S.pull({ owner: "me", repo: "r", token: "good-token" });
    assert.equal(r.sha, "s1"); assert.equal(r.env.ct, env.ct);
  });
  await test("GitHub: a 422 that is not a sha conflict is reported, not retried", async () => {
    global.fetch = async () => ({ ok: false, status: 422, headers: { get: () => null }, json: async () => ({ message: "Invalid request: content too large" }) });
    await assert.rejects(S.push({ owner: "me", repo: "r", token: "good-token" }, {}, "x"), e => e.code === "rejected");
    global.fetch = async () => ({ ok: false, status: 422, headers: { get: () => null }, json: async () => ({ message: "sha wasn't supplied" }) });
    assert.equal(await S.push({ owner: "me", repo: "r", token: "good-token" }, {}, null), false);
  });
  await test("wrong passphrase on a second device never overwrites the remote file", async () => {
    const gh = fakeGitHub();
    const good = { owner: "me", repo: "r", token: "good-token", pass: "right phrase" };
    await sync({ state: base() }, good);
    const before = gh.file;
    await assert.rejects(sync({ state: base() }, Object.assign({}, good, { pass: "wrong phrase" })), e => e.code === "wrong_password");
    assert.equal(gh.file, before);
  });
  console.log(`\n${passed} tests passed`);
})().catch(e => { console.error("FAIL:", e); process.exit(1); });
