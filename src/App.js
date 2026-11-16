// Page Turner — a Kindle-style read-aloud reader.
//
// The text is split into sentences, paginated at sentence boundaries, and read
// aloud one sentence at a time. At the end of a page a chime sounds, the page
// turns on its own, and reading continues. Tap any sentence to start there.
//
// Articles live in a library backed by Vercel Blob (/api/files), so the queue
// you build with the Page Scraper extension follows you between devices. On
// localhost the same library is kept in localStorage.

import React, { useEffect, useMemo, useRef, useState } from 'react';
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

// Break items into pages at sentence boundaries so the voice never stops mid-thought.
function paginate(items, budget) {
  const pages = [];
  let page = [];
  let used = 0;
  const flushPage = () => { if (page.length) pages.push(page); page = []; used = 0; };

  for (const it of items) {
    if (it.type === 'title') { page.push(it); used += it.text.length * 1.6 + 40; continue; }
    if (it.type === 'source' || it.type === 'label' || it.type === 'rule') {
      page.push(it); used += 30; continue;
    }
    if (it.type === 'head') {
      if (used > budget * 0.6) flushPage();
      page.push(it); used += it.text.length + 70; continue;
    }
    if (it.type === 'li' || it.type === 'quote') {
      if (used >= budget) flushPage();
      page.push(it); used += it.text.length + 20; continue;
    }
    let chunk = { type: 'p', sents: [], cont: false };
    page.push(chunk);
    for (const s of it.sents) {
      chunk.sents.push(s);
      used += s.length + 1;
      if (used >= budget) {
        flushPage();
        chunk = { type: 'p', sents: [], cont: true };
        page.push(chunk);
      }
    }
    if (!chunk.sents.length) page.pop();
  }
  flushPage();

  const out = pages.map((list) => ({ items: list }));
  // Never leave a heading stranded as the last thing on a page.
  for (let k = 0; k < out.length - 1; k++) {
    const last = out[k].items[out[k].items.length - 1];
    if (last && last.type === 'head' && out[k].items.length > 1) {
      out[k].items.pop();
      out[k + 1].items.unshift(last);
    }
  }
  return out.length ? out : [{ items: [{ type: 'p', sents: ['Nothing to read yet. Open the library or paste some text.'] }] }];
}

// The flat list of spoken sentences on a page, in reading order.
function unitsOf(page) {
  const out = [];
  (page ? page.items : []).forEach((it, idx) => {
    if (!SPOKEN[it.type] || !it.sents) return;
    it.sents.forEach((text, k) => out.push({ text, item: idx, sent: k }));
  });
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
  const [budget, setBudget] = useState(() => parseInt(lsGet('pt.budget', '950'), 10) || 950);
  const [size, setSize] = useState(() => parseInt(lsGet('pt.size', '21'), 10) || 21);
  const [ding, setDing] = useState(() => lsGet('pt.ding', '1') !== '0');
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

  const stageRef = useRef(null);
  const sheetRef = useRef(null);
  const genRef = useRef(0);
  const timerRef = useRef(null);
  const actxRef = useRef(null);
  const audioRef = useRef(null);
  const speakAtRef = useRef(null);
  const toastTimer = useRef(null);
  const posTimer = useRef(null);
  const restoredRef = useRef(false);

  const pages = useMemo(() => paginate(parseDoc(text), budget), [text, budget]);

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
    if (!name) { lsSet('pt.scratchPos', JSON.stringify({ page, unit })); return; }
    const map = lsJSON('pt.pos', {});
    map[name] = { page, unit, at: Date.now() };
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
      if (stageRef.current) stageRef.current.scrollTop = 0;
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
    const built = paginate(parseDoc(newText), budget);
    pagesRef.current = built;
    const pos = startAt || positionFor(name || null);
    const p = Math.min(Math.max(pos.page || 0, 0), built.length - 1);
    pageRef.current = p;
    setPageIdx(p);
    unitRef.current = -1;
    setUnitIdx(-1);
    if (stageRef.current) stageRef.current.scrollTop = 0;
  };

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
      const pos = positionFor(name);
      const p = Math.min(Math.max(pos.page || 0, 0), pagesRef.current.length - 1);
      pageRef.current = p;
      setPageIdx(p);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the spoken sentence on screen.
  useEffect(() => {
    if (unitIdx < 0 || !sheetRef.current || !stageRef.current) return;
    const el = sheetRef.current.querySelector('[data-unit="' + unitIdx + '"]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = stageRef.current.getBoundingClientRect();
    if (r.top < s.top + 24 || r.bottom > s.bottom - 24) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [unitIdx]);

  // Re-paginating (page length, new text) must not leave us past the end.
  useEffect(() => {
    if (pageRef.current > pages.length - 1) {
      const p = Math.max(0, pages.length - 1);
      pageRef.current = p;
      setPageIdx(p);
    }
  }, [pages]);

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
  useEffect(() => { lsSet('pt.budget', String(budget)); }, [budget]);
  useEffect(() => { lsSet('pt.size', String(size)); }, [size]);
  useEffect(() => { lsSet('pt.ding', ding ? '1' : '0'); }, [ding]);
  useEffect(() => { lsSet('pt.voice', voiceURI || ''); }, [voiceURI]);
  useEffect(() => { lsSet('pt.engine', engine); }, [engine]);
  useEffect(() => { lsSet('pt.openaiVoice', openaiVoice); }, [openaiVoice]);

  /* ------------------------------ rendering ------------------------------ */

  const page = pages[Math.min(pageIdx, pages.length - 1)] || pages[0];
  const progress = pages.length ? ((pageIdx + 1) / pages.length) * 100 : 0;
  const docTitle = (docName && (docs.find((d) => d.name === docName) || {}).title) || titleOf(text);
  const hasTitleBlock = page.items.some((it) => it.type === 'title');

  const renderPage = () => {
    const out = [];
    let n = 0;
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
          onClick={() => { ensureAudio(); playingRef.current = true; setPlaying(true); speakAt(idx); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.click(); } }}
        >
          {last ? s : s + ' '}
        </span>
      );
    };
    const sentencesOf = (it, i) => it.sents.map((s, k) => sentence(s, i, k, k === it.sents.length - 1));

    page.items.forEach((it, i) => {
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
                const est = d.name === docName ? pages.length : Math.max(1, Math.ceil((d.chars || 0) / budget));
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
        <article className={'sheet' + (leaving ? ' leaving' : '') + (leaving === 'back' ? ' back' : '')} ref={sheetRef}>
          {!hasTitleBlock && <p className="kicker">Continued</p>}
          {renderPage()}
          <div className="folio">
            <span>{docName ? 'Library' : 'Unsaved'}</span>
            <span>{pageIdx + 1} / {pages.length}</span>
          </div>
        </article>
      </main>

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
          <div className="counter">{busy || 'Page ' + (pageIdx + 1) + ' of ' + pages.length}</div>
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
              Page
              <select value={String(budget)} onChange={(e) => setBudget(parseInt(e.target.value, 10))}>
                <option value="550">Short</option>
                <option value="950">Medium</option>
                <option value="1500">Long</option>
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
          </div>
        </div>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};

export default PageTurnerReader;
