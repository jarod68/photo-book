import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAlbums, getAlbum, getLiked, toggleLike, recordView, geocode, getMapPhotos,
} from '../../../public/api/client.js';

const ok  = (data) => ({ ok: true,  json: () => Promise.resolve(data) });
const err = (status) => ({ ok: false, status });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

// ── getAlbums ─────────────────────────────────────────────────────────────────

describe('getAlbums', () => {
  it('appelle /api/albums et retourne les données', async () => {
    const albums = [{ name: 'Paris', count: 3 }];
    fetch.mockResolvedValue(ok(albums));
    expect(await getAlbums()).toEqual(albums);
    expect(fetch).toHaveBeenCalledWith('/api/albums');
  });

  it("lève une erreur si la réponse n'est pas ok", async () => {
    fetch.mockResolvedValue(err(500));
    await expect(getAlbums()).rejects.toThrow('getAlbums: 500');
  });
});

// ── getAlbum ──────────────────────────────────────────────────────────────────

describe('getAlbum', () => {
  it("encode le nom d'album dans l'URL", async () => {
    fetch.mockResolvedValue(ok({ name: 'My Album', photos: [] }));
    await getAlbum('My Album');
    expect(fetch).toHaveBeenCalledWith('/api/albums/My%20Album');
  });

  it('retourne name + photos', async () => {
    const data = { name: 'Paris', photos: [{ filename: 'a.jpg' }] };
    fetch.mockResolvedValue(ok(data));
    expect(await getAlbum('Paris')).toEqual(data);
  });

  it("lève une erreur si la réponse n'est pas ok", async () => {
    fetch.mockResolvedValue(err(404));
    await expect(getAlbum('missing')).rejects.toThrow('getAlbum: 404');
  });
});

// ── getLiked ──────────────────────────────────────────────────────────────────

describe('getLiked', () => {
  it("inclut album et token dans l'URL", async () => {
    fetch.mockResolvedValue(ok({ filenames: [] }));
    await getLiked('Paris', 'my-token');
    expect(fetch).toHaveBeenCalledWith('/api/liked?album=Paris&token=my-token');
  });

  it("retourne { filenames: [] } si la réponse n'est pas ok", async () => {
    fetch.mockResolvedValue(err(503));
    expect(await getLiked('Paris', 'tok')).toEqual({ filenames: [] });
  });

  it("retourne { filenames: [] } en cas d'erreur réseau", async () => {
    fetch.mockRejectedValue(new Error('Network error'));
    expect(await getLiked('Paris', 'tok')).toEqual({ filenames: [] });
  });

  it('retourne les filenames du serveur', async () => {
    fetch.mockResolvedValue(ok({ filenames: ['a.jpg', 'b.jpg'] }));
    const result = await getLiked('Paris', 'tok');
    expect(result.filenames).toEqual(['a.jpg', 'b.jpg']);
  });
});

// ── toggleLike ────────────────────────────────────────────────────────────────

describe('toggleLike', () => {
  it('envoie un POST avec les bons paramètres', async () => {
    fetch.mockResolvedValue(ok({ liked: true, count: 1 }));
    await toggleLike('Paris', 'photo.jpg', 'tok');
    expect(fetch).toHaveBeenCalledWith('/api/like', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ album: 'Paris', filename: 'photo.jpg', token: 'tok' }),
    });
  });

  it('retourne les données de like du serveur', async () => {
    fetch.mockResolvedValue(ok({ liked: true, count: 5 }));
    expect(await toggleLike('Paris', 'photo.jpg', 'tok')).toEqual({ liked: true, count: 5 });
  });

  it("retourne null si la réponse n'est pas ok", async () => {
    fetch.mockResolvedValue(err(500));
    expect(await toggleLike('Paris', 'photo.jpg', 'tok')).toBeNull();
  });
});

// ── recordView ────────────────────────────────────────────────────────────────

describe('recordView', () => {
  it('envoie un POST avec les bons paramètres', async () => {
    fetch.mockResolvedValue(ok({ views: 1, likes: 0, liked: false }));
    await recordView('Paris', 'photo.jpg', 'tok');
    expect(fetch).toHaveBeenCalledWith('/api/view', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ album: 'Paris', filename: 'photo.jpg', token: 'tok' }),
    });
  });

  it('retourne views, likes et liked', async () => {
    const data = { views: 10, likes: 3, liked: true };
    fetch.mockResolvedValue(ok(data));
    expect(await recordView('Paris', 'photo.jpg', 'tok')).toEqual(data);
  });

  it("retourne null si la réponse n'est pas ok", async () => {
    fetch.mockResolvedValue(err(503));
    expect(await recordView('Paris', 'photo.jpg', 'tok')).toBeNull();
  });
});

// ── geocode ───────────────────────────────────────────────────────────────────

describe('geocode', () => {
  it('appelle /api/geocode avec lat et lng', async () => {
    fetch.mockResolvedValue(ok({ location: 'Paris, France' }));
    await geocode(48.8566, 2.3522);
    expect(fetch).toHaveBeenCalledWith('/api/geocode?lat=48.8566&lng=2.3522');
  });

  it('retourne la location string', async () => {
    fetch.mockResolvedValue(ok({ location: 'Paris, France' }));
    expect(await geocode(48.8566, 2.3522)).toBe('Paris, France');
  });

  it('retourne null si location est absent', async () => {
    fetch.mockResolvedValue(ok({ location: null }));
    expect(await geocode(48.8566, 2.3522)).toBeNull();
  });

  it("retourne null si la réponse n'est pas ok", async () => {
    fetch.mockResolvedValue(err(400));
    expect(await geocode(99, 0)).toBeNull();
  });
});

// ── getMapPhotos ──────────────────────────────────────────────────────────────

describe('getMapPhotos', () => {
  it('appelle /api/map', async () => {
    fetch.mockResolvedValue(ok([]));
    await getMapPhotos();
    expect(fetch).toHaveBeenCalledWith('/api/map');
  });

  it('retourne le tableau de photos', async () => {
    const photos = [{ gps: { lat: 48.8, lng: 2.3 }, album: 'Paris' }];
    fetch.mockResolvedValue(ok(photos));
    expect(await getMapPhotos()).toEqual(photos);
  });

  it("lève une erreur si la réponse n'est pas ok", async () => {
    fetch.mockResolvedValue(err(500));
    await expect(getMapPhotos()).rejects.toThrow('getMapPhotos: 500');
  });
});
