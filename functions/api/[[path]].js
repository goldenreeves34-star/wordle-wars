// Wordle Wars API: the page's calls, backed by the D1 database "wordle-wars" (binding DB).
// POST /api/<fn> with {args:[...]}: getData, saveScore, saveTalk, removeScore, addPlayer, setReminder, practiceGet, practiceGuess,
// and (these also see the signed-in account) me, authEmail, authCode, authGoogle, logout, setName, practiceStart, dailyGet, dailyGuess,
// talkPost, adminList, adminApprove, adminKick, pushOn, pushOff, pushTest.
// Same rules and answer shapes as the old Apps Script, so the page only swapped its call() helper.
// Key-protected (header x-key = secret WW_KEY): GET /api/remind (who gets tonight's 8 PM email; the Apps Script sends it),
// POST /api/push/send (8 PM push to phones whose player hasn't logged or played today; the Apps Script triggers it),
// POST /api/admin/import (copy everything from the old sheet) and GET /api/admin/compare (old answer vs new, row for row).
import { ANSWERS, ALLOWED } from "../../lib/words.js";

const TZ = "America/Chicago";
const TALK_MAX = 200;
// The new way: today's Wordle logs its own score. Nov 25 to 30 is a test run (kept in the daily table, no crown);
// from Dec 1 the old Log tab is closed for new days and today's Wordle writes straight into scores.
const TRIAL_START = "2026-11-25", CUTOVER = "2026-12-01";
const ADMIN = "goldenreeves34@gmail.com";
const FROM = "Wordle Wars <noreply@reevesrestorations.com>";
const SCRIPT_URL ="https://script.google.com/macros/s/AKfycbxA7vOHXjLNmuVIoh2dwcK9WDefszC05_E5DRNbcLeIkQEJ-Mq8ufyxjcpAQcWzd8ip/exec";

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

// Colors for a guess: g = right spot, y = in the word elsewhere, x = not in it (repeat letters handled like Wordle).
function marks(answer, guess) {
  const m = Array(5).fill("x"), left = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) m[i] = "g";
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < 5; i++) if (m[i] === "x" && left[guess[i]]) { m[i] = "y"; left[guess[i]]--; }
  return m.join("");
}
function gameView(answer, rows) {
  const won = rows.includes(answer), over = won || rows.length >= 6;
  return { rows: rows.map(w => ({ w, m: marks(answer, w) })), status: won ? "won" : over ? "lost" : "playing", ...(over ? { answer } : {}) };
}

// ---------- Today's word: a fixed shuffle of ANSWERS seeded by the secret WW_KEY, one word per day from TRIAL_START ----------
// No repeats until the list runs out. Editing ANSWERS reshuffles the days after that edit.
let ORDER = null;
async function dailyOrder(env) {
  if (ORDER) return ORDER;
  if (!env.WW_KEY) throw new Error("WW_KEY is not set.");
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ww-daily:" + env.WW_KEY)));
  let s = (h[0] | h[1] << 8 | h[2] << 16 | h[3] << 24) >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const a = ANSWERS.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return (ORDER = a);
}
const dayIndex = date => Math.round((Date.parse(date) - Date.parse(TRIAL_START)) / 864e5);
async function wordFor(env, date) {
  const o = await dailyOrder(env), n = o.length;
  return o[((dayIndex(date) % n) + n) % n];
}

// ---------- Accounts and sessions ----------
const enc = s => new TextEncoder().encode(s);
async function sha(s) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc(s)))].map(x => x.toString(16).padStart(2, "0")).join("");
}
const randHex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, "0")).join("");
const cleanEmail = e => String(e || "").trim().toLowerCase().slice(0, 120);
const cleanName = n => String(n || "").replace(/[<>]/g, "").trim().slice(0, 20);
const COOKIE = "ww_s";
async function getAccount(db, request) {
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)ww_s=([a-f0-9]{64})/);
  if (!m) return null;
  return db.prepare("SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account WHERE s.token = ? AND s.expires > ? AND a.status <> 'kicked'")
    .bind(await sha(m[1]), new Date().toISOString()).first();
}
function meView(a, env) {
  const base = { googleClientId: env.GOOGLE_CLIENT_ID || "", emailReady: !!env.RESEND_API_KEY, vapidKey: env.VAPID_PUBLIC || "" };
  if (!a) return { ...base, signedIn: false };
  return { ...base, signedIn: true, email: a.email, name: a.name, status: a.status, player: a.player, admin: a.email === ADMIN };
}
// Signs an email in (making the account the first time) and sets the session cookie.
// An email that matches a player's reminder email is linked to that player and approved; anyone else waits for Golden.
async function login(c, email, name) {
  const { db, env } = c;
  let a = await db.prepare("SELECT * FROM accounts WHERE email = ?").bind(email).first();
  if (a && a.status === "kicked") throw new Oops("This account was removed from Wordle Wars.");
  const now = new Date(), steps = [];
  if (!a) {
    const p = await db.prepare("SELECT id, name FROM players WHERE lower(email) = ? AND id NOT IN (SELECT player FROM accounts) ORDER BY rowid").bind(email).first();
    a = { id: randHex(12), email, name: p ? p.name : cleanName(name), player: p ? p.id : "", status: p || email === ADMIN ? "approved" : "pending" };
    steps.push(db.prepare("INSERT INTO accounts (id, email, name, player, status, created) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(a.id, a.email, a.name, a.player, a.status, now.toISOString()), log(db, "signup", { email, player: a.player, status: a.status }));
  }
  const token = randHex(32);
  steps.push(
    db.prepare("DELETE FROM sessions WHERE expires < ?").bind(now.toISOString()),
    db.prepare("INSERT INTO sessions (token, account, expires) VALUES (?, ?, ?)").bind(await sha(token), a.id, new Date(+now + 365 * 864e5).toISOString()),
  );
  await db.batch(steps);
  return new Response(JSON.stringify(meView(a, env)), { headers: {
    "content-type": "application/json", "cache-control": "no-store",
    "set-cookie": `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`,
  } });
}
function needPlayer(c) {
  const a = c.account;
  if (!a) throw new Oops("Sign in first.");
  if (a.status !== "approved") throw new Oops("Golden still needs to approve your account.");
  if (!a.player) throw new Oops("Your account isn't linked to a player yet.");
  return a;
}
function needAdmin(c) {
  if (!c.account || c.account.email !== ADMIN) throw new Oops("Only Golden can do that.");
}

async function getData(db) {
  const [p, s, a, c, t, d] = await db.batch([
    db.prepare("SELECT * FROM players ORDER BY rowid"),
    db.prepare("SELECT * FROM scores ORDER BY rowid"),
    db.prepare("SELECT * FROM adjustments ORDER BY rowid"),
    db.prepare("SELECT * FROM champions ORDER BY rowid"),
    db.prepare("SELECT * FROM talk ORDER BY at DESC LIMIT 30"),
    db.prepare("SELECT player, date, score FROM daily WHERE score IS NOT NULL AND date < ? ORDER BY date").bind(CUTOVER),
  ]);
  return {
    players: p.results.map(x => ({ id: x.id, name: x.name, order: Number(x.ord) || 99, remind: !!x.remind, joined: x.joined })),
    scores: s.results.map(x => ({ id: x.id, player: x.player, puzzle: x.puzzle, date: x.date, month: x.month, guesses: x.guesses })),
    adj: a.results.map(x => ({ player: x.player, month: x.month, total: Number(x.total) || 0, through: x.through })),
    champs: c.results.map(x => ({ id: x.month, players: String(x.players).split(",").map(v => v.trim().toLowerCase()).filter(String), total: x.total == null ? null : Number(x.total) })),
    talk: t.results.map(x => ({ id: x.id, player: x.player, date: x.date, puzzle: x.puzzle, text: x.text, at: x.at })),
    trial: d.results.map(x => ({ player: x.player, date: x.date, guesses: x.score })),
    today: today(),
  };
}

const ACTIONS = {
  getData: db => getData(db),

  async saveScore(db, player, date, guesses, talk) {
    player = String(player); date = String(date); guesses = Number(guesses);
    if (!(await playerExists(db, player))) throw new Oops("Pick your name first.");
    checkDate(date);
    if (date >= CUTOVER) throw new Oops("Scores log themselves now. Play today's Wordle on the Play tab.");
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
    if (today() >= CUTOVER) throw new Oops("Sign in on the Play tab to talk trash.");
    if (!(await playerExists(db, player))) throw new Oops("Pick your name first.");
    if (!text) throw new Oops("Type some trash talk first.");
    const date = today();
    await db.batch([talkStmt(db, player, date, text), log(db, "saveTalk", { player, date, text })]);
    return getData(db);
  },

  async removeScore(db, player, date) {
    player = String(player); date = String(date);
    checkDate(date);
    if (date >= CUTOVER) throw new Oops("Scores log themselves now.");
    const id = puzzleOf(date) + "_" + player;
    await db.batch([db.prepare("DELETE FROM scores WHERE id = ?").bind(id), log(db, "removeScore", { player, date })]);
    return getData(db);
  },

  async addPlayer(db, name) {
    name = String(name || "").replace(/[<>]/g, "").trim().slice(0, 20);
    if (!name) throw new Oops("Type a name first.");
    if (today() >= CUTOVER) throw new Oops("New players sign up on the Play tab.");
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

  // Practice Wordle: anyone, unlimited, never touches the scoreboard (practiceStart is in SESSION_ACTIONS).
  async practiceGet(db, id) {
    const g = await db.prepare("SELECT answer, guesses FROM practice WHERE id = ?").bind(String(id)).first();
    if (!g) throw new Oops("That game expired. Start a new one.");
    return gameView(g.answer, g.guesses ? g.guesses.split(",") : []);
  },

  async practiceGuess(db, id, guess) {
    id = String(id); guess = String(guess || "").toLowerCase();
    const g = await db.prepare("SELECT answer, guesses FROM practice WHERE id = ?").bind(id).first();
    if (!g) throw new Oops("That game expired. Start a new one.");
    const rows = g.guesses ? g.guesses.split(",") : [];
    if (rows.length >= 6 || rows.includes(g.answer)) throw new Oops("That game is over.");
    if (!/^[a-z]{5}$/.test(guess)) throw new Oops("Five letters, please.");
    if (!ALLOWED.has(guess)) throw new Oops("Not in the word list.");
    rows.push(guess);
    await db.prepare("UPDATE practice SET guesses = ? WHERE id = ?").bind(rows.join(","), id).run();
    const v = gameView(g.answer, rows);
    return { marks: v.rows[rows.length - 1].m, status: v.status, ...(v.answer ? { answer: v.answer } : {}) };
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

// Calls that see the signed-in account: c = { db, env, request, account }.
const SESSION_ACTIONS = {
  me: c => meView(c.account, c.env),

  async pushOn(c, id, endpoint) {
    id = String(id); endpoint = String(endpoint || "");
    if (!pushOk(endpoint)) throw new Oops("That phone's push address isn't one we can use.");
    if (!(await playerExists(c.db, id))) throw new Oops("That player is gone.");
    await c.db.batch([
      c.db.prepare("INSERT INTO push_subs (endpoint, player, at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET player = excluded.player").bind(endpoint, id, new Date().toISOString()),
      log(c.db, "pushOn", { id }),
    ]);
    return { ok: true };
  },

  async pushOff(c, endpoint) {
    await c.db.batch([c.db.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(String(endpoint || "")), log(c.db, "pushOff", {})]);
    return { ok: true };
  },

  // Sends one push to this phone right now, so it can be checked without waiting for 8 PM.
  async pushTest(c, endpoint) {
    endpoint = String(endpoint || "");
    if (!(await c.db.prepare("SELECT 1 FROM push_subs WHERE endpoint = ?").bind(endpoint).first())) throw new Oops("Turn push on first.");
    const status = await sendPush(c.env, endpoint);
    if (status < 200 || status > 299) throw new Oops("The push didn't go through (" + status + ").");
    return { ok: true };
  },

  async authEmail(c, email) {
    const { db, env, request } = c;
    email = cleanEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Oops("That email address doesn't look right.");
    if (!env.RESEND_API_KEY) throw new Oops("Email sign-in isn't ready yet. Use Continue with Google.");
    const ip = request.headers.get("cf-connecting-ip") || "", now = Date.now();
    const r = await db.prepare("SELECT (SELECT count(*) FROM codes WHERE ip = ? AND at > ?) AS ipn, (SELECT count(*) FROM codes WHERE email = ? AND at > ?) AS recent")
      .bind(ip, new Date(now - 3600e3).toISOString(), email, new Date(now - 60e3).toISOString()).first();
    if (r.recent) throw new Oops("A code is on its way. Give it a minute before asking again.");
    if (r.ipn >= 10) throw new Oops("Too many codes from here. Try again in an hour.");
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, "0");
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [email], subject: code + " is your Wordle Wars code",
        text: "Your Wordle Wars sign-in code is " + code + ". It works for 10 minutes.\n\nIf you didn't ask for this, you can ignore this email." }),
    });
    if (!sent.ok) { console.error("resend", sent.status, await sent.text()); throw new Oops("Couldn't send the email. Try again in a minute."); }
    await db.batch([
      db.prepare("DELETE FROM codes WHERE at < ?").bind(new Date(now - 864e5).toISOString()),
      db.prepare("INSERT INTO codes (email, ip, code_hash, at, tries) VALUES (?, ?, ?, ?, 0)").bind(email, ip, await sha(email + ":" + code), new Date(now).toISOString()),
    ]);
    return { sent: true };
  },

  async authCode(c, email, code) {
    const { db } = c;
    email = cleanEmail(email); code = String(code || "").replace(/\D/g, "");
    const row = await db.prepare("SELECT id, code_hash, tries FROM codes WHERE email = ? AND at > ? ORDER BY at DESC LIMIT 1")
      .bind(email, new Date(Date.now() - 600e3).toISOString()).first();
    if (!row || row.tries >= 5) throw new Oops("That code expired. Ask for a new one.");
    if (row.code_hash !== await sha(email + ":" + code)) {
      await db.prepare("UPDATE codes SET tries = tries + 1 WHERE id = ?").bind(row.id).run();
      throw new Oops("That code doesn't match. Check the email and try again.");
    }
    await db.prepare("DELETE FROM codes WHERE email = ?").bind(email).run();
    return login(c, email, "");
  },

  async authGoogle(c, credential) {
    const { env } = c;
    if (!env.GOOGLE_CLIENT_ID) throw new Oops("Google sign-in isn't ready yet.");
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(String(credential || "")));
    const t = r.ok ? await r.json() : null;
    if (!t || t.aud !== env.GOOGLE_CLIENT_ID || !["accounts.google.com", "https://accounts.google.com"].includes(t.iss) ||
      String(t.email_verified) !== "true" || !t.email) throw new Oops("Google sign-in didn't go through. Try again.");
    return login(c, cleanEmail(t.email), t.given_name || t.name || "");
  },

  async logout(c) {
    const m = (c.request.headers.get("cookie") || "").match(/(?:^|;\s*)ww_s=([a-f0-9]{64})/);
    if (m) await c.db.prepare("DELETE FROM sessions WHERE token = ?").bind(await sha(m[1])).run();
    return new Response(JSON.stringify(meView(null, c.env)), { headers: {
      "content-type": "application/json", "cache-control": "no-store", "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    } });
  },

  // The name a new account wants on the board (before Golden links it to a player).
  async setName(c, name) {
    const a = c.account;
    if (!a) throw new Oops("Sign in first.");
    if (a.player) throw new Oops("Your name is set by your player.");
    name = cleanName(name);
    if (!name) throw new Oops("Type a name first.");
    await c.db.prepare("UPDATE accounts SET name = ? WHERE id = ?").bind(name, a.id).run();
    return meView({ ...a, name }, c.env);
  },

  async practiceStart(c) {
    const { db, env } = c, id = randHex(16), now = Date.now(), t = today();
    // Never hand out a word that's coming up as today's Wordle in the next 30 days.
    const soon = new Set();
    for (let i = 0; i <= 30; i++) soon.add(await wordFor(env, addDays(t, i)));
    const pool = ANSWERS.filter(w => !soon.has(w));
    await db.batch([
      db.prepare("DELETE FROM practice WHERE at < ?").bind(new Date(now - 2 * 864e5).toISOString()),
      db.prepare("INSERT INTO practice (id, answer, guesses, at) VALUES (?, ?, '', ?)")
        .bind(id, pool[Math.floor(Math.random() * pool.length)], new Date(now).toISOString()),
    ]);
    return { id };
  },

  // Today's Wordle: one game per player per day. The answer stays here; the page gets colors, and the word only once the game ends.
  async dailyGet(c) {
    const a = needPlayer(c), date = today();
    const g = await c.db.prepare("SELECT guesses FROM daily WHERE id = ?").bind(date + "_" + a.player).first();
    return { date, ...gameView(await wordFor(c.env, date), g && g.guesses ? g.guesses.split(",") : []) };
  },

  async dailyGuess(c, guess) {
    const { db, env } = c, a = needPlayer(c), date = today(), id = date + "_" + a.player;
    guess = String(guess || "").toLowerCase();
    if (!/^[a-z]{5}$/.test(guess)) throw new Oops("Five letters, please.");
    if (!ALLOWED.has(guess)) throw new Oops("Not in the word list.");
    await db.prepare("INSERT OR IGNORE INTO daily (id, player, account, date, guesses, score, at) VALUES (?, ?, ?, ?, '', NULL, ?)")
      .bind(id, a.player, a.id, date, new Date().toISOString()).run();
    const g = await db.prepare("SELECT guesses FROM daily WHERE id = ?").bind(id).first();
    const answer = await wordFor(env, date), before = g.guesses ? g.guesses.split(",") : [];
    if (before.length >= 6 || before.includes(answer)) throw new Oops("You already finished today's Wordle.");
    const rows = before.concat(guess), v = gameView(answer, rows);
    const score = v.status === "won" ? rows.length : v.status === "lost" ? 7 : null;
    // Only counts if nobody else wrote in between: stops sending many guesses at once to see extra colors.
    const r = await db.prepare("UPDATE daily SET guesses = ?, score = ?, at = ? WHERE id = ? AND guesses = ?")
      .bind(rows.join(","), score, new Date().toISOString(), id, g.guesses).run();
    if (!r.meta.changes) throw new Oops("One guess at a time. Try again.");
    if (score != null) {
      const steps = [log(db, "dailyDone", { player: a.player, date, score })];
      if (date >= CUTOVER) steps.push(db.prepare("INSERT INTO scores (id, player, puzzle, date, month, guesses, at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET guesses = excluded.guesses, at = excluded.at")
        .bind(puzzleOf(date) + "_" + a.player, a.player, puzzleOf(date), date, date.slice(0, 7), score, new Date().toISOString()));
      await db.batch(steps);
    }
    return { marks: v.rows[rows.length - 1].m, status: v.status, ...(v.answer ? { answer: v.answer } : {}) };
  },

  async talkPost(c, text) {
    const a = needPlayer(c), date = today();
    text = cleanTalk(text);
    if (!text) throw new Oops("Type some trash talk first.");
    await c.db.batch([talkStmt(c.db, a.player, date, text), log(c.db, "saveTalk", { player: a.player, date, text })]);
    return getData(c.db);
  },

  // ---------- Golden only ----------
  async adminList(c) {
    needAdmin(c);
    const [a, p] = await c.db.batch([
      c.db.prepare("SELECT id, email, name, player, status, created FROM accounts WHERE status <> 'kicked' ORDER BY status = 'approved', created"),
      c.db.prepare("SELECT id, name FROM players ORDER BY ord, name"),
    ]);
    return { accounts: a.results, players: p.results };
  },

  // Approve an account: link it to an existing player (their history carries over) or, with no player id, make a new player.
  async adminApprove(c, id, player) {
    needAdmin(c);
    const { db } = c;
    const a = await db.prepare("SELECT * FROM accounts WHERE id = ? AND status <> 'kicked'").bind(String(id)).first();
    if (!a) throw new Oops("That account is gone.");
    const steps = [];
    player = String(player || "");
    if (player) {
      if (!(await playerExists(db, player))) throw new Oops("That player is gone.");
      if (await db.prepare("SELECT 1 FROM accounts WHERE player = ? AND id <> ? AND status <> 'kicked'").bind(player, a.id).first())
        throw new Oops("Another account already plays as them.");
    } else {
      const name = cleanName(a.name) || a.email.split("@")[0].slice(0, 20);
      const taken = (await db.prepare("SELECT id FROM players").all()).results.map(r => r.id);
      const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "player";
      player = base; let k = 2;
      while (taken.includes(player)) { player = base + k; k++; }
      steps.push(db.prepare("INSERT INTO players (id, name, ord, remind, email, joined) VALUES (?, ?, ?, 0, '', ?)").bind(player, name, taken.length + 1, today()));
    }
    steps.push(db.prepare("UPDATE accounts SET status = 'approved', player = ? WHERE id = ?").bind(player, a.id), log(db, "approve", { email: a.email, player }));
    await db.batch(steps);
    return SESSION_ACTIONS.adminList(c);
  },

  // Kick: the account can't sign in again, and that player's scores, games, trash talk and spot on the board are wiped.
  async adminKick(c, id) {
    needAdmin(c);
    const { db } = c;
    const a = await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(String(id)).first();
    if (!a) throw new Oops("That account is gone.");
    if (a.email === ADMIN) throw new Oops("You can't kick yourself.");
    const steps = [
      db.prepare("UPDATE accounts SET status = 'kicked', player = '' WHERE id = ?").bind(a.id),
      db.prepare("DELETE FROM sessions WHERE account = ?").bind(a.id),
      log(db, "kick", { email: a.email, player: a.player }),
    ];
    if (a.player) for (const t of ["scores", "daily", "talk", "adjustments"]) steps.push(db.prepare("DELETE FROM " + t + " WHERE player = ?").bind(a.player));
    if (a.player) steps.push(db.prepare("DELETE FROM players WHERE id = ?").bind(a.player));
    await db.batch(steps);
    return SESSION_ACTIONS.adminList(c);
  },
};

// ---------- push ----------
// Classic Web Push with no payload (never Declarative Web Push: iPhone then skips the service worker). The service worker
// in public/sw.js shows the notification when the empty push arrives.
const PUSH_HOSTS = /^(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)$/;
function pushOk(endpoint) {
  try { const u = new URL(endpoint); return u.protocol === "https:" && endpoint.length < 800 && PUSH_HOSTS.test(u.hostname); } catch { return false; }
}
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), ch => ch.charCodeAt(0));
async function sendPush(env, endpoint) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) throw new Oops("Push isn't set up on the server yet.");
  const pub = unb64u(env.VAPID_PUBLIC);
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", d: env.VAPID_PRIVATE, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33)) },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:" + ADMIN })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc(head + "." + claims)));
  const r = await fetch(endpoint, { method: "POST", headers: { authorization: "vapid t=" + head + "." + claims + "." + b64u(sig) + ", k=" + env.VAPID_PUBLIC, ttl: "3600", urgency: "high" } });
  return r.status;
}
// Phones whose player has neither logged a score today nor finished today's Wordle.
async function pushDue(db, env) {
  const t = today();
  const subs = (await db.prepare(
    "SELECT endpoint FROM push_subs WHERE player NOT IN (SELECT player FROM scores WHERE date = ?1) AND player NOT IN (SELECT player FROM daily WHERE date = ?1 AND score IS NOT NULL)"
  ).bind(t).all()).results;
  let sent = 0, gone = 0, failed = 0;
  for (const s of subs) {
    const status = await sendPush(env, s.endpoint).catch(() => 0);
    if (status === 404 || status === 410) { gone++; await db.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(s.endpoint).run(); }
    else if (status >= 200 && status < 300) sent++;
    else failed++;
  }
  return { today: t, due: subs.length, sent, gone, failed };
}

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
    if (path === "remind" || path === "push/send" || path.startsWith("admin/")) {
      if (!env.WW_KEY || request.headers.get("x-key") !== env.WW_KEY) return json({ error: "Not allowed." }, 403);
      if (path === "remind" && request.method === "GET") return json(await remindList(env.DB));
      if (path === "push/send" && request.method === "POST") return json(await pushDue(env.DB, env));
      if (path === "admin/import" && request.method === "POST") return json(await importSheet(env.DB, env));
      if (path === "admin/compare" && request.method === "GET") return json(await compare(env.DB, env));
      return json({ error: "Not found." }, 404);
    }
    const fn = Object.hasOwn(ACTIONS, path) ? ACTIONS[path] : null;
    const sfn = Object.hasOwn(SESSION_ACTIONS, path) ? SESSION_ACTIONS[path] : null;
    if ((!fn && !sfn) || request.method !== "POST") return json({ error: "Not found." }, 404);
    const body = await request.json().catch(() => ({}));
    const args = Array.isArray(body.args) ? body.args : [];
    if (fn) return json(await fn(env.DB, ...args));
    const out = await sfn({ db: env.DB, env, request, account: await getAccount(env.DB, request) }, ...args);
    return out instanceof Response ? out : json(out);
  } catch (e) {
    if (e instanceof Oops) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "Something went wrong on our end. Try again." }, 500);
  }
}
