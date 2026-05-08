/**
 * Horizontal tab bar for album navigation inside the viewer.
 */
export class AlbumTabs {
  /** @param {HTMLElement} el - container element */
  constructor(el) {
    this._el       = el;
    this._onSelect = null;
  }

  /** @param {(name: string) => void} fn */
  onSelect(fn) { this._onSelect = fn; }

  /**
   * @param {Array<{name: string, count: number}>} albums
   * @param {string} activeName
   */
  render(albums, activeName) {
    this._el.innerHTML = '';

    const back = document.createElement('a');
    back.className = 'album-tab album-tab-back';
    back.href = 'index.html';
    back.setAttribute('aria-label', 'Retour aux albums');
    back.textContent = '←';
    this._el.appendChild(back);

    const divider = document.createElement('span');
    divider.className = 'album-tab-divider';
    this._el.appendChild(divider);

    albums.forEach(album => {
      const btn = document.createElement('button');
      btn.className = 'album-tab' + (album.name === activeName ? ' active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(album.name === activeName));
      btn.textContent = album.name;
      const countEl = document.createElement('span');
      countEl.className = 'count';
      countEl.textContent = album.count;
      btn.appendChild(countEl);
      btn.onclick = () => this._onSelect?.(album.name);
      this._el.appendChild(btn);
    });
  }
}
