// Wordle Wars API: the page's calls, backed by the D1 database "wordle-wars" (binding DB).
// POST /api/<fn> with {args:[...]}: getData, saveScore, saveTalk, removeScore, addPlayer, setReminder.
// Same rules and answer shapes as the old Apps Script, so the page only swapped its call() helper.
// Key-protected (header x-key = secret WW_KEY): GET /api/remind (who gets tonight's 8 PM email; the Apps Script sends it),
// POST /api/admin/import (copy everything from the old sheet) and GET /api/admin/compare (old answer vs new, row for row).
const TZ = "America/Chicago";
const TALK_MAX = 200;
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxA7vOHXjLNmuVIoh2dwcK9WDefszC05_E5DRNbcLeIkQEJ-Mq8ufyxjcpAQcWzd8ip/exec";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
class Oops extends Error {}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function addDays(s, n) {
  const p = s.split("-").map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]) + n * 864e5).toISOString().slice(0, 10);
}
function puzzleOf(s) {
  const p = s.split("-").map(Number);
  return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(2021, 5, 19)) / 864e5);
}
function checkDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Oops("That date looks wrong.");
  const t = today(), first = t.slice(0, 8) + "01", y = addDays(t, -1);
  const start = y < first ? y : first;
  if (date > t || date < start) throw new Oops("You can only log days from this month.");
}
const cleanTalk = text => String(text || "").replace(/[<>]/g, "").replace(/\r/g, "").trim().slice(0, TALK_MAX);
const log = (db, action, detail) => db.prepare("INSERT INTO history (at, by, action, detail) VALUES (?, 'website', ?, ?)")
  .bind(new Date().toISOString(), action, JSON.stringify(detail));
async function playerExists(db, id) {
  return !!(await db.prepare("SELECT 1 FROM players WHERE id = ?").bind(id).first());
}
function talkStmt(db, player, date, text) {
  const at = new Date().toISOString();
  // OR IGNORE: a double tap in the same millisecond must not roll back the score saved with it.
  return db.prepare("INSERT OR IGNORE INTO talk (id, player, date, puzzle, text, at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(at + "_" + player, player, date, puzzleOf(date), text, at);
}

async function getData(db) {
  const [p, s, a, c, t] = await db.batch([
    db.prepare("SELECT * FROM players ORDER BY rowid"),
    db.prepare("SELECT * FROM scores ORDER BY rowid"),
    db.prepare("SELECT * FROM adjustments ORDER BY rowid"),
    db.prepare("SELECT * FROM champions ORDER BY rowid"),
    db.prepare("SELECT * FROM talk ORDER BY at DESC LIMIT 30"),
  ]);
  return {
    players: p.results.map(x => ({ id: x.id, name: x.name, order: Number(x.ord) || 99, remind: !!x.remind, joined: x.joined })),
    scores: s.results.map(x => ({ id: x.id, player: x.player, puzzle: x.puzzle, date: x.date, month: x.month, guesses: x.guesses })),
    adj: a.results.map(x => ({ player: x.player, month: x.month, total: Number(x.total) || 0, through: x.through })),
    champs: c.results.map(x => ({ id: x.month, players: String(x.players).split(",").map(v => v.trim().toLowerCase()).filter(String), total: x.total == null ? null : Number(x.total) })),
    talk: t.results.map(x => ({ id: x.id, player: x.player, date: x.date, puzzle: x.puzzle, text: x.text, at: x.at })),
    today: today(),
  };
}

const ACTIONS = {
  getData: db => getData(db),

  async saveScore(db, player, date, guesses, talk) {
    player = String(player); date = String(date); guesses = Number(guesses);
    if (!(await playerExists(db, player))) throw new Oops("Pick your name first.");
    checkDate(date);
    if (!(guesses >= 1 && guesses <= 7 && Math.floor(guesses) === guesses)) throw new Oops("Pick 1 to 6, or X.");
    const n = puzzleOf(date), id = n + "_" + player, text = cleanTalk(talk);
    const steps = [
      db.prepare("INSERT INTO scores (id, player, puzzle, date, month, guesses, at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET guesses = excluded.guesses, at = excluded.at")
        .bind(id, player, n, date, date.slice(0, 7), guesses, new Date().toISOString()),
      log(db, "saveScore", { player, date, guesses }),
    ];
    if (text) steps.push(talkStmt(db, player, date, text), log(db, "saveTalk", { player, date, text }));
    await db.batch(steps);
    return getData(db);
  },

  async saveTalk(db, player, text) {
    player = String(player); text = cleanTalk(text);
    if (!(await playerExists(db, player))) throw new Oops("Pick your name first.");
    if (!text) throw new Oops("Type some trash talk first.");
    const date = today();
    await db.batch([talkStmt(db, player, date, text), log(db, "saveTalk", { player, date, text })]);
    return getData(db);
  },

  async removeScore(db, player, date) {
    player = String(player); date = String(date);
    checkDate(date);
    const id = puzzleOf(date) + "_" + player;
    await db.batch([db.prepare("DELETE FROM scores WHERE id = ?").bind(id), log(db, "removeScore", { player, date })]);
    return getData(db);
  },

  async addPlayer(db, name) {
    name = String(name || "").replace(/[<>]/g, "").trim().slice(0, 20);
    if (!name) throw new Oops("Type a name first.");
    const taken = (await db.prepare("SELECT id FROM players").all()).results.map(r => r.id);
    if (taken.length >= 30) throw new Oops("The roster is full.");
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "player";
    let id = base, k = 2;
    while (taken.includes(id)) { id = base + k; k++; }
    await db.batch([
      db.prepare("INSERT INTO players (id, name, ord, remind, email, joined) VALUES (?, ?, ?, 0, '', ?)").bind(id, name, taken.length + 1, today()),
      log(db, "addPlayer", { id, name }),
    ]);
    return getData(db);
  },

  async setReminder(db, id, on, email) {
    id = String(id); email = String(email || "").trim();
    if (on && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Oops("That email address doesn't look right.");
    if (!(await playerExists(db, id))) throw new Oops("That player is gone.");
    const stmt = on
      ? (email ? db.prepare("UPDATE players SET remind = 1, email = ? WHERE id = ?").bind(email, id) : db.prepare("UPDATE players SET remind = 1 WHERE id = ?").bind(id))
      : db.prepare("UPDATE players SET remind = 0, email = '' WHERE id = ?").bind(id);
    await db.batch([stmt, log(db, "setReminder", { id, on: !!on })]);
    return getData(db);
  },
};

// ---------- key-protected ----------
async function remindList(db) {
  const t = today();
  const rows = (await db.prepare(
    "SELECT id, name, email FROM players WHERE remind = 1 AND email <> '' AND id NOT IN (SELECT player FROM scores WHERE date = ?) ORDER BY rowid"
  ).bind(t).all()).results;
  return { today: t, puzzle: puzzleOf(t), players: rows };
}

async function fetchSheet(env) {
  const r = await fetch(SCRIPT_URL + "?export=" + encodeURIComponent(env.WW_KEY));
  const o = await r.json().catch(() => null);
  if (!o || !o.tabs) throw new Error("The old sheet didn't answer the export (status " + r.status + ").");
  return o;
}

async function importSheet(db, env) {
  // One-time copy from the old sheet. Once the site is live it would wipe newer scores, so it refuses.
  if ((await db.prepare("SELECT count(*) AS n FROM history WHERE by = 'website'").first()).n)
    throw new Oops("The database is live; importing from the frozen sheet would erase newer scores.");
  const { tabs } = await fetchSheet(env);
  const num = v => (v === "" || v == null ? null : Number(v));
  const steps = ["players", "scores", "adjustments", "champions", "talk"].map(t => db.prepare("DELETE FROM " + t));
  for (const p of tabs.Players) steps.push(db.prepare("INSERT INTO players (id, name, ord, remind, email, joined) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(p.id, p.name, Number(p.order) || 99, String(p.remind).toUpperCase() === "TRUE" ? 1 : 0, p.email || "", p.joined || ""));
  for (const s of tabs.Scores) steps.push(db.prepare("INSERT INTO scores (id, player, puzzle, date, month, guesses, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(s.id, s.player, Number(s.puzzle), s.date, String(s.month).slice(0, 7), Number(s.guesses), s.at || ""));
  for (const a of tabs.Adjustments) steps.push(db.prepare("INSERT INTO adjustments (player, month, total, through, note) VALUES (?, ?, ?, ?, ?)")
    .bind(a.player, String(a.month).slice(0, 7), Number(a.total) || 0, a.through || "", a.note || ""));
  for (const c of tabs.Champions) steps.push(db.prepare("INSERT INTO champions (month, players, total, note) VALUES (?, ?, ?, ?)")
    .bind(String(c.month).slice(0, 7), c.players || "", num(c.total), c.note || ""));
  for (const t of tabs.Talk) steps.push(db.prepare("INSERT INTO talk (id, player, date, puzzle, text, at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(t.id, t.player, t.date, Number(t.puzzle), t.text, t.at));
  steps.push(db.prepare("INSERT INTO history (at, by, action, detail) VALUES (?, 'import', 'import', ?)")
    .bind(new Date().toISOString(), JSON.stringify(Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, v.length])))));
  await db.batch(steps); // one transaction: all or nothing
  return { imported: Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, v.length])) };
}

async function compare(db, env) {
  const old = (await fetchSheet(env)).data, now = await getData(db);
  const key = x => JSON.stringify(x);
  const out = {};
  for (const part of ["players", "scores", "adj", "champs", "talk"]) {
    const a = old[part].map(key), b = now[part].map(key);
    out[part] = { sheet: a.length, database: b.length, only_in_sheet: a.filter(x => !b.includes(x)), only_in_database: b.filter(x => !a.includes(x)) };
  }
  out.match = Object.values(out).every(p => !p.only_in_sheet.length && !p.only_in_database.length);
  return out;
}

export async function onRequest({ request, env, params }) {
  const path = (params.path || []).join("/");
  try {
    if (path === "remind" || path.startsWith("admin/")) {
      if (!env.WW_KEY || request.headers.get("x-key") !== env.WW_KEY) return json({ error: "Not allowed." }, 403);
      if (path === "remind" && request.method === "GET") return json(await remindList(env.DB));
      if (path === "admin/import" && request.method === "POST") return json(await importSheet(env.DB, env));
      if (path === "admin/compare" && request.method === "GET") return json(await compare(env.DB, env));
      return json({ error: "Not found." }, 404);
    }
    const fn = Object.hasOwn(ACTIONS, path) ? ACTIONS[path] : null;
    if (!fn || request.method !== "POST") return json({ error: "Not found." }, 404);
    const body = await request.json().catch(() => ({}));
    return json(await fn(env.DB, ...(Array.isArray(body.args) ? body.args : [])));
  } catch (e) {
    if (e instanceof Oops) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "Something went wrong on our end. Try again." }, 500);
  }
}
