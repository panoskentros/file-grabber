# File Grabber

Chrome extension (Manifest V3). Click the toolbar icon (or Alt+Shift+G), drag over a list of file names on the page,
and it reads them with OCR, finds the matching links on the page and offers to download them.

## Install
1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. On the course page: click the extension icon, drag a box around the file list, review the matches, click **Download selected**.

## Notes
- OCR runs locally (Tesseract.js, bundled in `lib/`); nothing is sent anywhere.
- Matching ignores file extensions and tolerates small OCR errors (≥85% similarity). The review panel shows what each name was read as.
- Only links in the top frame of the page are matched. Downloads use your logged-in session.
- Restore `lib/` after a fresh clone with `npm install` and the copy commands in the git history if needed (`node_modules/` is git-ignored).
