// Real files from public/, no fs mocks: the Cache-Control each kind of asset gets.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app } = await import('../../../server.js');

describe('static asset caching', () => {
  it.each(['/login.html', '/pages/home.js', '/style.css'])(
    '%s is revalidated on every load (no-cache + ETag), so a deploy is picked up at once',
    async (url) => {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers.etag).toBeTruthy();
    },
  );

  it('answers 304 when the browser already has the current version', async () => {
    const first = await request(app).get('/style.css');
    const again = await request(app).get('/style.css').set('If-None-Match', first.headers.etag);
    expect(again.status).toBe(304);
  });
});
