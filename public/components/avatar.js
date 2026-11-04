// @ts-check
import { esc } from '../utils/article-render.js';

/** A round profile picture, or the name's first letter on a colour of its own. */
export function avatarHtml({ username, displayName = null, avatarUrl = null }) {
  if (avatarUrl) return `<img src="${esc(avatarUrl)}" alt="" decoding="async">`;
  const name = displayName || username || '?';
  let h = 0;
  for (const c of username || name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<span class="avatar-letter" style="--h:${h}">${esc(name.trim().charAt(0).toUpperCase())}</span>`;
}
