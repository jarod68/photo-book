/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cameFromApp, wireBack, saveState, pageState } from '../../../public/utils/back.js';

const referrer = (url) => Object.defineProperty(document, 'referrer', { value: url, configurable: true });
const historyLength = (n) => Object.defineProperty(history, 'length', { value: n, configurable: true });

describe('retour en arrière (back.js)', () => {
  afterEach(() => { vi.restoreAllMocks(); referrer(''); });

  it('revient en arrière seulement depuis une page du site (pas la connexion)', () => {
    historyLength(3);
    referrer(`${location.origin}/search.html?q=usa`);
    expect(cameFromApp()).toBe(true);
    referrer('https://ailleurs.example/');
    expect(cameFromApp()).toBe(false);
    referrer(`${location.origin}/login.html`);
    expect(cameFromApp()).toBe(false);
    referrer('');
    expect(cameFromApp()).toBe(false);
    historyLength(1);
    referrer(`${location.origin}/search.html`);
    expect(cameFromApp()).toBe(false);   // a new tab: nothing to go back to
  });

  it('le bouton ← fait history.back(), sinon suit son lien', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    const a = document.createElement('a');
    a.href = 'index.html';
    document.body.append(a);
    wireBack(a);

    historyLength(3);
    referrer(`${location.origin}/map.html`);
    const e1 = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(e1);
    expect(back).toHaveBeenCalledTimes(1);
    expect(e1.defaultPrevented).toBe(true);

    referrer('https://ailleurs.example/');
    const e2 = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(e2);
    expect(back).toHaveBeenCalledTimes(1);
    expect(e2.defaultPrevented).toBe(false);

    referrer(`${location.origin}/map.html`);
    const e3 = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true });   // new tab
    a.dispatchEvent(e3);
    expect(e3.defaultPrevented).toBe(false);
    a.remove();
  });

  it('l\'état de la page se complète sans nouvelle entrée d\'historique', () => {
    const before = history.length;
    saveState({ view: { lat: 1, lng: 2, zoom: 3 } });
    saveState({ scrollY: 120 }, '?q=paris');
    expect(pageState()).toEqual({ view: { lat: 1, lng: 2, zoom: 3 }, scrollY: 120 });
    expect(location.search).toBe('?q=paris');
    expect(history.length).toBe(before);
  });
});
