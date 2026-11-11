# File Grabber

Chrome extension (Manifest V3). Click the toolbar icon (or Alt+Shift+G) and either drag over a list of file names on the
page, or paste (⌘V / Ctrl+V) / drop a screenshot you already took. The extension reads the names with OCR, finds the matching
links on the page and offers to download them.

## Install
1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.

## Features
- **Select or paste** – drag an area, or paste/drop a screenshot (works even if the list is scrolled out of view).
- **Review panel** – shows each file, what it was read as and the match score; untick anything you don't want.
- **Fallback** – if OCR finds nothing, the file-like links inside your selection are offered instead.
- **Save all as ZIP** – fetches every ticked file and saves one zip (named after the page title) instead of many separate downloads.
- **Auto mode** – tick "Download without asking next time" (saved immediately); it repeats your last action (files or ZIP). Turn it off from the area selector.
- **Several screenshots / pages** – "Add another screenshot" keeps what you already found (also across page loads) and downloads everything together.
- **Iframes** – links in all frames of the page are considered.
- **Greek + English OCR** – list names in either language are matched (accents ignored).
- **Fast** – the OCR engine is preloaded when you open the selector, and extra OCR passes are skipped once every link in the selection was found.

## Notes
- OCR runs locally (Tesseract.js, bundled in `lib/`, Greek + English data); nothing is sent anywhere.
- Matching ignores file extensions and tolerates small OCR errors (≥85% similarity).
- Downloads use your logged-in session.

## Development
`npm install` (only needed to refresh `lib/`), `npm test` runs the matcher tests. `node_modules/` is git-ignored.
