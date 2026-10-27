import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Slideshow } from '../../../public/utils/slideshow.js';

function fakeDoc() {
  const listeners = new Set();
  return {
    hidden: false,
    addEventListener: (_e, f) => listeners.add(f),
    removeEventListener: (_e, f) => listeners.delete(f),
    setHidden(h) { this.hidden = h; listeners.forEach((f) => f()); },
    listeners,
  };
}

describe('Slideshow (F4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('avance toutes les `interval` ms et signale lecture / arrêt', () => {
    const next = vi.fn(() => true), onChange = vi.fn();
    const s = new Slideshow({ next, onChange, interval: 1000, doc: fakeDoc() });
    s.start();
    expect(onChange).toHaveBeenLastCalledWith(true);
    vi.advanceTimersByTime(999);  expect(next).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);    expect(next).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000); expect(next).toHaveBeenCalledTimes(3);
    s.stop();
    expect(onChange).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(5000); expect(next).toHaveBeenCalledTimes(3);
  });

  it('s\'arrête quand next() renvoie false', () => {
    const s = new Slideshow({ next: () => false, interval: 1000, doc: fakeDoc() });
    s.start(); vi.advanceTimersByTime(1000);
    expect(s.playing).toBe(false);
  });

  it('attend la fin d\'une vidéo (isBusy)', () => {
    let busy = true;
    const next = vi.fn(() => true);
    const s = new Slideshow({ next, isBusy: () => busy, interval: 1000, doc: fakeDoc() });
    s.start(); vi.advanceTimersByTime(3000);
    expect(next).not.toHaveBeenCalled();
    busy = false; vi.advanceTimersByTime(1000);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('restart() redonne un intervalle complet après une navigation manuelle', () => {
    const next = vi.fn(() => true);
    const s = new Slideshow({ next, interval: 1000, doc: fakeDoc() });
    s.start(); vi.advanceTimersByTime(800);
    s.restart(); vi.advanceTimersByTime(800);
    expect(next).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200); expect(next).toHaveBeenCalledTimes(1);
  });

  it('se met en pause quand la page est masquée', () => {
    const doc = fakeDoc(), next = vi.fn(() => true);
    const s = new Slideshow({ next, interval: 1000, doc });
    s.start(); doc.setHidden(true);
    vi.advanceTimersByTime(5000); expect(next).not.toHaveBeenCalled();
    doc.setHidden(false); vi.advanceTimersByTime(1000);
    expect(next).toHaveBeenCalledTimes(1);
    s.stop(); expect(doc.listeners.size).toBe(0);
  });

  it('toggle() alterne', () => {
    const s = new Slideshow({ next: () => true, doc: fakeDoc() });
    s.toggle(); expect(s.playing).toBe(true);
    s.toggle(); expect(s.playing).toBe(false);
  });
});
