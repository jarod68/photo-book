/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requireLogin } from '../../public/utils/auth-check.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('location', { replace: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requireLogin', () => {
  it('ne redirige pas si l\'utilisateur est authentifié', async () => {
    fetch.mockResolvedValue({ json: () => Promise.resolve({ user: { id: 1, role: 'admin' } }) });
    await requireLogin();
    expect(location.replace).not.toHaveBeenCalled();
  });

  it('redirige vers /login.html si user est null', async () => {
    fetch.mockResolvedValue({ json: () => Promise.resolve({ user: null }) });
    await requireLogin();
    expect(location.replace).toHaveBeenCalledWith('/login.html');
  });

  it('redirige vers /login.html si user est undefined', async () => {
    fetch.mockResolvedValue({ json: () => Promise.resolve({}) });
    await requireLogin();
    expect(location.replace).toHaveBeenCalledWith('/login.html');
  });

  it('redirige vers /login.html si fetch lève une exception', async () => {
    fetch.mockRejectedValue(new Error('network error'));
    await requireLogin();
    expect(location.replace).toHaveBeenCalledWith('/login.html');
  });

  it('redirige vers /login.html si json() lève une exception', async () => {
    fetch.mockResolvedValue({ json: () => Promise.reject(new Error('bad json')) });
    await requireLogin();
    expect(location.replace).toHaveBeenCalledWith('/login.html');
  });

  it('appelle /api/auth/me', async () => {
    fetch.mockResolvedValue({ json: () => Promise.resolve({ user: { id: 1 } }) });
    await requireLogin();
    expect(fetch).toHaveBeenCalledWith('/api/auth/me');
  });
});
