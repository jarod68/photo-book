// @ts-check
import { t } from '../utils/i18n.js';

/**
 * The upload window, shared by the admin (an album's ⇪ button, or photos
 * dropped on its row) and the viewer (an open album, for the admin or a
 * member who may change it): pick or drop files, upload them with a progress
 * bar, then report what was renamed, left out as identical or refused
 * (nothing is ever overwritten, services/uploads.js). Dropped files start at
 * once; picked ones wait for the Upload button.
 */
const ACCEPT = '.jpg,.jpeg,.png,.webp,.tiff,.tif,.heic,.heif,.avif,.mp4,.m4v,.mov,.webm';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function formatBytes(b) {
  if (b < 1024)          return `${b} B`;
  if (b < 1048576)       return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824)    return `${(b / 1048576).toFixed(1)} MB`;
  if (b < 1099511627776) return `${(b / 1073741824).toFixed(1)} GB`;
  return `${(b / 1099511627776).toFixed(1)} TB`;
}

/** True when a drag carries files (not text or a link from the page). */
export const dragHasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');

/**
 * Files dropped where the page does not take them must not make the browser
 * open them (leaving the page): ignore those drops. Drop targets that do take
 * files handle the event before it gets here.
 */
export function preventFileDrops() {
  for (const type of ['dragover', 'drop']) {
    addEventListener(type, (e) => { if (dragHasFiles(e) && !e.defaultPrevented) e.preventDefault(); });
  }
}

export class Uploader {
  /**
   * @param {{ endpoint: (album: string) => string, onDone?: (album: string, result: any) => void }} opts
   *   endpoint: where the files go (admin or member route); onDone: after an upload
   */
  constructor({ endpoint, onDone = () => {} }) {
    this.endpoint = endpoint;
    this.onDone = onDone;
    this.album = '';
    /** @type {File[]} */
    this.files = [];
    this.build();
  }

  build() {
    const el = document.createElement('div');
    el.id = 'upload-overlay';
    el.className = 'upload-overlay';
    el.hidden = true;
    el.innerHTML = `
      <div class="upload-modal" role="dialog" aria-modal="true">
        <div class="upload-modal-header">
          <h3 class="upload-modal-title">${esc(t('admin.uploadTo'))} <strong id="upload-album-name"></strong></h3>
          <button id="upload-close-btn" class="upload-close-btn" aria-label="${esc(t('viewer.close'))}">✕</button>
        </div>
        <div id="drop-zone" class="drop-zone">
          <svg class="drop-zone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
          </svg>
          <p class="drop-zone-text">${esc(t('admin.dropHere'))}</p>
          <label class="admin-action-btn drop-zone-btn" for="upload-file-input">${esc(t('admin.addFiles'))}</label>
          <input id="upload-file-input" type="file" multiple accept="${ACCEPT}" hidden>
        </div>
        <ul id="upload-file-list" class="upload-file-list"></ul>
        <div id="upload-report" class="upload-report" hidden></div>
        <div id="upload-progress-wrap" class="upload-progress-wrap" hidden>
          <div class="upload-progress-bar"><div id="upload-progress-fill" class="upload-progress-fill"></div></div>
          <span id="upload-progress-text" class="upload-progress-text">0%</span>
        </div>
        <div class="upload-modal-footer">
          <span id="upload-file-count" class="upload-file-count"></span>
          <button id="upload-start-btn" class="admin-action-btn" disabled>${esc(t('admin.upload'))}</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    const $ = (id) => /** @type {any} */ (el.querySelector(`#${id}`));
    this.el = el;
    this.ui = {
      album: $('upload-album-name'), drop: $('drop-zone'), input: $('upload-file-input'), list: $('upload-file-list'),
      report: $('upload-report'), progress: $('upload-progress-wrap'), fill: $('upload-progress-fill'),
      pct: $('upload-progress-text'), count: $('upload-file-count'), start: $('upload-start-btn'),
    };
    const { drop, input, start } = this.ui;
    $('upload-close-btn').addEventListener('click', () => this.close());
    el.addEventListener('click', (e) => { if (e.target === el) this.close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) this.close(); });
    input.addEventListener('change', () => { this.add([...input.files]); input.value = ''; });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drop-zone--active'); });
    drop.addEventListener('dragleave', (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove('drop-zone--active'); });
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('drop-zone--active');
      this.add([...e.dataTransfer.files]);
    });
    start.addEventListener('click', () => this.upload());
  }

  /**
   * Open the window for `album`; with files (dropped on the album), they
   * upload at once.
   * @param {string} album  @param {File[]} [files]
   */
  open(album, files = []) {
    const { album: name, list, count, report, progress, fill, start, drop } = this.ui;
    this.album = album;
    this.files = [];
    name.textContent = album;
    list.innerHTML = '';
    count.textContent = '';
    report.hidden = true;
    progress.hidden = true;
    fill.style.width = '0%';
    start.disabled = true;
    drop.classList.remove('drop-zone--active');
    this.el.hidden = false;
    if (files.length) { this.add(files); this.upload(); }
  }

  close() { this.el.hidden = true; }

  /** @param {File[]} files */
  add(files) {
    const seen = new Set(this.files.map((f) => f.name));
    for (const f of files) if (!seen.has(f.name)) { this.files.push(f); seen.add(f.name); }
    this.renderList();
  }

  renderList() {
    const { list, count, start } = this.ui;
    list.innerHTML = this.files.map((f, i) => `
      <li class="upload-file-item">
        <span class="upload-file-name">${esc(f.name)}</span>
        <span class="upload-file-size">${formatBytes(f.size)}</span>
        <button class="upload-file-remove" data-idx="${i}" aria-label="Remove">✕</button>
      </li>`).join('');
    list.querySelectorAll('.upload-file-remove').forEach((btn) => btn.addEventListener('click', () => {
      this.files.splice(Number(btn.dataset.idx), 1);
      this.renderList();
    }));
    const n = this.files.length;
    count.textContent = n ? t('admin.filesSelected', { n, s: n > 1 ? 's' : '' }) : '';
    start.disabled = n === 0;
  }

  async upload() {
    const { start, progress, fill, pct } = this.ui;
    if (!this.files.length) return;
    start.disabled = true;
    progress.hidden = false;
    fill.style.width = '0%';
    pct.textContent = '0%';
    const form = new FormData();
    for (const f of this.files) form.append('photos', f);
    try {
      const result = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (!e.lengthComputable) return;
          const p = Math.round((e.loaded / e.total) * 100);
          fill.style.width = `${p}%`;
          pct.textContent = `${p}%`;
        };
        xhr.onload = () => {
          let body = {};
          try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new Error(xhr.status === 409 ? t('admin.readOnlyShort') : (/** @type {any} */ (body).error ?? 'Upload failed')));
        };
        xhr.onerror = () => reject(new Error(t('admin.networkError')));
        xhr.open('POST', this.endpoint(this.album));
        xhr.send(form);
      });
      fill.style.width = '100%';
      pct.textContent = '100%';
      this.files = [];
      this.onDone(this.album, result);
      // nothing overwritten (F7): say what was renamed, dropped or refused
      if (!this.report(result)) this.close();
    } catch (err) {
      pct.textContent = `${t('admin.uploadError')} ${err.message}`;
      start.disabled = false;
    }
  }

  /** Returns true when there is something to report (the window then stays open). */
  report({ count = 0, renamed = [], duplicates = [], skipped = [] }) {
    const { report } = this.ui;
    if (!renamed.length && !duplicates.length && !skipped.length) { report.hidden = true; return false; }
    const list = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
    report.innerHTML = `<p>${t('admin.uploadDone', { n: count })}</p>`
      + (renamed.length    ? `<p>${t('admin.uploadRenamed')}</p>${list(renamed.map((r) => `${esc(r.from)} → <strong>${esc(r.to)}</strong>`))}` : '')
      + (duplicates.length ? `<p>${t('admin.uploadDuplicates')}</p>${list(duplicates.map(esc))}` : '')
      + (skipped.length    ? `<p>${t('admin.uploadSkipped')}</p>${list(skipped.map(esc))}` : '');
    report.hidden = false;
    this.renderList();
    return true;
  }
}
