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
    if (remote) dev.state = S.merge(dev.state, remote);
    if (remote && JSON.stringify(S.merge(remote, dev.state)) === JSON.stringify(S.merge(dev.state, remote)) && same(remote, dev.state)) return;
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
