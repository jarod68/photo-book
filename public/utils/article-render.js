// @ts-check
// Article bodies: a small, safe Markdown — no HTML passes through (everything
// is escaped), links only to web pages, mail addresses or this site.
//
//   # / ## Heading, ### Sub-heading     > quote        - list / 1. list
//   **bold**  *italic*  `code`  [text](https://…)       --- separator
//   ![caption](<Album/file.jpg>)  a photo of any album; a bare file name is
//   the article's own album. Photos on their own lines make a figure (one)
//   or a gallery (several, one after the other).
//
// Photos are looked up in `photos` ("Album/file" → { previewUrl, mediumUrl,
// thumbUrl, type, name, … }, from the server): those missing — deleted, or in
// an album the reader may not see — are left out (shown as such in the editor).

const REF = String.raw`!\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^)\s]+))\)`;
const REF_G = new RegExp(REF, 'g');
const PHOTO_LINE = new RegExp(String.raw`^\s*(?:${REF}\s*)+$`);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** "Album/file.jpg" → { album, file }; a bare name → `album`. */
export function parseRef(ref, album) {
  const i = ref.lastIndexOf('/');
  return i < 0 ? { album, file: ref } : { album: ref.slice(0, i), file: ref.slice(i + 1) };
}

/** The reference to write for a photo: <file> in its own album, else <Album/file>. */
export function refFor(album, file, articleAlbum) {
  return album === articleAlbum ? `<${file}>` : `<${album}/${file}>`;
}

/** Every photo reference of a body: [{ album, file, caption }]. */
export function photoRefs(body, album) {
  return [...String(body ?? '').matchAll(REF_G)].map((m) => ({ ...parseRef(m[2] ?? m[3], album), caption: m[1] }));
}

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#|[\w.-]+\.html(?:[?#]|$))/i;

/** Inline marks of one line of text (escaped first). */
export function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\uE000${codes.push(c) - 1}\uE000`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, url) => {
    const raw = url.replace(/&amp;/g, '&');
    if (!SAFE_URL.test(raw)) return label;
    const ext = /^https?:/i.test(raw) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${url}"${ext}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\uE000(\d+)\uE000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

/**
 * @param {string} body
 * @param {{ album: string, photos: Record<string, any> | Map<string, any>, share?: string | null, showMissing?: boolean }} opts
 * @returns {string} HTML
 */
export function renderArticle(body, { album, photos, share = null, showMissing = false }) {
  const get = (k) => (photos instanceof Map ? photos.get(k) : photos?.[k]);
  const withShare = (url) => (share && url ? `${url}${url.includes('?') ? '&' : '?'}share=${encodeURIComponent(share)}` : url);
  const out = [];
  let para = [], list = null, quote = [], shots = [];

  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; };
  const flushQuote = () => { if (quote.length) out.push(`<blockquote><p>${quote.map(inline).join('<br>')}</p></blockquote>`); quote = []; };
  const flushShots = () => {
    const figs = shots.map((r) => figure(r, shots.length > 1)).filter(Boolean);
    if (figs.length === 1) out.push(figs[0]);
    else if (figs.length > 1) out.push(`<div class="art-gallery art-gallery--${Math.min(figs.length, 4)}">${figs.join('')}</div>`);
    shots = [];
  };
  const flush = () => { flushPara(); flushList(); flushQuote(); flushShots(); };

  function figure({ album: a, file, caption }, small) {
    const p = get(`${a}/${file}`);
    if (!p) return showMissing ? `<div class="art-missing">${esc(`${a}/${file}`)}</div>` : '';
    const href = withShare(`viewer.html?album=${encodeURIComponent(a)}&photo=${encodeURIComponent(file)}`);
    const cap = caption ? `<figcaption>${inline(caption)}</figcaption>` : '';
    if (p.type === 'video') {
      return `<figure class="art-photo art-photo--video"><video controls preload="metadata" playsinline src="${esc(withShare(p.url))}"`
        + `${p.previewUrl ? ` poster="${esc(withShare(p.previewUrl))}"` : ''}></video>${cap}</figure>`;
    }
    const src = small ? (p.previewUrl || p.mediumUrl || p.thumbUrl) : (p.mediumUrl || p.previewUrl || p.thumbUrl);
    const size = p.width && p.height ? ` width="${p.width}" height="${p.height}"` : '';
    return `<figure class="art-photo${p.is360 ? ' art-photo--360' : ''}"><a class="art-photo-link" href="${esc(href)}">`
      + `<img src="${esc(withShare(src))}" alt="${esc(caption || p.name || '')}" loading="lazy" decoding="async"${size}>`
      + `${p.is360 ? '<span class="art-badge">360°</span>' : ''}</a>${cap}</figure>`;
  }

  for (const line of String(body ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (PHOTO_LINE.test(line)) {
      flushPara(); flushList(); flushQuote();
      for (const m of line.matchAll(REF_G)) shots.push({ ...parseRef(m[2] ?? m[3], album), caption: m[1] });
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    flushShots();
    // photos in the middle of a sentence: shown after the text
    const inText = [];
    const text = line.replace(REF_G, (_, caption, a, b) => { inText.push({ ...parseRef(a ?? b, album), caption }); return ''; }).replace(/ {2,}/g, ' ');
    let m;
    if ((m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(text))) {
      flush();
      const tag = m[1].length <= 2 ? 'h2' : 'h3';
      out.push(`<${tag}>${inline(m[2].replace(/\s+#+\s*$/, ''))}</${tag}>`);
    } else if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(text)) {
      flush();
      out.push('<hr>');
    } else if ((m = /^\s{0,3}>\s?(.*)$/.exec(text))) {
      flushPara(); flushList();
      quote.push(m[1]);
    } else if ((m = /^\s{0,3}([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(text))) {
      flushPara(); flushQuote();
      const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(m[2]);
    } else {
      flushList(); flushQuote();
      para.push(text.trim());
    }
    if (inText.length) { flushPara(); flushList(); flushQuote(); shots.push(...inText); }
  }
  flush();
  return out.join('\n');
}
