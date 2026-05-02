/**
 * Horizontal scrollable strip of photo thumbnails.
 */
export class ThumbnailStrip {
  /**
   * @param {HTMLElement} el - the scrollable container
   * @param {(index: number) => void} onSelect
   */
  constructor(el, onSelect) {
    this._el       = el;
    this._onSelect = onSelect;
  }

  /** @param {Array<{url: string, name: string, is360: boolean}>} photos */
  render(photos) {
    this._el.innerHTML = '';

    photos.forEach((photo, i) => {
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.setAttribute('role', 'option');
      thumb.dataset.i = i;
      thumb.onclick = () => this._onSelect?.(i);

      const img = document.createElement('img');
      img.alt = photo.name;
      img.onload = () => img.classList.add('loaded');
      img.src = photo.previewUrl || photo.url;
      thumb.appendChild(img);

      if (photo.is360) {
        const badge = document.createElement('span');
        badge.className = 'thumb-badge';
        badge.textContent = '360°';
        thumb.appendChild(badge);
      }

      this._el.appendChild(thumb);
    });
  }

  /** @param {number} index */
  activate(index) {
    Array.from(this._el.children).forEach((el, i) =>
      el.classList.toggle('active', i === index)
    );
    this._el.children[index]?.scrollIntoView({
      behavior: 'smooth', block: 'nearest', inline: 'center',
    });
  }

  /**
   * Mark a thumbnail as 360° after client-side detection.
   * @param {number} index
   */
  addBadge(index) {
    const thumb = this._el.children[index];
    if (!thumb || thumb.querySelector('.thumb-badge')) return;
    const badge = document.createElement('span');
    badge.className = 'thumb-badge';
    badge.textContent = '360°';
    thumb.appendChild(badge);
  }
}
