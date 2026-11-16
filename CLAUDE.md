# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm start` - Start development server on localhost:3000
- `npm run build` - Build production bundle
- `npm test` - Run tests with Jest
- `npm run eject` - Eject from Create React App (irreversible)

## Architecture Overview

`src/App.js` is **Page Turner**, a Kindle-Paperwhite-style read-aloud reader, styled by `src/reader.css`.

Text is parsed into items (title, source URL, headings, paragraphs, list items, quotes, and
unspoken labels such as `[0:01:23]` timestamps and `Author:` lines), split into sentences, then
paginated **at sentence boundaries** so the voice never stops mid-thought. Pages are cut by
*measuring*, not by character count: `measureColumns` fills a hidden `.sheet.measure` of the exact
on-screen page size until the next sentence would overflow, so the page never scrolls. Wide screens
(≥940px of stage) show two facing pages as one spread; phones show one. Re-measuring (resize, text
size, fonts loading) keeps the current sentence in view, and saved positions use `g`, the sentence
number from the top, so they survive a different screen. Playback speaks one sentence at a time and
highlights it; at the end of a spread a two-tone WebAudio chime sounds, the pages turn on their own,
and reading continues.

- Tap a sentence to read from there. Space pauses/resumes, ←/→ turn pages, ↑/↓ step a sentence.
- Two engines: the browser's `speechSynthesis` (default, prefers an Enhanced/Premium English
  voice) and OpenAI `tts-1` with a key kept in `localStorage` only.
- Chrome drops long speech runs, so a watchdog pulses `pause()/resume()` every 10s while playing.

### Library and persistence

Articles live in Vercel Blob under `tts-docs/` through `api/files.js`, so a queue built on one
device opens on another. On `localhost` the same interface is backed by `localStorage`, because
`react-scripts start` does not serve `/api`.

- `GET /api/files?meta=1` — light listing (name, size, date, title read from the first 400 bytes)
- `GET /api/files?filename=x.txt` — one article
- `GET /api/files` — every file with content (kept for older clients)
- `POST` / `DELETE` — save and remove, access code `123` (or `localhost` in dev)

Reading position per article is stored in `localStorage` and merged into a shared
`reading-positions.json` blob (debounced, newest-wins per article) so position follows the device.

### Where text comes from

The `page-scraper` Chrome extension (Alt+Shift+S) copies an article as `Title / URL / markdown
blocks` — exactly the shape the parser expects. Paste it in, or use **Add from clipboard**.
`speak_clipboard.app` and the clipboard AppleScripts are separate macOS tools and unaffected.

### Other files

- `src/MediaReader.js` — an older side-by-side text/media viewer, not wired into the app
- `public/*.html` — standalone one-off pages served directly (see `vercel.json` rewrites)

## Component Naming Convention

When creating new components, follow the existing pattern:
- Use `const ComponentName = () => {}` format
- Export as `export default ComponentName`
- This matches the current App.js structure and README instructions

## UI Component System

The project uses a custom implementation of shadcn/ui components with:
- CSS-in-JS styling via className props
- Tailwind CSS utility classes
- Custom color variables defined in tailwind.config.js
- Lucide React icons for UI elements