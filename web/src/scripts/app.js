import { jsPDF } from 'jspdf';

const TUTOR_NAME = document.body.dataset.tutor || 'Matty';
const SILENCE_MS = 3000;
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
  const q = $('#quote');
  const qBy = $('#quoteBy');
  if (q && qBy) {
    const [text, by] = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    q.textContent = text;
    qBy.textContent = by;
  }
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
  const M = 44;
  const maxW = W - M * 2;
  const LH = 17;
  const NAVY = [15, 22, 38], BLUE = [59, 130, 246], MUTED = [104, 114, 132];
  const RED = [196, 56, 46], GREEN = [14, 106, 58], LINE = [222, 228, 238];
  const pageTop = M;

  /* ---- header band ---- */
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 98, 'F');
  doc.setFillColor(96, 150, 255);
  [[0, 40, 12], [9, 32, 28], [18, 27, 38], [27, 36, 20]].forEach(([dx, top, h]) => doc.roundedRect(M + dx, top, 5, h, 2.5, 2.5, 'F'));
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
  doc.text('MettleVoice', M + 46, 54);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(170, 186, 216);
  doc.text('My English practice sheet', M + 46, 73);

  const when = d.startedAt ? new Date(d.startedAt) : null;
  const whenText = when
    ? when.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.day;
  doc.text(whenText, W - M, 54, { align: 'right' });
  const lvl = d.level ? d.level.charAt(0).toUpperCase() + d.level.slice(1) : '';
  if (lvl) doc.text(`${lvl}  |  ${d.topic || 'Anything'}`, W - M, 73, { align: 'right' });

  /* ---- summary line ---- */
  let y = 98 + 34;
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(`${d.items.length} sentence${d.items.length === 1 ? '' : 's'} to practise`, M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...MUTED);
  y += 18;
  doc.text('Red crossed words are removed. Green words are the better choice. Say each better sentence out loud.', M, y);
  y += 26;

  const need = (h) => { if (y + h > H - 60) { doc.addPage(); y = pageTop; } };

  /* ---- draw words one by one so we can colour changes ---- */
  const flow = (tokens, x, baseY, width, draw) => {
    doc.setFontSize(12);
    let cx = x, line = 0;
    for (const t of tokens) {
      doc.setFont('helvetica', t.style === 'add' ? 'bold' : 'normal');
      const ww = doc.getTextWidth(t.text);
      const sp = doc.getTextWidth(' ');
      if (cx > x && cx + ww > x + width) { cx = x; line++; }
      if (draw) {
        const yy = baseY + line * LH;
        if (t.style === 'add') {
          doc.setFillColor(214, 244, 226);
          doc.roundedRect(cx - 2, yy - 11.5, ww + 4, 16, 3, 3, 'F');
          doc.setTextColor(...GREEN);
        } else if (t.style === 'del') {
          doc.setTextColor(...RED);
        } else {
          doc.setTextColor(...NAVY);
        }
        doc.text(t.text, cx, yy);
        if (t.style === 'del') {
          doc.setDrawColor(...RED);
          doc.setLineWidth(1);
          doc.line(cx, yy - 3.5, cx + ww, yy - 3.5);
        }
      }
      cx += ww + sp + (t.style === 'add' ? 2 : 0);
    }
    return line + 1;
  };

  d.items.forEach((it, i) => {
    const diff = wordDiff(clean(it.said), clean(it.better));
    const saidTokens = diff.filter(([k]) => k !== 'add').map(([k, w]) => ({ text: w, style: k === 'del' ? 'del' : 'same' }));
    const betterTokens = diff.filter(([k]) => k !== 'del').map(([k, w]) => ({ text: w, style: k === 'add' ? 'add' : 'same' }));
    const innerX = M + 38;
    const innerW = maxW - 38 - 14;
    const sLines = flow(saidTokens, innerX, 0, innerW, false);
    const bLines = flow(betterTokens, innerX, 0, innerW, false);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    const tipLines = it.tip ? doc.splitTextToSize('Tip: ' + clean(it.tip), innerW) : [];

    const h = 20 + 16 + (sLines - 1) * LH + 26 + 16 + (bLines - 1) * LH
      + (tipLines.length ? 20 + (tipLines.length - 1) * 14 : 0) + 24 + 14;
    need(h + 14);

    doc.setDrawColor(...LINE);
    doc.setFillColor(250, 251, 254);
    doc.setLineWidth(0.8);
    doc.roundedRect(M, y, maxW, h, 9, 9, 'FD');

    doc.setFillColor(...BLUE);
    doc.circle(M + 19, y + 23, 10.5, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
    doc.text(String(i + 1), M + 19, y + 26.5, { align: 'center' });

    let cy = y + 20;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...RED);
    doc.text('You said', innerX, cy);
    const s1 = cy + 16;
    flow(saidTokens, innerX, s1, innerW, true);
    cy = s1 + (sLines - 1) * LH + 26;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...GREEN);
    doc.text('Better way to say it', innerX, cy);
    const s2 = cy + 16;
    flow(betterTokens, innerX, s2, innerW, true);
    cy = s2 + (bLines - 1) * LH;

    if (tipLines.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(10.5); doc.setTextColor(...MUTED);
      doc.text(tipLines, innerX, cy + 20);
      cy += 20 + (tipLines.length - 1) * 14;
    }

    cy += 24;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
    doc.text('Say it out loud 3 times', innerX, cy);
    const boxX = innerX + doc.getTextWidth('Say it out loud 3 times') + 12;
    doc.setDrawColor(...MUTED); doc.setLineWidth(0.8);
    for (let k = 0; k < 3; k++) doc.roundedRect(boxX + k * 17, cy - 9, 11, 11, 2, 2, 'S');

    y += h + 14;
  });

  /* ---- things to remember ---- */
  const tips = [];
  d.items.forEach((it) => {
    const t = clean(it.tip);
    if (t && !tips.some((x) => x.toLowerCase() === t.toLowerCase())) tips.push(t);
  });
  if (tips.length) {
    need(60);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...NAVY);
    doc.text('Remember these', M, y + 8);
    y += 28;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
    tips.slice(0, 6).forEach((t) => {
      const lines = doc.splitTextToSize(t, maxW - 18);
      need(lines.length * 15 + 8);
      doc.setFillColor(...BLUE);
      doc.circle(M + 4, y - 3.5, 2.2, 'F');
      doc.setTextColor(...NAVY);
      doc.text(lines, M + 16, y);
      y += lines.length * 15 + 6;
    });
  }

  /* ---- footer on every page ---- */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.8);
    doc.line(M, H - 40, W - M, H - 40);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED);
    doc.text('MettleVoice  |  Free English speaking practice', M, H - 24);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 24, { align: 'right' });
  }

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

// Phones (especially Android Chrome) repeat words in continuous mode,
// so on phones we listen one short burst at a time and join the bursts ourselves.
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
let committed = '';
let session = '';

function currentText() {
  const raw = IS_MOBILE ? committed + ' ' + session : transcript + ' ' + interim;
  return raw.replace(/\s+/g, ' ').trim();
}

function commitSession() {
  const piece = session.replace(/\s+/g, ' ').trim();
  session = '';
  if (!piece) return;
  if (committed.toLowerCase().trim().endsWith(piece.toLowerCase())) return;
  committed = (committed + ' ' + piece).trim();
}

function showLive() {
  const shown = currentText();
  if (!shown) return;
  clearTimeout(idleTimer);
  if (!liveBubble) liveBubble = addMessage('user', shown, true);
  else liveBubble.querySelector('.text').textContent = shown;
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(finishUtterance, SILENCE_MS);
}

function buildRecognition() {
  const r = new SR();
  r.lang = 'en-IN';
  r.continuous = !IS_MOBILE;
  r.interimResults = true;
  r.onstart = () => { micOpen = true; };
  r.onresult = (e) => {
    if (IS_MOBILE) {
      session = e.results[e.results.length - 1][0].transcript;
    } else {
      let finalText = '';
      interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += piece + ' '; else interim += piece;
      }
      transcript = finalText;
    }
    showLive();
  };
  r.onend = () => {
    micOpen = false;
    if (IS_MOBILE && !finishing) commitSession();
    if (active && !finishing && !currentUtterance) {
      setTimeout(() => {
        if (active && !finishing && !currentUtterance) { try { r.start(); } catch {} }
      }, IS_MOBILE ? 150 : 0);
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
  transcript = ''; interim = ''; committed = ''; session = ''; liveBubble = null;
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
  const text = currentText();
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
  clearTimeout(readTimer);
  readPauseMs = 0;
  active = false; micOpen = false; finishing = false;
  clearTimeout(silenceTimer); clearTimeout(idleTimer);
  try { recognition && recognition.stop(); } catch {}
  stopSpeaking();
  micLabel.textContent = 'Start conversation';
  setState('idle', message || 'Ready when you are.');
}

/* ---------- speaking ---------- */
/* ---------- voice: prefer a male English voice on every device ---------- */
let voices = [];
function loadVoices() { try { voices = speechSynthesis.getVoices() || []; } catch { voices = []; } }
loadVoices();
try { speechSynthesis.onvoiceschanged = loadVoices; } catch {}

const MALE_NAME = /\b(male|david|mark|ravi|george|james|daniel|guy|rishi|alex|fred|aaron|arthur|oliver|thomas|liam|prabhat)\b/i;
const MALE_ID = /x-(iom|iol|tpd|gbb|gbd|rjs|end|enc)\b/i;
const FEMALE_NAME = /female|zira|heera|hazel|susan|samantha|karen|moira|tessa|victoria|aria|jenny|libby|sonia|neerja|swara|google us english|google uk english female/i;

function pickVoice() {
  if (!voices.length) loadVoices();
  let best = null, bestScore = -99;
  for (const v of voices) {
    if (!/^en/i.test(v.lang)) continue;
    const id = `${v.name} ${v.voiceURI}`;
    let score = 0;
    if (MALE_NAME.test(v.name) || MALE_ID.test(id)) score += 10;
    if (FEMALE_NAME.test(v.name)) score -= 10;
    if (/en[-_]IN/i.test(v.lang)) score += 3;
    else if (/en[-_](US|GB)/i.test(v.lang)) score += 1;
    if (score > bestScore) { bestScore = score; best = v; }
  }
  return { voice: best, male: bestScore >= 10 };
}

// How long to leave the correction on screen before the mic opens again.
let readPauseMs = 0;
let readTimer = null;
function readTimeFor(text, tip) {
  const words = `${text || ''} ${tip || ''}`.trim().split(/\s+/).length;
  return Math.min(9000, 3000 + words * 250);
}

let speakId = 0;
let currentAudio = null;

function afterSpeech() {
  if (!active) return;
  if (readPauseMs > 0) {
    const wait = readPauseMs;
    readPauseMs = 0;
    setState('thinking', 'Read the correction above. Listening starts in a moment.');
    clearTimeout(readTimer);
    readTimer = setTimeout(() => { if (active) startTurn(); }, wait);
  } else {
    startTurn();
  }
}

function stopSpeaking() {
  speakId++;
  try { speechSynthesis.cancel(); } catch {}
  if (currentAudio) { try { currentAudio.pause(); } catch {} currentAudio = null; }
  currentUtterance = null;
}

// Same voice (Guy) on every device: it is made on the server.
// If it cannot be made, the reply stays on screen and the chat carries on without sound.
function voiceUnavailable(text, id) {
  if (id !== speakId || !active) return;
  currentAudio = null;
  const words = text.split(/\s+/).length;
  const wait = Math.min(8000, 2500 + words * 250);
  setState('thinking', 'Voice is unavailable right now. Read the reply on screen.');
  clearTimeout(readTimer);
  readTimer = setTimeout(() => {
    if (active && id === speakId) { currentUtterance = null; afterSpeech(); }
  }, wait);
}

async function speak(text) {
  setState('speaking', `${TUTOR_NAME} is speaking`);
  stopSpeaking();
  const id = speakId;
  currentUtterance = { server: true };
  let blob = null;
  for (let attempt = 0; attempt < 2 && !blob; attempt++) {
    try {
      const res = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, slow: level === 'beginner' }),
      });
      if (res.ok) blob = await res.blob();
    } catch {}
    if (id !== speakId || !active) return;
    if (!blob && attempt === 0) await new Promise((r) => setTimeout(r, 800));
  }
  if (!blob) { voiceUnavailable(text, id); return; }
  let finished = false;
  const audio = new Audio(URL.createObjectURL(blob));
  currentAudio = audio;
  const done = () => {
    if (finished || id !== speakId) return;
    finished = true;
    currentAudio = null;
    currentUtterance = null;
    afterSpeech();
  };
  audio.onended = done;
  audio.onerror = () => { if (!finished) { finished = true; voiceUnavailable(text, id); } };
  try {
    await audio.play();
  } catch {
    finished = true;
    voiceUnavailable(text, id);
  }
}

function speakWithBrowser(text, id) {
  const u = new SpeechSynthesisUtterance(text);
  const pick = pickVoice();
  if (pick.voice) { u.voice = pick.voice; u.lang = pick.voice.lang; } else { u.lang = 'en-US'; }
  u.pitch = pick.male ? 1 : 0.8;
  u.rate = level === 'beginner' ? 0.85 : 1;
  currentUtterance = u;
  let finished = false;
  const next = () => {
    if (finished || id !== speakId) return;
    finished = true;
    clearInterval(poll);
    if (currentUtterance === u) currentUtterance = null;
    afterSpeech();
  };
  u.onend = next;
  u.onerror = next;
  let started = false;
  u.onstart = () => { started = true; };
  const poll = setInterval(() => {
    if (!active || id !== speakId) { clearInterval(poll); return; }
    if (started && !speechSynthesis.speaking) next();
  }, 400);
  speechSynthesis.speak(u);
}

/* ---------- talking to the server ---------- */
async function getReply() {
  setState('thinking', `${TUTOR_NAME} is thinking`);
  const lastUser = history[history.length - 1];
  const busyMsg = `${TUTOR_NAME} is busy. Your last sentence is saved. Press Start to try again.`;
  try {
    let res = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Visitor-Id': getVisitorId() },
          body: JSON.stringify({ history, level, topic }),
        });
      } catch { res = null; }
      if (!active) return;
      if (res && (res.ok || res.status === 429)) break;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2500));
      if (!active) return;
    }
    if (res && res.status === 429) {
      endConversation("You've used today's free practice. It resets at 12 AM IST. Download your sheet before you go.");
      return;
    }
    if (!res || !res.ok) {
      endConversation(busyMsg);
      return;
    }
    const data = await res.json();
    if (data.has_mistake && data.corrected && lastUser && isRealFix(lastUser.text, data.corrected)) {
      addCorrection(lastUser.text, data.corrected, data.tip);
      addToLog(lastUser.text, data.corrected, data.tip);
      readPauseMs = readTimeFor(data.corrected, data.tip);
    } else {
      readPauseMs = 0;
    }
    addMessage('ai', data.reply);
    history.push({ role: 'ai', text: data.reply });
    if (!active) return;
    speak(data.reply);
  } catch {
    endConversation(busyMsg);
  }
}

/* leaving the page (back button, closing the tab) stops the tutor */
window.addEventListener('pagehide', () => { if (active) endConversation('Ready when you are.'); });

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
