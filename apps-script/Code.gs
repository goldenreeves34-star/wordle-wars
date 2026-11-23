// Wordle Wars Apps Script (copy of the live project "Wordle Wars" in Drive).
// Since Nov 22, 2026 the scores live in the Cloudflare D1 database "wordle-wars" and the page is served by Cloudflare Pages.
// This script now only: sends the 8 PM reminder emails from Golden's Gmail (asking the site who still needs one),
// answers the one-time export the database import used, and tells any old copy of the page that the game moved.
// Script Properties: WW_KEY (same secret as the Pages project), MODE ("moved" once the database took over).
const SHEET_ID = '11ssdGnqC1R1hG0Ps0gOgZUNYcbE9cFV_NN9BaW7Fd18';
const PAGE_FILE_ID = '1ojC-Np0JTqNzhSkZV_FtFZb_VmJ4zVAq';
const TALK_MAX = 200;
const TZ = 'America/Chicago';
const APP_URL = 'https://wordlewars.reevesrestorations.com/';
const PROPS = PropertiesService.getScriptProperties();

function moved_() { return PROPS.getProperty('MODE') === 'moved'; }
function notMoved_() {
  if (moved_()) throw new Error('Wordle Wars moved. Close the app and open it again.');
}

function doGet(e) {
  const key = PROPS.getProperty('WW_KEY');
  if (e && e.parameter && e.parameter.export && key && e.parameter.export === key) {
    return ContentService.createTextOutput(JSON.stringify(exportAll_())).setMimeType(ContentService.MimeType.JSON);
  }
  if (moved_()) {
    return HtmlService.createHtmlOutput('<p style="font:18px sans-serif;padding:24px">Wordle Wars moved. ' +
      '<a target="_top" href="' + APP_URL + '">Open it here</a>.</p>')
      .setTitle('Wordle Wars')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  const html = DriveApp.getFileById(PAGE_FILE_ID).getBlob().getDataAsString('UTF-8');
  return HtmlService.createHtmlOutput(html)
    .setTitle('Wordle Wars')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Every tab as plain rows (strings), plus what getData() answers, for the database import and compare.
function exportAll_() {
  const tabs = {};
  ['Players', 'Scores', 'Adjustments', 'Champions', 'Talk'].forEach(function (name) {
    tabs[name] = rows_(name).map(function (r) {
      const o = {};
      Object.keys(r).forEach(function (k) { if (k !== '_row') o[k] = str_(r[k]); });
      return o;
    });
  });
  return { tabs: tabs, data: getData() };
}

// ---------- helpers ----------
function book_() { return SpreadsheetApp.openById(SHEET_ID); }
function sheet_(name) { return book_().getSheetByName(name); }
function str_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return v == null ? '' : String(v).trim();
}
function month_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM');
  return str_(v).slice(0, 7);
}
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function addDays_(s, n) {
  const p = s.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]) + n * 864e5).toISOString().slice(0, 10);
}
function puzzleOf_(s) {
  const p = s.split('-').map(Number);
  return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(2021, 5, 19)) / 864e5);
}
function rows_(name) {
  const v = sheet_(name).getDataRange().getValues();
  const head = v.shift().map(String);
  return v.map(function (r, i) {
    const o = { _row: i + 2 };
    head.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  }).filter(function (o) { return str_(o[head[0]]) !== ''; });
}
function bool_(v) { return v === true || str_(v).toUpperCase() === 'TRUE'; }
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- reads ----------
function getData() {
  const players = rows_('Players').map(function (p) {
    return { id: str_(p.id), name: str_(p.name), order: Number(p.order) || 99, remind: bool_(p.remind), joined: str_(p.joined) };
  });
  const scores = rows_('Scores').map(function (s) {
    return { id: str_(s.id), player: str_(s.player), puzzle: Number(s.puzzle), date: str_(s.date), month: month_(s.month), guesses: Number(s.guesses) };
  });
  const adj = rows_('Adjustments').map(function (a) {
    return { player: str_(a.player), month: month_(a.month), total: Number(a.total) || 0, through: str_(a.through) };
  });
  const champs = rows_('Champions').map(function (c) {
    return {
      id: month_(c.month),
      players: str_(c.players).split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(String),
      total: str_(c.total) === '' ? null : Number(c.total)
    };
  });
  const talk = rows_('Talk').map(function (t) {
    return { id: str_(t.id), player: str_(t.player), date: str_(t.date), puzzle: Number(t.puzzle), text: str_(t.text), at: str_(t.at) };
  }).sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; }).slice(0, 30);
  return { players: players, scores: scores, adj: adj, champs: champs, talk: talk, today: today_() };
}

// ---------- writes (refused once MODE is "moved") ----------
function playerExists_(id) {
  return rows_('Players').some(function (p) { return str_(p.id) === id; });
}
function checkDate_(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('That date looks wrong.');
  const t = today_(), first = t.slice(0, 8) + '01', y = addDays_(t, -1);
  const start = y < first ? y : first;
  if (date > t || date < start) throw new Error('You can only log days from this month.');
}
function saveScore(player, date, guesses, talk) {
  notMoved_();
  player = String(player); date = String(date); guesses = Number(guesses);
  if (!playerExists_(player)) throw new Error('Pick your name first.');
  checkDate_(date);
  if (!(guesses >= 1 && guesses <= 7 && Math.floor(guesses) === guesses)) throw new Error('Pick 1 to 6, or X.');
  return withLock_(function () {
    const n = puzzleOf_(date), id = n + '_' + player;
    const row = [id, player, String(n), date, date.slice(0, 7), String(guesses), new Date().toISOString()];
    const found = rows_('Scores').filter(function (s) { return str_(s.id) === id; })[0];
    const sh = sheet_('Scores');
    if (found) sh.getRange(found._row, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    addTalk_(player, date, talk);
    return getData();
  });
}
// ---------- trash talk ----------
function cleanTalk_(text) {
  return String(text || '').replace(/[<>]/g, '').replace(/\r/g, '').trim().slice(0, TALK_MAX);
}
function addTalk_(player, date, text) {
  text = cleanTalk_(text);
  if (!text) return;
  const at = new Date().toISOString();
  // Leading apostrophe keeps Sheets from reading a message like =1+1 as a formula.
  sheet_('Talk').appendRow([at + '_' + player, player, date, String(puzzleOf_(date)), "'" + text, at]);
}
function saveTalk(player, text) {
  notMoved_();
  player = String(player);
  if (!playerExists_(player)) throw new Error('Pick your name first.');
  if (!cleanTalk_(text)) throw new Error('Type some trash talk first.');
  return withLock_(function () {
    addTalk_(player, today_(), text);
    return getData();
  });
}

function removeScore(player, date) {
  notMoved_();
  player = String(player); date = String(date);
  checkDate_(date);
  return withLock_(function () {
    const id = puzzleOf_(date) + '_' + player;
    const found = rows_('Scores').filter(function (s) { return str_(s.id) === id; })[0];
    if (found) sheet_('Scores').deleteRow(found._row);
    return getData();
  });
}
function addPlayer(name) {
  notMoved_();
  name = String(name || '').replace(/[<>]/g, '').trim().slice(0, 20);
  if (!name) throw new Error('Type a name first.');
  return withLock_(function () {
    const list = rows_('Players');
    if (list.length >= 30) throw new Error('The roster is full.');
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'player';
    let id = base, k = 2;
    const taken = list.map(function (p) { return str_(p.id); });
    while (taken.indexOf(id) >= 0) { id = base + k; k++; }
    sheet_('Players').appendRow([id, name, String(list.length + 1), 'FALSE', '', today_()]);
    return getData();
  });
}
function setReminder(id, on, email) {
  notMoved_();
  id = String(id); email = String(email || '').trim();
  if (on && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That email address doesn't look right.");
  return withLock_(function () {
    const p = rows_('Players').filter(function (x) { return str_(x.id) === id; })[0];
    if (!p) throw new Error('That player is gone.');
    const sh = sheet_('Players');
    if (on) {
      sh.getRange(p._row, 4).setValue('TRUE');
      if (email) sh.getRange(p._row, 5).setValue(email);
    } else {
      sh.getRange(p._row, 4, 1, 2).setValues([['FALSE', '']]);
    }
    return getData();
  });
}

// ---------- 8 PM reminders ----------
// Who to email: once MODE is "moved", the site's database says (GET /api/remind); before that, the sheet.
function remindList_() {
  if (moved_()) {
    const r = UrlFetchApp.fetch(APP_URL + 'api/remind', { headers: { 'x-key': PROPS.getProperty('WW_KEY') }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('Reminder list failed: ' + r.getResponseCode() + ' ' + r.getContentText().slice(0, 200));
    const o = JSON.parse(r.getContentText());
    return { n: o.puzzle, players: o.players };
  }
  const t = today_(), logged = {};
  rows_('Scores').forEach(function (s) { if (str_(s.date) === t) logged[str_(s.player)] = true; });
  const players = rows_('Players').filter(function (p) {
    return bool_(p.remind) && str_(p.email) && !logged[str_(p.id)];
  }).map(function (p) { return { id: str_(p.id), name: str_(p.name), email: str_(p.email) }; });
  return { n: puzzleOf_(t), players: players };
}
function sendReminders() {
  const list = remindList_();
  const url = APP_URL;
  const num = list.n.toLocaleString('en-US');
  list.players.forEach(function (p) {
    const name = p.name;
    MailApp.sendEmail({
      to: p.email,
      subject: 'Wordle Wars: log Wordle ' + num,
      body: 'Hi ' + name + ', you haven\'t logged today\'s Wordle (' + num + ') yet. ' +
        'A day you don\'t log counts as 7 once midnight hits.\n\nLog it here: ' + url,
      htmlBody: '<p>Hi ' + name + ',</p><p>You haven\'t logged today\'s Wordle (' + num + ') yet. ' +
        'A day you don\'t log counts as 7 once midnight hits.</p>' +
        '<p><a href="' + url + '">Log your score</a></p>',
      name: 'Wordle Wars'
    });
  });
}

// Run once from the editor: turns on the daily 8 PM reminder.
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (tr.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('sendReminders').timeBased().everyDays(1).atHour(20).nearMinute(0).inTimezone(TZ).create();
  return getData().players.length + ' players found. Reminders run daily at 8 PM Central.';
}
