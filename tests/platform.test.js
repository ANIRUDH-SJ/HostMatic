const assert = require('node:assert/strict');
const test = require('node:test');
const { validateRepository, validateDirectory, validateId, previewUrl } = require('../lib/shared');
const { createApp } = require('../api-server');

test('repository and directory inputs stay within supported scope', () => {
  assert.equal(validateRepository('https://github.com/example/site.git'), 'https://github.com/example/site');
  for (const url of ['http://github.com/example/site', 'https://github.com/example/site/tree/main', 'https://github.com.evil.test/example/site', 'file:///tmp/repo']) {
    assert.throws(() => validateRepository(url));
  }
  assert.equal(validateDirectory('', '.'), '.');
  assert.equal(validateDirectory('apps/web', '.'), 'apps/web');
  for (const directory of ['../secret', '/absolute', 'apps/../secret', 'apps\\secret']) assert.throws(() => validateDirectory(directory, '.'));
  assert.equal(validateId('0123456789ab'), true);
  assert.equal(validateId('../../etc'), false);
  assert.match(previewUrl('0123456789ab'), /^http:\/\/0123456789ab\.localhost:8000\/$/);
});

test('API rejects unsupported repositories before scheduling a build', async () => {
  const redis = { ping: async () => 'PONG', get: async () => null };
  const server = createApp(redis).listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    const invalid = await fetch(`${base}/project`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoUrl: 'https://example.com/site' }) });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /github/i);
    const missing = await fetch(`${base}/project/0123456789ab`);
    assert.equal(missing.status, 404);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
