import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getAlbums, getAlbum, getLiked, toggleLike, recordView, geocode, getMapPhotos,
} from '../../public/api/client.js';

const ok  = (data) => ({ ok: true,  json: () => Promise.resolve(data) });
const err = (status) => ({ ok: false, status });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

// ── getAlbums ─────────────────────────────────────────────────────────────────

describe('getAlbums', () => {
  it('calls /api/albums and returns the data', async () => {
    const albums = [{ name: 'Paris', count: 3 }];
    fetch.mockResolvedValue(ok(albums));
    expect(await getAlbums()).toEqual(albums);
    expect(fetch).toHaveBeenCalledWith('/api/albums');
  });

  it('throws if response is not ok', async () => {
    fetch.mockResolvedValue(err(500));
    await expect(getAlbums()).rejects.toThrow('getAlbums: 500');
  });
});

// ── getAlbum ──────────────────────────────────────────────────────────────────

describe('getAlbum', () => {
  it('encodes album name in the URL', async () => {
    fetch.mockResolvedValue(ok({ name: 'My Album', photos: [] }));
    await getAlbum('My Album');
    expect(fetch).toHaveBeenCalledWith('/api/albums/My%20Album');
  });

  it('returns name + photos', async () => {
    const data = { name: 'Paris', photos: [{ filename: 'a.jpg' }] };
    fetch.mockResolvedValue(ok(data));
    expect(await getAlbum('Paris')).toEqual(data);
  });

  it('throws if response is not ok', async () => {
    fetch.mockResolvedValue(err(404));
    await expect(getAlbum('missing')).rejects.toThrow('getAlbum: 404');
  });
});

// ── getLiked ──────────────────────────────────────────────────────────────────

describe('getLiked', () => {
  it('includes album and token in the URL', async () => {
    fetch.mockResolvedValue(ok({ filenames: [] }));
    await getLiked('Paris', 'my-token');
    expect(fetch).toHaveBeenCalledWith('/api/liked?album=Paris&token=my-token');
  });

  it('returns { filenames: [] } if response is not ok', async () => {
    fetch.mockResolvedValue(err(503));
    expect(await getLiked('Paris', 'tok')).toEqual({ filenames: [] });
  });

  it('returns { filenames: [] } on network error', async () => {
    fetch.mockRejectedValue(new Error('Network error'));
    expect(await getLiked('Paris', 'tok')).toEqual({ filenames: [] });
  });

  it('returns filenames from the server', async () => {
    fetch.mockResolvedValue(ok({ filenames: ['a.jpg', 'b.jpg'] }));
    const result = await getLiked('Paris', 'tok');
    expect(result.filenames).toEqual(['a.jpg', 'b.jpg']);
  });
});

// ── toggleLike ────────────────────────────────────────────────────────────────

describe('toggleLike', () => {
  it('sends a POST with the correct parameters', async () => {
    fetch.mockResolvedValue(ok({ liked: true, count: 1 }));
    await toggleLike('Paris', 'photo.jpg', 'tok');
    expect(fetch).toHaveBeenCalledWith('/api/like', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ album: 'Paris', filename: 'photo.jpg', token: 'tok' }),
    });
  });

  it('returns like data from the server', async () => {
    fetch.mockResolvedValue(ok({ liked: true, count: 5 }));
    expect(await toggleLike('Paris', 'photo.jpg', 'tok')).toEqual({ liked: true, count: 5 });
  });

  it('returns null if response is not ok', async () => {
    fetch.mockResolvedValue(err(500));
    expect(await toggleLike('Paris', 'photo.jpg', 'tok')).toBeNull();
  });
});

// ── recordView ────────────────────────────────────────────────────────────────

describe('recordView', () => {
  it('sends a POST with the correct parameters', async () => {
    fetch.mockResolvedValue(ok({ views: 1, likes: 0, liked: false }));
    await recordView('Paris', 'photo.jpg', 'tok');
    expect(fetch).toHaveBeenCalledWith('/api/view', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ album: 'Paris', filename: 'photo.jpg', token: 'tok' }),
    });
  });

  it('returns views, likes and liked', async () => {
    const data = { views: 10, likes: 3, liked: true };
    fetch.mockResolvedValue(ok(data));
    expect(await recordView('Paris', 'photo.jpg', 'tok')).toEqual(data);
  });

  it('returns null if response is not ok', async () => {
    fetch.mockResolvedValue(err(503));
    expect(await recordView('Paris', 'photo.jpg', 'tok')).toBeNull();
  });
});

// ── geocode ───────────────────────────────────────────────────────────────────

describe('geocode', () => {
  it('calls /api/geocode with lat and lng', async () => {
    fetch.mockResolvedValue(ok({ location: 'Paris, France' }));
    await geocode(48.8566, 2.3522);
    expect(fetch).toHaveBeenCalledWith('/api/geocode?lat=48.8566&lng=2.3522');
  });

  it('returns the location string', async () => {
    fetch.mockResolvedValue(ok({ location: 'Paris, France' }));
    expect(await geocode(48.8566, 2.3522)).toBe('Paris, France');
  });

  it('returns null if location is absent', async () => {
    fetch.mockResolvedValue(ok({ location: null }));
    expect(await geocode(48.8566, 2.3522)).toBeNull();
  });

  it('returns null if response is not ok', async () => {
    fetch.mockResolvedValue(err(400));
    expect(await geocode(99, 0)).toBeNull();
  });
});

// ── getMapPhotos ──────────────────────────────────────────────────────────────

describe('getMapPhotos', () => {
  it('calls /api/map', async () => {
    fetch.mockResolvedValue(ok([]));
    await getMapPhotos();
    expect(fetch).toHaveBeenCalledWith('/api/map');
  });

  it('returns the photos array', async () => {
    const photos = [{ gps: { lat: 48.8, lng: 2.3 }, album: 'Paris' }];
    fetch.mockResolvedValue(ok(photos));
    expect(await getMapPhotos()).toEqual(photos);
  });

  it('throws if response is not ok', async () => {
    fetch.mockResolvedValue(err(500));
    await expect(getMapPhotos()).rejects.toThrow('getMapPhotos: 500');
  });
});
