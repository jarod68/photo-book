import { createRequire } from 'module';
import { describe, it, expect, vi, afterEach } from 'vitest';

const dockerInfo = await import('../../services/docker-info.js');
const _require   = createRequire(import.meta.url);
const httpMod    = _require('http');

afterEach(() => vi.restoreAllMocks());

// ── Helpers ───────────────────────────────────────────────────────────────────

// Builds a mock http.request that returns JSON responses in order.
// Each entry in `responses` is served to consecutive calls.
function mockHttpResponses(responses) {
  let idx = 0;
  vi.spyOn(httpMod, 'request').mockImplementation((_options, callback) => {
    const data = responses[idx++];
    const mockRes = { on: vi.fn() };
    mockRes.on.mockImplementation((event, cb) => {
      if (event === 'data') cb(Buffer.from(JSON.stringify(data)));
      if (event === 'end') cb();
      return mockRes;
    });
    const mockReq = { on: vi.fn().mockReturnThis(), end: vi.fn() };
    callback(mockRes);
    return mockReq;
  });
}

// Simulates a network error on the first request (e.g. Docker socket absent).
function mockHttpError(message) {
  vi.spyOn(httpMod, 'request').mockImplementation(() => {
    const mockReq = { on: vi.fn().mockReturnThis(), end: vi.fn() };
    mockReq.on.mockImplementation((event, cb) => {
      if (event === 'error') cb(new Error(message));
      return mockReq;
    });
    return mockReq;
  });
}

// ── getContainers ─────────────────────────────────────────────────────────────

describe('getContainers', () => {
  it('retourne un tableau vide si aucun container actif', async () => {
    mockHttpResponses([[]]);
    const result = await dockerInfo.getContainers();
    expect(result).toEqual([]);
  });

  it('retourne les infos complètes d\'un container', async () => {
    const containers = [{
      Id:      'abc123def456789full',
      Names:   ['/photo-book'],
      Image:   'jarod68/photo-book:latest',
      ImageID: 'sha256:img123',
      Status:  'Up 2 hours',
      State:   'running',
    }];
    const imageInfo = {
      RepoTags:    ['jarod68/photo-book:latest'],
      RepoDigests: ['jarod68/photo-book@sha256:digest123'],
    };
    mockHttpResponses([containers, imageInfo]);
    const result = await dockerInfo.getContainers();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id:     'abc123def456',
      name:   'photo-book',
      image:  'jarod68/photo-book:latest',
      status: 'Up 2 hours',
      state:  'running',
      tags:   ['jarod68/photo-book:latest'],
      digest: 'jarod68/photo-book@sha256:digest123',
    });
  });

  it('tronque l\'id du container à 12 caractères', async () => {
    const containers = [{
      Id: '0123456789abcdef', Names: ['/app'], Image: 'img',
      ImageID: 'id', Status: 'Up', State: 'running',
    }];
    mockHttpResponses([containers, { RepoTags: [], RepoDigests: [] }]);
    const [c] = await dockerInfo.getContainers();
    expect(c.id).toBe('0123456789ab');
    expect(c.id).toHaveLength(12);
  });

  it('retire le slash initial du nom du container', async () => {
    const containers = [{
      Id: 'abc123def456', Names: ['/my-service'], Image: 'img',
      ImageID: 'id', Status: 'Up', State: 'running',
    }];
    mockHttpResponses([containers, { RepoTags: [], RepoDigests: [] }]);
    const [c] = await dockerInfo.getContainers();
    expect(c.name).toBe('my-service');
  });

  it('utilise ImageID comme digest si RepoDigests est vide', async () => {
    const containers = [{
      Id: 'abc123def456', Names: ['/app'], Image: 'img',
      ImageID: 'sha256:fallback', Status: 'Up', State: 'running',
    }];
    mockHttpResponses([containers, { RepoTags: [], RepoDigests: [] }]);
    const [c] = await dockerInfo.getContainers();
    expect(c.digest).toBe('sha256:fallback');
    expect(c.tags).toEqual([]);
  });

  it('gère plusieurs containers en parallèle', async () => {
    const containers = [
      { Id: 'aaa111bbb222', Names: ['/svc1'], Image: 'img1', ImageID: 'id1', Status: 'Up',     State: 'running' },
      { Id: 'ccc333ddd444', Names: ['/svc2'], Image: 'img2', ImageID: 'id2', Status: 'Exited', State: 'exited'  },
    ];
    mockHttpResponses([
      containers,
      { RepoTags: ['img1:v1'], RepoDigests: [] },
      { RepoTags: ['img2:v2'], RepoDigests: [] },
    ]);
    const result = await dockerInfo.getContainers();
    expect(result).toHaveLength(2);
    const names = result.map(c => c.name).sort();
    expect(names).toEqual(['svc1', 'svc2']);
  });

  it('retourne tags:[] et digest:null si la requête image échoue', async () => {
    const containers = [{
      Id: 'abc123def456', Names: ['/app'], Image: 'img',
      ImageID: 'id', Status: 'Up', State: 'running',
    }];
    let call = 0;
    vi.spyOn(httpMod, 'request').mockImplementation((_options, callback) => {
      call++;
      const mockReq = { on: vi.fn().mockReturnThis(), end: vi.fn() };
      if (call === 1) {
        // /containers/json — succès
        const mockRes = { on: vi.fn() };
        mockRes.on.mockImplementation((event, cb) => {
          if (event === 'data') cb(Buffer.from(JSON.stringify(containers)));
          if (event === 'end') cb();
          return mockRes;
        });
        callback(mockRes);
      } else {
        // /images/:id/json — erreur réseau
        mockReq.on.mockImplementation((event, cb) => {
          if (event === 'error') cb(new Error('image not found'));
          return mockReq;
        });
      }
      return mockReq;
    });
    const result = await dockerInfo.getContainers();
    expect(result).toHaveLength(1);
    expect(result[0].tags).toEqual([]);
    expect(result[0].digest).toBeNull();
  });

  it('rejette si le socket Docker est indisponible', async () => {
    mockHttpError('connect ENOENT /var/run/docker.sock');
    await expect(dockerInfo.getContainers()).rejects.toThrow('connect ENOENT');
  });

  it('rejette si la réponse n\'est pas du JSON valide', async () => {
    vi.spyOn(httpMod, 'request').mockImplementation((_options, callback) => {
      const mockRes = { on: vi.fn() };
      mockRes.on.mockImplementation((event, cb) => {
        if (event === 'data') cb(Buffer.from('not json'));
        if (event === 'end') cb();
        return mockRes;
      });
      const mockReq = { on: vi.fn().mockReturnThis(), end: vi.fn() };
      callback(mockRes);
      return mockReq;
    });
    await expect(dockerInfo.getContainers()).rejects.toThrow();
  });
});
