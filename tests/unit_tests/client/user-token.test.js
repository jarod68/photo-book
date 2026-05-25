import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getUserToken } from '../../../public/utils/user-token.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// happy-dom does not provide a complete localStorage implementation
// (localStorage.clear() is missing) — we provide our own stub
function makeStorage() {
  const store = Object.create(null);
  return {
    getItem:    key => (key in store ? store[key] : null),
    setItem:    (key, val) => { store[key] = String(val); },
    removeItem: key => { delete store[key]; },
    clear:      () => { for (const k in store) delete store[k]; },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getUserToken', () => {
  it('génère un UUID valide au premier appel', () => {
    expect(getUserToken()).toMatch(UUID_RE);
  });

  it('retourne le même token à chaque appel', () => {
    const t1 = getUserToken();
    const t2 = getUserToken();
    expect(t1).toBe(t2);
  });

  it('persiste le token dans localStorage', () => {
    const token = getUserToken();
    expect(localStorage.getItem('pb_user_token')).toBe(token);
  });

  it('utilise un token existant dans localStorage', () => {
    const existing = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    localStorage.setItem('pb_user_token', existing);
    expect(getUserToken()).toBe(existing);
  });
});
