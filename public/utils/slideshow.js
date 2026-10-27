/**
 * Slideshow timer (F4): calls `next()` every `interval` ms while playing.
 * `next()` returns false at the end of the album, which stops the show.
 * `isBusy()` (e.g. a video still playing) postpones the step. The timer
 * pauses while the page is hidden and starts a full interval when shown
 * again or after a manual move (`restart()`).
 */
export class Slideshow {
  constructor({ next, isBusy = () => false, onChange = () => {}, interval = 5000, doc = document }) {
    this._next     = next;
    this._isBusy   = isBusy;
    this._onChange = onChange;
    this.interval  = interval;
    this._doc      = doc;
    this._timer    = null;
    this.playing   = false;
    this._onVisibility = () => {
      if (!this.playing) return;
      if (this._doc.hidden) this._clear(); else this._schedule();
    };
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this._doc.addEventListener('visibilitychange', this._onVisibility);
    this._schedule();
    this._onChange(true);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    this._clear();
    this._doc.removeEventListener('visibilitychange', this._onVisibility);
    this._onChange(false);
  }

  toggle() { if (this.playing) this.stop(); else this.start(); }

  /** A photo was shown by hand: give it a full interval. */
  restart() { if (this.playing) this._schedule(); }

  _clear() { clearTimeout(this._timer); this._timer = null; }

  _schedule() {
    this._clear();
    if (this._doc.hidden) return;
    this._timer = setTimeout(() => this._tick(), this.interval);
  }

  _tick() {
    if (this._isBusy()) { this._schedule(); return; }
    if (this._next() === false) this.stop(); else this._schedule();
  }
}
