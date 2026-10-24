import { jsPDF } from 'jspdf';

const TUTOR_NAME = document.body.dataset.tutor || 'Matty';
const SILENCE_MS = 2000;
const IDLE_MS = 30000;
const LOG_KEY = 'speakup_log';
const LEVEL_KEY = 'speakup_level';

const GREETINGS = {
  beginner: `Hello! I am ${TUTOR_NAME}. Let's talk slowly and simply. How are you today?`,
  intermediate: `Hi, I'm ${TUTOR_NAME}. Let's have a chat. How's your day going so far?`,
  advanced: `Hey, I'm ${TUTOR_NAME}. Good to talk. What's been on your mind lately?`,
};

const TOPICS = {
  routine: { opener: 'Let us talk about your day. What time did you wake up today?', starters: ['Tell me what you did this morning.', 'Describe your usual day.', 'What is the best part of your day?'] },
  food: { opener: 'Let us talk about food. What did you eat today?', starters: ['Describe your favourite dish.', 'How do you cook it?', 'What food do you dislike?'] },
  college: { opener: 'Let us talk about college. What are you studying?', starters: ['Tell me about your best friend at college.', 'What subject is hardest for you?', 'What do you want to do after college?'] },
  hobbies: { opener: 'Let us talk about hobbies. What do you enjoy doing in your free time?', starters: ['How did you start this hobby?', 'How often do you do it?', 'Would you like to try a new hobby?'] },
  travel: { opener: 'Let us talk about travel. Where was the last place you visited?', starters: ['Describe a place you want to visit.', 'Do you prefer mountains or beaches?', 'Tell me about a trip with family.'] },
  movies: { opener: 'Let us talk about movies. What was the last film you watched?', starters: ['Tell me the story of that film.', 'Who is your favourite actor?', 'Do you like to watch at home or in a cinema?'] },
  future: { opener: 'Let us talk about your future. What do you want to be in five years?', starters: ['What skills do you want to learn?', 'Where do you want to live?', 'What is your biggest goal?'] },
  family: { opener: 'Let us talk about family. Who do you live with?', starters: ['Tell me about your mother or father.', 'What do you do together on weekends?', 'Describe a happy family memory.'] },
};
const GENERAL_STARTERS = ['Tell me about your day.', 'Describe your favourite place.', 'What did you do last weekend?', 'Talk about something you are proud of.'];

const $ = (s) => document.querySelector(s);
const chatEl = $('#chat');
const emptyEl = $('#empty');
const micBtn = $('#micBtn');
const micLabel = $('#micLabel');
const statusEl = $('#status');
const hintBtn = $('#hintBtn');
const hintEl = $('#hint');
const pdfBtn = $('#pdfBtn');
const pdfCount = $('#pdfCount');

/* ---------- quote ---------- */
const QUOTES = [
  ['The limits of my language mean the limits of my world.', 'Ludwig Wittgenstein'],
  ['It does not matter how slowly you go as long as you do not stop.', 'Attributed to Confucius'],
  ['We are what we repeatedly do. Excellence, then, is not an act, but a habit.', 'Will Durant'],
  ['Education is the most powerful weapon which you can use to change the world.', 'Nelson Mandela'],
  ['Learning never exhausts the mind.', 'Attributed to Leonardo da Vinci'],
];
{
  const [text, by] = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  $('#quote').textContent = text;
  $('#quoteBy').textContent = by;
}

const PROMPTS = [
  'Describe the best meal you have ever had.',
  'Tell me about a day you will never forget.',
  'What would you do with one free week and no limits?',
  'Explain your favourite game to someone who has never played it.',
  'Talk about a person who inspires you, and why.',
  'What is something you learned recently that surprised you?',
  'Describe your perfect weekend from morning to night.',
  'If you could meet anyone, who would it be and what would you ask?',
  'Tell me about a time you were proud of yourself.',
  'What skill do you want to learn this year, and how will you start?',
];
let promptIndex = Math.floor(Math.random() * PROMPTS.length);
let customOpener = '';
const tryText = $('#tryText');
function showPrompt() { tryText.textContent = PROMPTS[promptIndex]; }
showPrompt();
$('#tryNext').addEventListener('click', () => { promptIndex = (promptIndex + 1) % PROMPTS.length; showPrompt(); });
$('#tryGo').addEventListener('click', () => {
  if (active) return;
  customOpener = `Let's start with this. ${PROMPTS[promptIndex]}`;
  micBtn.click();
});

let history = [];
let active = false;
let micOpen = false;
let finishing = false;
let transcript = '';
let interim = '';
let liveBubble = null;
let silenceTimer = null;
let idleTimer = null;
let recognition = null;
let currentUtterance = null;
let level = 'intermediate';
let topic = '';
let hintIndex = 0;
let lastUserBubble = null;

function setState(s, text) {
  document.body.dataset.state = s;
  if (text !== undefined) statusEl.textContent = text;
}

function getVisitorId() {
  try {
    let id = localStorage.getItem('speakup_visitor');
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
      localStorage.setItem('speakup_visitor', id);
    }
    return id;
  } catch { return 'anon'; }
}

/* ---------- level & topic ---------- */
function setLevel(l) {
  level = l;
  try { localStorage.setItem(LEVEL_KEY, l); } catch {}
  document.querySelectorAll('[data-level]').forEach((b) => b.classList.toggle('on', b.dataset.level === l));
}
function setTopic(t) {
  topic = t;
  hintIndex = 0;
  document.querySelectorAll('[data-topic]').forEach((b) => b.classList.toggle('on', b.dataset.topic === t));
}
function newConversation() {
  endConversation('Ready when you are.');
  history = [];
  chatEl.innerHTML = '';
  liveBubble = null;
  lastUserBubble = null;
  hintEl.hidden = true;
  emptyEl.hidden = false;
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.level === level) return;
  setLevel(b.dataset.level);
  newConversation();
}));
document.querySelectorAll('[data-topic]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.topic === topic) return;
  setTopic(b.dataset.topic);
  newConversation();
}));
let saved = 'intermediate';
try { saved = localStorage.getItem(LEVEL_KEY) || saved; } catch {}
setLevel(GREETINGS[saved] ? saved : 'intermediate');
setTopic('');

/* ---------- hints ---------- */
hintBtn.addEventListener('click', () => {
  const list = topic && TOPICS[topic] ? TOPICS[topic].starters : GENERAL_STARTERS;
  hintEl.textContent = list[hintIndex % list.length];
  hintEl.hidden = false;
  hintIndex++;
  if (micOpen) armIdleTimer();
});

/* ---------- practice sheet (per day) ---------- */
function todayKey() { return new Date().toLocaleDateString('en-CA'); }
function readLog() {
  try {
    const d = JSON.parse(sessionStorage.getItem(LOG_KEY) || 'null');
    if (d && d.day === todayKey() && Array.isArray(d.items)) return d;
  } catch {}
  return { day: todayKey(), items: [] };
}
function writeLog(d) { try { sessionStorage.setItem(LOG_KEY, JSON.stringify(d)); } catch {} }
function startNewLog() {
  const topicBtn = document.querySelector(`[data-topic="${topic}"]`);
  writeLog({
    day: todayKey(),
    startedAt: new Date().toISOString(),
    level,
    topic: topic ? (topicBtn ? topicBtn.textContent.trim() : topic) : 'Anything',
    items: [],
  });
  updatePdfButton();
}
function addToLog(said, better, tip) {
  const d = readLog();
  d.items.push({ said, better, tip });
  writeLog(d);
  updatePdfButton();
}
function updatePdfButton() {
  const n = readLog().items.length;
  pdfBtn.disabled = n === 0;
  pdfCount.textContent = n ? `(${n})` : '';
}
function clean(t) {
  return String(t || '').replace(/[^\x20-\x7E -ÿ]/g, "'").replace(/\s+/g, ' ').trim();
}
function downloadPdf() {
  const d = readLog();
  if (!d.items.length) return;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const maxW = W - M * 2;
  let y = M;
  const need = (h) => { if (y + h > H - M) { doc.addPage(); y = M; } };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('My English practice', M, y); y += 24;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(100);
  const when = d.startedAt ? new Date(d.startedAt) : null;
  const whenText = when
    ? when.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.day;
  doc.text(`Conversation on ${whenText}`, M, y); y += 16;
  if (d.level) {
    doc.text(`Level: ${d.level.charAt(0).toUpperCase() + d.level.slice(1)}   Topic: ${d.topic || 'Anything'}`, M, y); y += 16;
  }
  doc.text(`${d.items.length} sentence${d.items.length === 1 ? '' : 's'} to revise`, M, y); y += 26;
  doc.setTextColor(0);

  d.items.forEach((it, i) => {
    const said = doc.splitTextToSize(clean(it.said), maxW - 12);
    const better = doc.splitTextToSize(clean(it.better), maxW - 12);
    const tip = it.tip ? doc.splitTextToSize('Tip: ' + clean(it.tip), maxW - 12) : [];
    need(30 + (said.length + better.length + tip.length) * 15 + 40);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.text(`${i + 1}.`, M, y); y += 16;
    doc.setFontSize(10); doc.setTextColor(150, 60, 50);
    doc.text('You said', M + 12, y); y += 13;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(0);
    doc.text(said, M + 12, y); y += said.length * 15 + 6;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30, 110, 80);
    doc.text('Better way to say it', M + 12, y); y += 13;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(0);
    doc.text(better, M + 12, y); y += better.length * 15 + 4;
    if (tip.length) {
      doc.setFontSize(11); doc.setTextColor(100);
      doc.text(tip, M + 12, y); y += tip.length * 14 + 4;
      doc.setTextColor(0);
    }
    y += 14;
  });
  const stamp = d.startedAt
    ? new Date(d.startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }).replace(':', '')
    : '';
  doc.save(`english-practice-${d.day}${stamp ? '-' + stamp : ''}.pdf`);
}
pdfBtn.addEventListener('click', downloadPdf);
updatePdfButton();

/* ---------- chat bubbles ---------- */
function showChat() { emptyEl.hidden = true; }
function addMessage(role, text, live) {
  showChat();
  const el = document.createElement('div');
  el.className = 'msg ' + (role === 'user' ? 'user' : 'tutor') + (live ? ' live' : '');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = role === 'user' ? 'You' : TUTOR_NAME;
  const t = document.createElement('div');
  t.className = 'text';
  t.textContent = text;
  el.append(who, t);
  chatEl.appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return el;
}
/* ---------- compare what was said with the better version ---------- */
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
function isRealFix(said, better) {
  const a = norm(said), b = norm(better);
  return !!b && a !== b;
}
function wordDiff(said, better) {
  const a = String(said).trim().split(/\s+/);
  const b = String(better).trim().split(/\s+/);
  const key = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '');
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = key(a[i]) === key(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) { out.push(['same', b[j]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(['del', a[i]]); i++; }
    else { out.push(['add', b[j]]); j++; }
  }
  while (i < n) out.push(['del', a[i++]]);
  while (j < m) out.push(['add', b[j++]]);
  return out;
}

function addCorrection(said, better, tip) {
  const el = document.createElement('div');
  el.className = 'fix';
  const line = document.createElement('div');
  line.className = 'diff';
  wordDiff(said, better).forEach(([kind, word]) => {
    const span = document.createElement(kind === 'same' ? 'span' : kind === 'del' ? 'del' : 'ins');
    span.textContent = word;
    line.append(span, document.createTextNode(' '));
  });
  el.appendChild(line);
  if (tip) {
    const t = document.createElement('span');
    t.className = 'tip';
    t.textContent = tip;
    el.appendChild(t);
  }
  chatEl.appendChild(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

/* ---------- speech recognition ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function buildRecognition() {
  const r = new SR();
  r.lang = 'en-IN';
  r.continuous = true;
  r.interimResults = true;
  r.onstart = () => { micOpen = true; };
  r.onresult = (e) => {
    let finalText = '';
    interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const piece = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += piece + ' '; else interim += piece;
    }
    transcript = finalText;
    const shown = (finalText + interim).trim();
    if (!shown) return;
    clearTimeout(idleTimer);
    if (!liveBubble) liveBubble = addMessage('user', shown, true);
    else liveBubble.querySelector('.text').textContent = shown;
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(finishUtterance, SILENCE_MS);
  };
  r.onend = () => {
    micOpen = false;
    if (active && !finishing && !currentUtterance) {
      try { r.start(); } catch {}
    }
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      endConversation('Microphone is blocked. Allow it in your browser, then press Start again.');
    }
  };
  return r;
}

function startListening() {
  if (!recognition) recognition = buildRecognition();
  transcript = ''; interim = ''; liveBubble = null;
  try { recognition.start(); } catch {}
  setState('listening', 'Listening. Speak whenever you are ready.');
}

function armIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (active && micOpen && !liveBubble) endConversation('Paused because it was quiet. Press Start to continue.');
  }, IDLE_MS);
}

function startTurn() {
  if (!active) return;
  finishing = false;
  startListening();
  armIdleTimer();
}

function finishUtterance() {
  if (!active || finishing) return;
  const text = (transcript + ' ' + interim).replace(/\s+/g, ' ').trim();
  finishing = true;
  clearTimeout(silenceTimer);
  try { recognition.stop(); } catch {}
  micOpen = false;
  if (!text) { startTurn(); return; }
  if (liveBubble) { liveBubble.classList.remove('live'); liveBubble.querySelector('.text').textContent = text; lastUserBubble = liveBubble; }
  history.push({ role: 'user', text });
  getReply();
}

/* ---------- ending ---------- */
function endConversation(message) {
  active = false; micOpen = false; finishing = false;
  clearTimeout(silenceTimer); clearTimeout(idleTimer);
  try { recognition && recognition.stop(); } catch {}
  try { speechSynthesis.cancel(); } catch {}
  currentUtterance = null;
  micLabel.textContent = 'Start conversation';
  setState('idle', message || 'Ready when you are.');
}

/* ---------- speaking ---------- */
function speak(text) {
  setState('speaking', `${TUTOR_NAME} is speaking`);
  try { speechSynthesis.cancel(); } catch {}
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = level === 'beginner' ? 0.85 : 1;
  currentUtterance = u;
  let done = false;
  const next = () => {
    if (done) return;
    done = true;
    clearInterval(poll);
    if (currentUtterance === u) currentUtterance = null;
    if (active) startTurn();
  };
  u.onend = next;
  u.onerror = next;
  let started = false;
  u.onstart = () => { started = true; };
  const poll = setInterval(() => {
    if (!active) { clearInterval(poll); return; }
    if (started && !speechSynthesis.speaking) next();
  }, 400);
  speechSynthesis.speak(u);
}

/* ---------- talking to the server ---------- */
async function getReply() {
  setState('thinking', `${TUTOR_NAME} is thinking`);
  const lastUser = history[history.length - 1];
  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Visitor-Id': getVisitorId() },
      body: JSON.stringify({ history, level, topic }),
    });
    if (res.status === 429) {
      endConversation("You've used today's free practice. It resets at 12 AM IST. Download your sheet before you go.");
      return;
    }
    if (res.status === 503 || !res.ok) {
      endConversation(`${TUTOR_NAME} is busy. Your last sentence is saved. Press Start to try again.`);
      return;
    }
    const data = await res.json();
    if (data.has_mistake && data.corrected && lastUser && isRealFix(lastUser.text, data.corrected)) {
      addCorrection(lastUser.text, data.corrected, data.tip);
      addToLog(lastUser.text, data.corrected, data.tip);
    }
    addMessage('ai', data.reply);
    history.push({ role: 'ai', text: data.reply });
    if (!active) return;
    speak(data.reply);
  } catch {
    endConversation(`${TUTOR_NAME} is busy. Your last sentence is saved. Press Start to try again.`);
  }
}

/* ---------- start / end button ---------- */
micBtn.addEventListener('click', () => {
  if (!SR) {
    setState('idle', 'This browser cannot listen. Please open SpeakUp in Chrome or Edge.');
    return;
  }
  if (active) { endConversation('Conversation ended. Your sheet is ready below.'); return; }
  active = true;
  finishing = false;
  micLabel.textContent = 'End conversation';
  hintEl.hidden = true;
  const last = history[history.length - 1];
  if (!last) {
    startNewLog();
    const text = customOpener || (topic && TOPICS[topic] ? TOPICS[topic].opener : GREETINGS[level]);
    customOpener = '';
    addMessage('ai', text);
    history.push({ role: 'ai', text });
    speak(text);
  } else if (last.role === 'user') {
    getReply();
  } else {
    startTurn();
  }
});
