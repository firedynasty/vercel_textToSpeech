// Page Turner — a Kindle-style read-aloud reader.
//
// The text is split into sentences, cut into pages that exactly fit the screen
// (breaking only between sentences), and read aloud one sentence at a time. A
// wide screen shows two facing pages, like an open book. At the end of a spread
// a chime sounds, the pages turn on their own, and reading continues. Tap any
// sentence to start there.
//
// Articles live in a library backed by Vercel Blob (/api/files), so the queue
// you build with the Page Scraper extension follows you between devices. On
// localhost the same library is kept in localStorage.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './reader.css';

/* ============================== text parsing ============================== */

// A chunk ending like this is not the end of a sentence: a known abbreviation,
// a single initial ("J."), or a bare number ("2." in "2.4%").
const ABBR = /(?:\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|Inc|Corp|Co|Ltd|No|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Gov|Sen|Rep|Gen|Prof|Fig|Est|approx|U\.S|U\.K|a\.m|p\.m|e\.g|i\.e)\.|\b[A-Za-z]\.|\b\d+\.)["'’”)\]]*\s*$/;

const RE_RULE = /^([=_]{3,}|-{3,})$/;
const RE_HEAD = /^(#{1,6})\s+(.*\S)\s*$/;
const RE_LI = /^([-*+]|\d{1,2}[.)])\s+(.*\S)\s*$/;
const RE_QUOTE = /^>\s?(.*)$/;
const RE_URL = /^(?:URL:\s*)?(https?:\/\/\S+)$/i;
const RE_STAMP = /^\[\d{1,2}:\d{2}(?::\d{2})?\]$/;
const RE_META = /^(URL|Scraped|Author|Time|Posted|Engagement|Total|Source|Canonical|Tags|Date):\s*/i;

// Strip inline markdown so the voice never reads asterisks or link targets.
function stripInline(s) {
  return String(s || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text) {
  const raw = String(text || '').trim().match(/[^.!?]+(?:[.!?]+["'’”)\]]*\s*|$)/g) || [];
  const out = [];
  for (const chunk of raw) {
    // "Dr." or "U.S." is not the end of a sentence — glue it to what follows.
    if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += chunk;
    else out.push(chunk);
  }
  const trimmed = out.map((s) => s.trim()).filter(Boolean);
  return trimmed.length ? trimmed : (String(text || '').trim() ? [String(text).trim()] : []);
}

// Turn scraped text into renderable items. Line 1 is the title, an optional URL
// line follows, then markdown-ish blocks: ## headings, - lists, > quotes,
// [0:01:23] timestamps and "Author:" lines (shown but not spoken).
function parseDoc(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const items = [];
  let buf = [];

  const flushPara = () => {
    if (!buf.length) return;
    const text = stripInline(buf.join(' '));
    buf = [];
    if (text) items.push({ type: 'p', sents: splitSentences(text) });
  };
  const spoken = (type, text, extra) => ({ type, text, sents: splitSentences(text), ...extra });

  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i < lines.length) {
    const first = stripInline(lines[i].trim().replace(/^#{1,6}\s+/, ''));
    if (first) items.push(spoken('title', first));
    i++;
  }
  // An immediately following bare URL is the source line.
  let j = i;
  while (j < lines.length && !lines[j].trim()) j++;
  if (j < lines.length) {
    const m = lines[j].trim().match(RE_URL);
    if (m) { items.push({ type: 'source', text: m[1] }); i = j + 1; }
  }

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { flushPara(); continue; }

    if (RE_RULE.test(line)) { flushPara(); items.push({ type: 'rule' }); continue; }
    if (RE_STAMP.test(line) || RE_META.test(line)) { flushPara(); items.push({ type: 'label', text: line }); continue; }

    const h = line.match(RE_HEAD);
    if (h) { flushPara(); items.push(spoken('head', stripInline(h[2]), { level: Math.min(h[1].length, 2) })); continue; }

    const q = line.match(RE_QUOTE);
    if (q) { flushPara(); const t = stripInline(q[1]); if (t) items.push(spoken('quote', t)); continue; }

    const li = line.match(RE_LI);
    if (li) { flushPara(); const t = stripInline(li[2]); if (t) items.push(spoken('li', t)); continue; }

    // Short all-caps lines are section markers in the X/Twitter scrapes.
    if (line.length <= 48 && !/[.!?]$/.test(line) && line === line.toUpperCase() && /[A-Z]{3}/.test(line)) {
      flushPara(); items.push(spoken('head', stripInline(line), { level: 2 })); continue;
    }

    buf.push(line);
  }
  flushPara();
  return items;
}

const SPOKEN = { title: true, head: true, p: true, li: true, quote: true };

/* ============================== pagination ==============================
   Pages are cut by measuring, not by counting characters: each column is filled
   in a hidden sheet of exactly the on-screen size until the next sentence would
   overflow, so a page never scrolls. Breaks still fall only between sentences.
   Columns are then grouped into spreads (two facing pages on a wide screen). */

// Paragraphs split into one piece per sentence; everything else is one piece.
function piecesOf(items) {
  const out = [];
  items.forEach((it, i) => {
    if (it.type === 'p') it.sents.forEach((_, s) => out.push({ i, s }));
    else out.push({ i });
  });
  return out;
}

// Rebuild the items for pieces [a, b), regrouping sentences into paragraph chunks.
function itemsFromRange(items, pieces, a, b) {
  const out = [];
  let chunk = null;
  for (let k = a; k < b; k++) {
    const { i, s } = pieces[k];
    if (s === undefined) { chunk = null; out.push(items[i]); continue; }
    if (!chunk || chunk.src !== i) {
      chunk = { type: 'p', sents: [], cont: s > 0, src: i };
      out.push(chunk);
    }
    chunk.sents.push(items[i].sents[s]);
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const spansHTML = (sents) => sents.map((s, k) => '<span class="s">' + esc(k === sents.length - 1 ? s : s + ' ') + '</span>').join('');

// Same markup and classes as the rendered page, for measuring only.
function pageHTML(list) {
  let h = list.some((it) => it.type === 'title') ? '' : '<p class="kicker">Continued</p>';
  let inList = false;
  for (const it of list) {
    if (it.type !== 'li' && inList) { h += '</ul>'; inList = false; }
    if (it.type === 'title') h += '<p class="kicker">Now reading</p><h1 class="title">' + spansHTML(it.sents) + '</h1>';
    else if (it.type === 'source') h += '<p class="source">' + esc(it.text) + '</p>';
    else if (it.type === 'label') h += '<p class="label">' + esc(it.text) + '</p>';
    else if (it.type === 'rule') h += '<hr class="rule">';
    else if (it.type === 'head') { const t = it.level <= 1 ? 'h2' : 'h3'; h += '<' + t + ' class="head">' + spansHTML(it.sents) + '</' + t + '>'; }
    else if (it.type === 'quote') h += '<blockquote class="quote">' + spansHTML(it.sents) + '</blockquote>';
    else if (it.type === 'li') { if (!inList) { h += '<ul class="list">'; inList = true; } h += '<li class="item">' + spansHTML(it.sents) + '</li>'; }
    else h += '<p class="body' + (it.cont ? ' cont' : '') + '">' + spansHTML(it.sents) + '</p>';
  }
  return inList ? h + '</ul>' : h;
}

// Fill columns greedily using the hidden measuring sheet's body.
function measureColumns(items, body) {
  const pieces = piecesOf(items);
  const n = pieces.length;
  const fits = (a, b) => {
    body.innerHTML = pageHTML(itemsFromRange(items, pieces, a, b));
    return body.scrollHeight <= body.clientHeight + 1;
  };
  const cols = [];
  let a = 0;
  while (a < n) {
    let good = a + 1; // one piece always goes, even a sentence too tall for any page
    if (fits(a, good)) {
      // Gallop out, then binary-search back to the last piece that fits.
      let step = 1;
      let bad = -1;
      while (good < n) {
        const t = Math.min(n, good + step);
        if (fits(a, t)) { good = t; step *= 2; } else { bad = t; break; }
      }
      if (bad > 0) {
        let lo = good;
        let hi = bad;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (fits(a, m)) lo = m; else hi = m; }
        good = lo;
      }
    }
    // Never leave a heading stranded as the last thing on a page.
    const lastType = items[pieces[good - 1].i].type;
    if (good < n && good - a > 1 && (lastType === 'head' || lastType === 'title')) good -= 1;
    cols.push(itemsFromRange(items, pieces, a, good));
    a = good;
  }
  body.innerHTML = '';
  return cols;
}

const NOTHING = [{ type: 'p', sents: ['Nothing to read yet. Open the library or paste some text.'] }];

// Group columns into spreads. `first` is the first column's number, `start` the
// spread's first sentence counted from the top of the article.
function groupSpreads(cols, per) {
  const list = cols.length ? cols : [NOTHING];
  const out = [];
  let start = 0;
  for (let k = 0; k < list.length; k += per) {
    const sp = { cols: list.slice(k, k + per), first: k, start };
    start += unitsOf(sp).length;
    out.push(sp);
  }
  return out;
}

// The spread holding sentence number g.
const spreadFor = (spreads, g) => {
  let p = 0;
  for (let k = 0; k < spreads.length; k++) if (spreads[k].start <= g) p = k;
  return p;
};

// The flat list of spoken sentences on a spread, in reading order.
function unitsOf(spread) {
  const out = [];
  (spread ? spread.cols : []).forEach((col) => col.forEach((it) => {
    if (!SPOKEN[it.type] || !it.sents) return;
    it.sents.forEach((text) => out.push({ text }));
  }));
  return out;
}

const titleOf = (text) => {
  const line = String(text || '').split('\n').find((l) => l.trim());
  return stripInline((line || '').replace(/^#{1,6}\s+/, '')).slice(0, 110) || 'Untitled';
};

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';

/* ============================ silent track ============================ */

// A 10-second mono WAV of faint dither (±1 of 32767, about -90 dB, inaudible).
// Not true zeros, and longer than 5 s, because Chrome only hands media keys to
// audio it treats as real content.
let silentURL = null;
function silentTrackURL() {
  if (silentURL) return silentURL;
  const rate = 8000;
  const samples = rate * 10;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples * 2, true);
  for (let k = 0; k < samples; k++) v.setInt16(44 + k * 2, k % 2 ? 1 : -1, true);
  silentURL = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silentURL;
}

/* ============================== storage =============================== */

const IS_LOCAL = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const ACCESS_CODE = IS_LOCAL ? 'localhost' : '123';
const POS_FILE = 'reading-positions.json';

const lsGet = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v === null ? fallback : v; } catch { return fallback; }
};
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const lsJSON = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };

const localStore = {
  async list() {
    return lsJSON('pt.lib', []);
  },
  async get(name) {
    return lsGet('pt.doc.' + name, '');
  },
  async put(name, content) {
    lsSet('pt.doc.' + name, content);
    const lib = lsJSON('pt.lib', []).filter((d) => d.name !== name);
    lib.unshift({ name, title: titleOf(content), chars: content.length, updatedAt: new Date().toISOString() });
    lsSet('pt.lib', JSON.stringify(lib));
    return true;
  },
  async del(name) {
    try { localStorage.removeItem('pt.doc.' + name); } catch { /* ignore */ }
    lsSet('pt.lib', JSON.stringify(lsJSON('pt.lib', []).filter((d) => d.name !== name)));
    return true;
  },
};

const blobStore = {
  async list() {
    const r = await fetch('/api/files?meta=1');
    if (!r.ok) throw new Error('List failed (' + r.status + ')');
    const data = await r.json();
    return (data.files || [])
      .filter((f) => f.name !== POS_FILE)
      .map((f) => ({ name: f.name, title: f.title || f.name.replace(/\.txt$/, ''), chars: f.size || 0, updatedAt: f.uploadedAt }));
  },
  async get(name) {
    const r = await fetch('/api/files?filename=' + encodeURIComponent(name));
    if (!r.ok) throw new Error('Load failed (' + r.status + ')');
    const data = await r.json();
    return data.content || '';
  },
  async put(name, content) {
    const r = await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: name, content, accessCode: ACCESS_CODE }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Save failed');
    return true;
  },
  async del(name) {
    const r = await fetch('/api/files?filename=' + encodeURIComponent(name), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessCode: ACCESS_CODE }),
    });
    if (!r.ok) throw new Error('Delete failed');
    return true;
  },
};

const store = IS_LOCAL ? localStore : blobStore;

/* ============================== sample text ============================== */

const SAMPLE = [
  'Page Turner',
  '## How this reader works',
  'Press play and the reader speaks one sentence at a time, highlighting as it goes. At the end of a page a chime sounds, the page turns on its own, and reading carries on — the same rhythm as the Kindle Paperwhite read-aloud.',
  'Tap any sentence to start from that spot. The space bar pauses and resumes, the left and right arrows turn pages, and the up and down arrows step one sentence at a time.',
  '## Getting text in',
  'Press Alt+Shift+S on any article with the Page Scraper extension and the page lands on your clipboard as a title, a URL, and clean paragraphs. Press Paste, then Read and save, and it is ready.',
  'Saving an article puts it in the library on Vercel Blob, so the queue you build on the laptop is waiting on the phone. Your place in each article is remembered too.',
  'Everything else, including the macOS speak clipboard app, stays as it was. This page is only the long-form reader.',
].join('\n\n');

/* ============================== component ============================== */

const PageTurnerReader = () => {
  /* ---- settings (persisted) ---- */
  const [dark, setDark] = useState(() => lsGet('pt.dark', '') === '1');
  const [rate, setRate] = useState(() => parseFloat(lsGet('pt.rate', '1')) || 1);
  const [size, setSize] = useState(() => parseInt(lsGet('pt.size', '21'), 10) || 21);
  const [ding, setDing] = useState(() => lsGet('pt.ding', '1') !== '0');
  const [headphoneMode, setHeadphoneMode] = useState(() => {
    const saved = lsGet('pt.headphones', '0');
    if (saved === 'scroll') return 'scroll';
    return saved === '1' || saved === 'playpause' ? 'playpause' : '0';
  });
  const headphonesEnabled = headphoneMode !== '0';
  const [voiceURI, setVoiceURI] = useState(() => lsGet('pt.voice', ''));
  const [engine, setEngine] = useState(() => lsGet('pt.engine', 'browser'));
  const [openaiVoice, setOpenaiVoice] = useState(() => lsGet('pt.openaiVoice', 'onyx'));

  /* ---- document + library ---- */
  const [text, setText] = useState(() => lsGet('pt.text', '') || SAMPLE);
  const [docName, setDocName] = useState(() => lsGet('pt.docName', '') || null);
  const [docs, setDocs] = useState([]);
  const [libOpen, setLibOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [optsOpen, setOptsOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');

  /* ---- playback ---- */
  const [pageIdx, setPageIdx] = useState(0);
  const [unitIdx, setUnitIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [leaving, setLeaving] = useState(null);
  const [voices, setVoices] = useState([]);

  /* ---- layout: column size, columns per spread, and the measured spreads ---- */
  const [box, setBox] = useState(null);
  const [fontsTick, setFontsTick] = useState(0);
  const [pages, setPages] = useState(() => groupSpreads([], 1));

  const stageRef = useRef(null);
  const measureRef = useRef(null);
  const pendingRef = useRef(null); // where to land after the next re-measure
  const genRef = useRef(0);
  const timerRef = useRef(null);
  const actxRef = useRef(null);
  const audioRef = useRef(null);
  const speakAtRef = useRef(null);
  const toastTimer = useRef(null);
  const posTimer = useRef(null);
  const restoredRef = useRef(false);

  const items = useMemo(() => parseDoc(text), [text]);

  // Refs mirror state so speech callbacks never read a stale closure.
  const pagesRef = useRef(pages); pagesRef.current = pages;
  const pageRef = useRef(0);
  const unitRef = useRef(-1);
  const playingRef = useRef(false);
  const rateRef = useRef(rate); rateRef.current = rate;
  const voiceRef = useRef(voiceURI); voiceRef.current = voiceURI;
  const voicesRef = useRef(voices); voicesRef.current = voices;
  const dingRef = useRef(ding); dingRef.current = ding;
  const engineRef = useRef(engine); engineRef.current = engine;
  const openaiVoiceRef = useRef(openaiVoice); openaiVoiceRef.current = openaiVoice;
  const docNameRef = useRef(docName); docNameRef.current = docName;

  const unitsAt = (p) => unitsOf(pagesRef.current[p]);

  const flash = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  };

  /* ---------------------------- persistence ---------------------------- */

  const savePosition = (page, unit) => {
    const name = docNameRef.current;
    if (!name) {
      const s0 = pagesRef.current[page];
      lsSet('pt.scratchPos', JSON.stringify({ page, unit, g: (s0 ? s0.start : 0) + Math.max(unit, 0) }));
      return;
    }
    const map = lsJSON('pt.pos', {});
    const sp = pagesRef.current[page];
    // `g` (sentence from the top) survives a different screen size; `page` does not.
    map[name] = { page, unit, g: (sp ? sp.start : 0) + Math.max(unit, 0), at: Date.now() };
    lsSet('pt.pos', JSON.stringify(map));
    if (IS_LOCAL) return;
    clearTimeout(posTimer.current);
    posTimer.current = setTimeout(() => { syncPositions().catch(() => {}); }, 5000);
  };

  // Merge this device's positions with whatever another device last wrote.
  const syncPositions = async () => {
    const mine = lsJSON('pt.pos', {});
    let theirs = {};
    try {
      const r = await fetch('/api/files?filename=' + encodeURIComponent(POS_FILE));
      if (r.ok) theirs = JSON.parse((await r.json()).content || '{}') || {};
    } catch { /* first run, or offline */ }
    const merged = { ...theirs };
    for (const [k, v] of Object.entries(mine)) {
      if (!merged[k] || (v.at || 0) > (merged[k].at || 0)) merged[k] = v;
    }
    lsSet('pt.pos', JSON.stringify(merged));
    await fetch('/api/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: POS_FILE, content: JSON.stringify(merged), accessCode: ACCESS_CODE }),
    });
    return merged;
  };

  const positionFor = (name) => {
    if (!name) return lsJSON('pt.scratchPos', { page: 0, unit: 0 });
    return lsJSON('pt.pos', {})[name] || { page: 0, unit: 0 };
  };

  const refreshLibrary = async () => {
    try {
      const list = await store.list();
      list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      setDocs(list);
      return list;
    } catch (e) {
      console.error('Library error:', e);
      flash('Could not reach the library');
      return [];
    }
  };

  /* ------------------------------- audio ------------------------------- */

  const ensureAudio = () => {
    try {
      if (!actxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) actxRef.current = new Ctx();
      }
      if (actxRef.current && actxRef.current.state === 'suspended') actxRef.current.resume();
    } catch { actxRef.current = null; }
  };

  // Two-tone page-turn chime. Returns how long to wait before turning.
  const chime = () => {
    const ctx = actxRef.current;
    if (!dingRef.current || !ctx) return 320;
    const t = ctx.currentTime;
    [[880, 0], [1318.5, 0.16]].forEach(([freq, at]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.22, t + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.9);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + at);
      osc.stop(t + at + 1);
    });
    return 1100;
  };

  const stopSound = () => {
    try { window.speechSynthesis.cancel(); } catch { /* unsupported */ }
    if (audioRef.current) { try { audioRef.current.pause(); } catch { /* ignore */ } audioRef.current = null; }
    clearTimeout(timerRef.current);
  };

  const pickVoice = () => voicesRef.current.find((v) => v.voiceURI === voiceRef.current) || null;

  const pause = () => {
    playingRef.current = false;
    setPlaying(false);
    genRef.current++;
    stopSound();
  };

  const speakOpenAI = (sentence, gen, onDone) => {
    const key = (lsGet('OPENAI_API_KEY', '') || '').trim();
    if (!key) { flash('Add an OpenAI key, or switch the engine back to Browser'); pause(); return; }
    (async () => {
      try {
        const resp = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ model: 'tts-1', input: sentence, voice: openaiVoiceRef.current, speed: rateRef.current }),
        });
        if (!resp.ok) throw new Error('OpenAI ' + resp.status);
        if (gen !== genRef.current || !playingRef.current) return;
        const url = URL.createObjectURL(await resp.blob());
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; onDone(); };
        audio.onerror = () => { URL.revokeObjectURL(url); audioRef.current = null; onDone(); };
        audio.play();
      } catch (e) {
        console.error('OpenAI TTS:', e);
        if (gen === genRef.current) {
          flash('OpenAI speech failed — switching to the browser voice');
          setEngine('browser');
          engineRef.current = 'browser';
          onDone();
        }
      }
    })();
  };

  const finishPage = (gen) => {
    if (gen !== genRef.current || !playingRef.current) return;
    unitRef.current = -1;
    setUnitIdx(-1);
    const wait = chime();
    timerRef.current = setTimeout(() => {
      if (gen !== genRef.current || !playingRef.current) return;
      if (pageRef.current < pagesRef.current.length - 1) {
        turnTo(pageRef.current + 1, false, () => { if (playingRef.current) speakAtRef.current(0); });
      } else {
        playingRef.current = false;
        setPlaying(false);
        unitRef.current = -1;
        setUnitIdx(-1);
        flash('End of the article');
      }
    }, wait);
  };

  const speakAt = (i) => {
    const gen = ++genRef.current;
    stopSound();
    const list = unitsAt(pageRef.current);
    if (i >= list.length) { finishPage(gen); return; }
    const safe = Math.max(0, i);
    unitRef.current = safe;
    setUnitIdx(safe);
    savePosition(pageRef.current, safe);

    const next = () => {
      if (gen !== genRef.current || !playingRef.current) return;
      speakAtRef.current(safe + 1);
    };

    if (engineRef.current === 'openai') { speakOpenAI(list[safe].text, gen, next); return; }

    const synth = window.speechSynthesis;
    if (!synth) { flash('This browser has no speech synthesis'); pause(); return; }
    const u = new SpeechSynthesisUtterance(list[safe].text);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = rateRef.current;
    u.onend = next;
    u.onerror = (e) => {
      if (e && (e.error === 'canceled' || e.error === 'interrupted')) return;
      next();
    };
    // A beat of delay keeps Chrome from dropping an utterance queued right after cancel().
    setTimeout(() => { if (gen === genRef.current && playingRef.current) synth.speak(u); }, 30);
  };
  speakAtRef.current = speakAt;

  const turnTo = (n, back, done) => {
    if (n < 0 || n >= pagesRef.current.length) return;
    const apply = () => {
      pageRef.current = n;
      setPageIdx(n);
      unitRef.current = -1;
      setUnitIdx(-1);
      setLeaving(null);
      savePosition(n, 0);
      if (done) done();
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(); return; }
    setLeaving(back ? 'back' : 'fwd');
    setTimeout(apply, 230);
  };

  const play = () => {
    ensureAudio();
    playingRef.current = true;
    setPlaying(true);
    speakAt(unitRef.current < 0 ? 0 : unitRef.current);
  };

  const toggle = () => (playingRef.current ? pause() : play());

  const goPage = (n) => {
    if (n < 0 || n >= pagesRef.current.length) return;
    const wasPlaying = playingRef.current;
    genRef.current++;
    stopSound();
    turnTo(n, n < pageRef.current, () => { if (wasPlaying) speakAtRef.current(0); });
  };

  const goUnit = (delta) => {
    const list = unitsAt(pageRef.current);
    const next = (unitRef.current < 0 ? 0 : unitRef.current) + delta;
    if (next < 0) { if (pageRef.current > 0) goPage(pageRef.current - 1); return; }
    if (next >= list.length) { goPage(pageRef.current + 1); return; }
    ensureAudio();
    playingRef.current = true;
    setPlaying(true);
    speakAt(next);
  };

  /* ---------------------------- loading text ---------------------------- */

  const openText = (newText, name, startAt) => {
    pause();
    setText(newText);
    setDocName(name || null);
    docNameRef.current = name || null;
    lsSet('pt.text', newText);
    lsSet('pt.docName', name || '');
    unitRef.current = -1;
    setUnitIdx(-1);
    // The new text is measured in a layout effect; land there once it is.
    pendingRef.current = startAt || positionFor(name || null);
    if (newText === text) remeasure();
  };

  // Put the reader at a saved position on the current spreads.
  const jumpTo = (pos) => {
    const list = pagesRef.current;
    let p;
    let unit = -1;
    if (pos && pos.g != null) {
      p = spreadFor(list, pos.g);
      unit = pos.g > 0 ? pos.g - list[p].start : -1;
    } else {
      p = Math.min(Math.max((pos && pos.page) || 0, 0), list.length - 1);
    }
    pageRef.current = p;
    setPageIdx(p);
    unitRef.current = unit;
    setUnitIdx(unit);
  };

  const [measureTick, setMeasureTick] = useState(0);
  const remeasure = () => setMeasureTick((t) => t + 1);

  const openDoc = async (doc) => {
    setBusy('Opening…');
    try {
      const content = await store.get(doc.name);
      openText(content, doc.name);
      setLibOpen(false);
    } catch (e) {
      console.error(e);
      flash('Could not open that article');
    } finally {
      setBusy('');
    }
  };

  const uniqueName = (base, existing) => {
    const taken = new Set(existing.map((d) => d.name));
    let name = base + '.txt';
    let n = 2;
    while (taken.has(name)) { name = base + '-' + n + '.txt'; n += 1; }
    return name;
  };

  // Save text to the library. With no argument it re-saves the open article.
  const saveDoc = async (content, { open = true } = {}) => {
    const body = content != null ? content : text;
    if (!body.trim()) return null;
    setBusy('Saving…');
    try {
      const list = docs.length ? docs : await refreshLibrary();
      const name = (content == null && docNameRef.current) || uniqueName(slugify(titleOf(body)), list);
      await store.put(name, body);
      await refreshLibrary();
      if (open) { setDocName(name); docNameRef.current = name; lsSet('pt.docName', name); }
      flash(IS_LOCAL ? 'Saved on this device' : 'Saved to the library');
      return name;
    } catch (e) {
      console.error(e);
      flash('Save failed: ' + e.message);
      return null;
    } finally {
      setBusy('');
    }
  };

  // Hand a text to the browser as a .txt download.
  const saveFile = (name, content) => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = /\.txt$/i.test(name) ? name : name + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Download the open article, or a library article fetched fresh from storage.
  const downloadDoc = async (doc, e) => {
    if (e) e.stopPropagation();
    if (!doc) { saveFile(docNameRef.current || slugify(titleOf(text)), text); return; }
    setBusy('Downloading…');
    try {
      saveFile(doc.name, await store.get(doc.name));
    } catch (err) {
      console.error(err);
      flash('Download failed');
    } finally {
      setBusy('');
    }
  };

  const deleteDoc = async (doc, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete "' + doc.title + '" from the library?')) return;
    setBusy('Deleting…');
    try {
      await store.del(doc.name);
      await refreshLibrary();
      if (docNameRef.current === doc.name) { setDocName(null); docNameRef.current = null; lsSet('pt.docName', ''); }
      flash('Deleted');
    } catch (err) {
      console.error(err);
      flash('Delete failed');
    } finally {
      setBusy('');
    }
  };

  const fromClipboard = async ({ append = false, save = false } = {}) => {
    try {
      const raw = await navigator.clipboard.readText();
      if (!raw || !raw.trim()) { flash('Clipboard is empty'); return; }
      const next = append && text.trim() ? text.trimEnd() + '\n\n' + raw.trim() : raw.trim();
      openText(next, append ? docNameRef.current : null, append ? undefined : { page: 0, unit: 0 });
      setPasteOpen(false);
      if (save) await saveDoc(next, { open: true });
    } catch (e) {
      console.error(e);
      flash('Clipboard blocked — paste into the box instead');
      setPasteOpen(true);
    }
  };

  const loadDraft = async ({ save = false } = {}) => {
    const body = draft.trim();
    if (!body) return;
    openText(body, null, { page: 0, unit: 0 });
    setPasteOpen(false);
    setDraft('');
    if (save) await saveDoc(body, { open: true });
  };

  /* ------------------------------- effects ------------------------------- */

  // Voice list (arrives asynchronously in Chrome).
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return undefined;
    const load = () => {
      const list = synth.getVoices() || [];
      if (!list.length) return;
      list.sort((a, b) => (/^en/i.test(a.lang) ? 0 : 1) - (/^en/i.test(b.lang) ? 0 : 1) || a.name.localeCompare(b.name));
      setVoices(list);
      voicesRef.current = list;
      if (!voiceRef.current || !list.some((v) => v.voiceURI === voiceRef.current)) {
        const best =
          list.find((v) => /^en/i.test(v.lang) && /(Enhanced|Premium)/i.test(v.name)) ||
          list.find((v) => /^en/i.test(v.lang) && /Google/i.test(v.name)) ||
          list.find((v) => /^en/i.test(v.lang)) ||
          list[0];
        if (best) { setVoiceURI(best.voiceURI); voiceRef.current = best.voiceURI; }
      }
    };
    load();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', load);
    return () => { if (synth.removeEventListener) synth.removeEventListener('voiceschanged', load); };
  }, []);

  /* ---- headphone controls ----
     A near-silent track keeps the reader's media session active while speech
     synthesis is reading or paused. */
  const hpActions = useRef({});
  hpActions.current = {
    playpause: () => {
      toggle();
      flash(playingRef.current ? 'Headphones: reading' : 'Headphones: paused');
    },
    // The page turn is its own feedback; a toast appears only when nothing can happen.
    next: () => {
      if (pageRef.current >= pagesRef.current.length - 1) { flash('Headphones: already on the last page'); return; }
      goPage(pageRef.current + 1);
    },
    prev: () => {
      if (pageRef.current <= 0) { flash('Headphones: already on the first page'); return; }
      goPage(pageRef.current - 1);
    },
  };

  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!headphonesEnabled || !ms) return undefined;
    const audio = new Audio(silentTrackURL());
    audio.loop = true;
    const start = () => { audio.play().catch(() => { /* waits for the next click or key */ }); };
    // Something else (another tab, the OS) may stop our track; start it again on the next interaction.
    const kick = () => { if (audio.paused) start(); };
    start();
    document.addEventListener('pointerdown', kick, true);
    document.addEventListener('keydown', kick, true);

    return () => {
      document.removeEventListener('pointerdown', kick, true);
      document.removeEventListener('keydown', kick, true);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      try { ms.metadata = null; ms.playbackState = 'none'; } catch { /* ignore */ }
    };
  }, [headphonesEnabled]);

  useEffect(() => {
    const ms = navigator.mediaSession;
    if (headphoneMode === '0' || !ms) return undefined;
    const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* unsupported action */ } };
    const scroll = headphoneMode === 'scroll';
    const press = scroll ? () => hpActions.current.next() : () => hpActions.current.playpause();
    set('play', press);
    set('pause', press);
    if (scroll) {
      set('nexttrack', () => hpActions.current.next());
      set('previoustrack', () => hpActions.current.prev());
    }

    return () => {
      set('play', null);
      set('pause', null);
      if (scroll) {
        set('nexttrack', null);
        set('previoustrack', null);
      }
    };
  }, [headphoneMode]);

  // Tell the system what is "playing", so Now Playing shows the article and a
  // system controls reflect whether the reader is speaking.
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!headphonesEnabled || !ms) return;
    try {
      if (window.MediaMetadata) ms.metadata = new window.MediaMetadata({ title: docTitle, artist: 'Page Turner' });
      ms.playbackState = playing ? 'playing' : 'paused';
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headphonesEnabled, playing, text, docName, docs]);

  // Chrome stops long speech runs unless it is nudged.
  useEffect(() => {
    if (!playing || engine !== 'browser') return undefined;
    if (!/Chrome/.test(navigator.userAgent) || /Edg|OPR/.test(navigator.userAgent)) return undefined;
    const id = setInterval(() => {
      const s = window.speechSynthesis;
      if (s && s.speaking && !s.paused) { s.pause(); s.resume(); }
    }, 10000);
    return () => clearInterval(id);
  }, [playing, engine]);

  // Library on first paint, then restore the last article and its position.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await refreshLibrary();
      if (cancelled || restoredRef.current) return;
      restoredRef.current = true;
      if (!IS_LOCAL) { try { await syncPositions(); } catch { /* offline */ } }
      const name = lsGet('pt.docName', '') || null;
      const doc = name && list.find((d) => d.name === name);
      if (doc) {
        try {
          const content = await store.get(doc.name);
          if (!cancelled) openText(content, doc.name);
          return;
        } catch { /* fall through to the cached copy */ }
      }
      jumpTo(positionFor(name));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Size the page to the space between the bars: two facing pages when there is
  // room for both at a comfortable line length, otherwise one.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const read = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = Math.floor(el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
      const per = w >= 940 && h >= 360 ? 2 : 1;
      const gap = per === 2 ? 26 : 0;
      const colW = Math.floor(Math.min(per === 2 ? 640 : 680, (w - gap) / per));
      setBox((b) => (b && b.w === colW && b.h === h && b.per === per ? b : { w: colW, h, per, gap }));
    };
    read();
    let t;
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(read, 120); });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, []);

  // Web fonts change line breaks, so measure again once they arrive.
  useEffect(() => {
    const f = document.fonts;
    if (!f) return undefined;
    const bump = () => setFontsTick((t) => t + 1);
    f.ready.then(bump);
    f.addEventListener('loadingdone', bump);
    return () => f.removeEventListener('loadingdone', bump);
  }, []);

  // Cut the text into screen-sized pages. Whatever sentence the reader was on
  // stays the one in view, so a resize or a new text size never loses the place.
  useLayoutEffect(() => {
    if (!box || !measureRef.current) return;
    const body = measureRef.current.querySelector('.sheet-body');
    const old = pagesRef.current[pageRef.current];
    const anchor = old ? old.start + Math.max(unitRef.current, 0) : 0;
    const hadUnit = unitRef.current >= 0;
    const next = groupSpreads(measureColumns(items, body), box.per);
    pagesRef.current = next;
    setPages(next);

    const pend = pendingRef.current;
    pendingRef.current = null;
    if (pend) { jumpTo(pend); return; }
    const p = spreadFor(next, anchor);
    pageRef.current = p;
    setPageIdx(p);
    const unit = hadUnit ? anchor - next[p].start : -1;
    unitRef.current = unit;
    setUnitIdx(unit);
    // Mid-sentence when the layout changed: start that sentence again in its new place.
    if (playingRef.current && unit >= 0) speakAt(unit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, box, size, fontsTick, measureTick]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input' || tag === 'select') return;
      if (e.key === 'Escape') { setLibOpen(false); setPasteOpen(false); return; }
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goPage(pageRef.current + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPage(pageRef.current - 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); goUnit(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); goUnit(-1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onLeave = () => { stopSound(); if (!IS_LOCAL) syncPositions().catch(() => {}); };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { lsSet('pt.dark', dark ? '1' : '0'); }, [dark]);
  useEffect(() => { lsSet('pt.rate', String(rate)); }, [rate]);
  useEffect(() => { lsSet('pt.size', String(size)); }, [size]);
  useEffect(() => { lsSet('pt.ding', ding ? '1' : '0'); }, [ding]);
  useEffect(() => { lsSet('pt.headphones', headphoneMode); }, [headphoneMode]);
  useEffect(() => { lsSet('pt.voice', voiceURI || ''); }, [voiceURI]);
  useEffect(() => { lsSet('pt.engine', engine); }, [engine]);
  useEffect(() => { lsSet('pt.openaiVoice', openaiVoice); }, [openaiVoice]);

  /* ------------------------------ rendering ------------------------------ */

  const spread = pages[Math.min(pageIdx, pages.length - 1)] || pages[0];
  const progress = pages.length ? ((pageIdx + 1) / pages.length) * 100 : 0;
  const docTitle = (docName && (docs.find((d) => d.name === docName) || {}).title) || titleOf(text);
  const totalCols = pages.reduce((sum, sp) => sum + sp.cols.length, 0);
  const shownCols = spread.cols.length;
  const pageLabel = shownCols > 1
    ? 'Pages ' + (spread.first + 1) + '–' + (spread.first + shownCols) + ' of ' + totalCols
    : 'Page ' + (spread.first + 1) + ' of ' + totalCols;
  // Characters per spread on this screen, to estimate other articles' lengths.
  const perSpread = Math.max(400, text.length / Math.max(1, pages.length));

  // Sentence numbers run on across both pages of a spread.
  let n = 0;
  const renderPage = (list) => {
    const out = [];
    let listBuf = [];
    const flushList = (key) => {
      if (!listBuf.length) return;
      out.push(<ul className="list" key={'ul' + key}>{listBuf}</ul>);
      listBuf = [];
    };

    const sentence = (s, i, k, last) => {
      const idx = n++;
      return (
        <span
          key={i + '-' + k}
          className={'s' + (idx === unitIdx ? ' on' : '')}
          data-unit={idx}
          role="button"
          tabIndex={0}
          // Tapping sentences is the main gesture here, so a quick second or third
          // tap must not select the word or the paragraph. Drag-select still works.
          onMouseDown={(e) => { if (e.detail > 1) e.preventDefault(); }}
          onClick={() => { ensureAudio(); playingRef.current = true; setPlaying(true); speakAt(idx); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.click(); } }}
        >
          {last ? s : s + ' '}
        </span>
      );
    };
    const sentencesOf = (it, i) => it.sents.map((s, k) => sentence(s, i, k, k === it.sents.length - 1));

    list.forEach((it, i) => {
      if (it.type !== 'li') flushList(i);
      if (it.type === 'title') {
        out.push(<p className="kicker" key={'k' + i}>Now reading</p>);
        out.push(<h1 className="title" key={i}>{sentencesOf(it, i)}</h1>);
      } else if (it.type === 'source') {
        out.push(<p className="source" key={i}>{it.text}</p>);
      } else if (it.type === 'label') {
        out.push(<p className="label" key={i}>{it.text}</p>);
      } else if (it.type === 'rule') {
        out.push(<hr className="rule" key={i} />);
      } else if (it.type === 'head') {
        out.push(React.createElement(it.level <= 1 ? 'h2' : 'h3', { className: 'head', key: i }, sentencesOf(it, i)));
      } else if (it.type === 'quote') {
        out.push(<blockquote className="quote" key={i}>{sentencesOf(it, i)}</blockquote>);
      } else if (it.type === 'li') {
        listBuf.push(<li className="item" key={i}>{sentencesOf(it, i)}</li>);
      } else {
        out.push(<p className={'body' + (it.cont ? ' cont' : '')} key={i}>{sentencesOf(it, i)}</p>);
      }
    });
    flushList('end');
    return out;
  };

  return (
    <div className={'reader' + (dark ? ' theme-dark' : '')} style={{ '--reader-size': size + 'px' }}>
      {/* ---------- top bar ---------- */}
      <header className="top">
        <button className="btn" onClick={() => { setLibOpen(true); refreshLibrary(); }}>Library</button>
        <div className="doctitle">
          {docTitle}
          {!docName && <em>unsaved</em>}
        </div>
        <button className="btn" onClick={() => { setDraft(pasteOpen ? '' : text); setPasteOpen((v) => !v); }}>
          {pasteOpen ? 'Close' : 'Paste'}
        </button>
        <button className="btn ghost" onClick={() => setDark((v) => !v)} aria-label="Toggle theme">
          {dark ? '☀' : '☾'}
        </button>
      </header>

      {/* ---------- paste panel ---------- */}
      {pasteOpen && (
        <section className="paste">
          <label htmlFor="draft">
            Line 1 is the title, an optional URL line can follow, blank lines separate paragraphs.
            Markdown headings, lists and quotes from the Page Scraper extension are understood.
          </label>
          <textarea id="draft" value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} placeholder="Paste a scraped article here…" />
          <div className="row">
            <button className="btn accent" onClick={() => loadDraft({ save: true })} disabled={!draft.trim()}>Read &amp; save</button>
            <button className="btn" onClick={() => loadDraft()} disabled={!draft.trim()}>Read only</button>
            <button className="btn" onClick={() => fromClipboard({ save: true })}>From clipboard</button>
            <button className="btn" onClick={() => fromClipboard({ append: true })}>Append clipboard</button>
            <span className="hint">{IS_LOCAL ? 'Local dev: the library lives in this browser.' : 'Saved articles sync through Vercel Blob.'}</span>
          </div>
        </section>
      )}

      {/* ---------- library ---------- */}
      {libOpen && (
        <>
          <div className="scrim" onClick={() => setLibOpen(false)} />
          <aside className="drawer">
            <header>
              <h2>Library</h2>
              <button className="btn ghost" onClick={() => setLibOpen(false)}>Close</button>
            </header>
            <div className="actions">
              <button className="btn accent" onClick={() => fromClipboard({ save: true })}>Add from clipboard</button>
              <button className="btn" onClick={() => saveDoc()} disabled={!text.trim()}>Save current</button>
              <button className="btn" onClick={() => downloadDoc()} disabled={!text.trim()}>Download current</button>
              <button className="btn sm" onClick={refreshLibrary}>Refresh</button>
            </div>
            <div className="list">
              {!docs.length && (
                <p className="empty">
                  Nothing saved yet. Scrape an article with Alt+Shift+S, then press <strong>Add from clipboard</strong>.
                  {IS_LOCAL && <><br /><br />On localhost the library is stored in this browser, not in Vercel Blob.</>}
                </p>
              )}
              {docs.map((d) => {
                const pos = positionFor(d.name);
                const est = d.name === docName ? pages.length : Math.max(1, Math.ceil((d.chars || 0) / perSpread));
                const pct = Math.min(100, Math.round(((pos.page || 0) + 1) / est * 100));
                const chars = d.chars || 0;
                const charLabel = chars >= 1000 ? (chars / 1000).toFixed(1) + 'k chars' : chars + ' chars';
                return (
                  <div
                    className={'doc' + (d.name === docName ? ' active' : '')}
                    key={d.name}
                    role="button"
                    tabIndex={0}
                    onClick={() => openDoc(d)}
                    onKeyDown={(e) => { if (e.key === 'Enter') openDoc(d); }}
                  >
                    <div className="meta">
                      <div className="name">{d.title}</div>
                      <div className="sub">
                        {charLabel} · {d.name === docName ? '' : 'about '}{est} page{est === 1 ? '' : 's'}
                        {d.updatedAt ? ' · ' + new Date(d.updatedAt).toLocaleDateString() : ''}
                        {pos.page ? ' · on page ' + ((pos.page || 0) + 1) : ''}
                      </div>
                      {pos.page > 0 && <div className="bar"><i style={{ width: pct + '%' }} /></div>}
                    </div>
                    <button className="btn sm" onClick={(e) => downloadDoc(d, e)} aria-label={'Download ' + d.title}>Download</button>
                    <button className="btn sm danger" onClick={(e) => deleteDoc(d, e)} aria-label={'Delete ' + d.title}>Delete</button>
                  </div>
                );
              })}
            </div>
          </aside>
        </>
      )}

      {/* ---------- the page ---------- */}
      <main className="stage" ref={stageRef}>
        {box && (
          <div
            className={'spread' + (leaving ? ' leaving' : '') + (leaving === 'back' ? ' back' : '')}
            style={{ gap: box.gap }}
          >
            {Array.from({ length: box.per }, (_, c) => {
              const col = spread.cols[c];
              const dims = { width: box.w, height: box.h };
              // The last spread can have an empty right-hand page; keep it so the left one stays put.
              if (!col) return <div className="sheet blank" style={dims} key={c} aria-hidden="true" />;
              return (
                <article className="sheet" style={dims} key={c}>
                  <div className="sheet-body">
                    {c === 0 && !col.some((it) => it.type === 'title') && <p className="kicker">Continued</p>}
                    {renderPage(col)}
                  </div>
                  <div className="folio">
                    <span>{c === 0 ? (docName ? 'Library' : 'Unsaved') : docTitle}</span>
                    <span>{spread.first + c + 1} / {totalCols}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Hidden sheet at the on-screen page size, used only to measure page breaks. */}
      <article className="sheet measure" ref={measureRef} style={box ? { width: box.w, height: box.h } : undefined} aria-hidden="true">
        <div className="sheet-body" />
        <div className="folio"><span>Library</span><span>1 / 1</span></div>
      </article>

      {/* ---------- transport ---------- */}
      <footer className="bar">
        <div className="progress" aria-hidden="true"><i style={{ width: progress + '%' }} /></div>
        <div className="controls">
          <button className="tbtn" onClick={() => goPage(pageIdx - 1)} disabled={pageIdx === 0} aria-label="Previous page">
            <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zM9.5 12 18 6v12z" /></svg>
          </button>
          <button className="tbtn play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
            {playing
              ? <svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
              : <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>}
          </button>
          <button className="tbtn" onClick={() => goPage(pageIdx + 1)} disabled={pageIdx >= pages.length - 1} aria-label="Next page">
            <svg viewBox="0 0 24 24"><path d="M16 6h2v12h-2zM6 18V6l8.5 6z" /></svg>
          </button>
          <button className="tbtn more" onClick={() => setOptsOpen((v) => !v)} aria-label="Reading settings" aria-expanded={optsOpen}>
            <svg viewBox="0 0 24 24"><path d="M12 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" /></svg>
          </button>
          <div className="counter">{busy || pageLabel}</div>
          <div className={'opts' + (optsOpen ? ' open' : '')}>
            <label>
              Engine
              <select value={engine} onChange={(e) => { setEngine(e.target.value); engineRef.current = e.target.value; }}>
                <option value="browser">Browser</option>
                <option value="openai">OpenAI</option>
              </select>
            </label>
            {engine === 'browser' ? (
              <label>
                Voice
                <select
                  value={voiceURI || ''}
                  onChange={(e) => { setVoiceURI(e.target.value); voiceRef.current = e.target.value; if (playingRef.current) speakAt(unitRef.current); }}
                >
                  {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
                </select>
              </label>
            ) : (
              <>
                <label>
                  Voice
                  <select value={openaiVoice} onChange={(e) => { setOpenaiVoice(e.target.value); openaiVoiceRef.current = e.target.value; }}>
                    {['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
                <label>
                  Key
                  <button
                    className="btn sm"
                    onClick={() => {
                      const k = window.prompt('OpenAI API key (kept in this browser only):', lsGet('OPENAI_API_KEY', '') || '');
                      if (k !== null) { lsSet('OPENAI_API_KEY', k.trim()); flash(k.trim() ? 'Key saved in this browser' : 'Key cleared'); }
                    }}
                  >
                    {lsGet('OPENAI_API_KEY', '') ? 'Change' : 'Add'}
                  </button>
                </label>
              </>
            )}
            <label>
              Speed
              <select
                value={String(rate)}
                onChange={(e) => { const v = parseFloat(e.target.value); setRate(v); rateRef.current = v; if (playingRef.current && engineRef.current === 'browser') speakAt(unitRef.current); }}
              >
                {['0.8', '0.9', '1', '1.15', '1.3', '1.5', '1.8'].map((v) => <option key={v} value={v}>{v}x</option>)}
              </select>
            </label>
            <label>
              Text
              <select value={String(size)} onChange={(e) => setSize(parseInt(e.target.value, 10))}>
                <option value="18">Small</option>
                <option value="21">Normal</option>
                <option value="24">Large</option>
                <option value="28">Larger</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={ding} onChange={(e) => { setDing(e.target.checked); dingRef.current = e.target.checked; }} />
              Ding
            </label>
            <label title="Scroll mode turns to the next page with one press. Play / pause mode controls read-aloud with one press.">
              Headphones
              <select value={headphoneMode} onChange={(e) => setHeadphoneMode(e.target.value)}>
                <option value="0">Off</option>
                <option value="scroll">Scroll</option>
                <option value="playpause">Play / pause</option>
              </select>
            </label>
          </div>
        </div>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};

export default PageTurnerReader;
