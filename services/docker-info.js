const http = require('http');

function dockerGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: '/var/run/docker.sock',
        path:       apiPath,
        method:     'GET',
        headers:    { Host: 'localhost' },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function getContainers() {
  const list = await dockerGet('/containers/json?all=false');

  return Promise.all(list.map(async c => {
    let digest = null;
    let tags   = [];
    try {
      const img = await dockerGet(`/images/${c.ImageID}/json`);
      tags   = img.RepoTags    ?? [];
      digest = (img.RepoDigests ?? [])[0] ?? c.ImageID ?? null;
    } catch (_) {}

    return {
      id:     c.Id.slice(0, 12),
      name:   (c.Names[0] ?? '').replace(/^\//, ''),
      image:  c.Image,
      status: c.Status,
      state:  c.State,
      tags,
      digest,
    };
  }));
}

module.exports = { getContainers };
