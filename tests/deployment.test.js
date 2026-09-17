const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { execFileSync } = require('node:child_process')

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hostmatic-test-'))
process.env.HOSTMATIC_DATA_DIR = path.join(fixtureRoot, 'data')

const { githubRepositoryUrl, relativeDirectory } = require('../lib/validation')
const { writeDeployment, readDeployment } = require('../lib/store')
const { build } = require('../build-server')
const previewApp = require('../s3-reverse-proxy')
const apiApp = require('../api-server')

test('repository and build paths accept only safe GitHub input', () => {
  assert.equal(githubRepositoryUrl('https://github.com/example/my-site'), 'https://github.com/example/my-site.git')
  for (const input of ['http://github.com/example/site', 'https://github.com.evil.test/x/y', 'file:///tmp/repo', 'https://github.com/example/site/tree/main', 'https://github.com/x/y?token=1']) {
    assert.throws(() => githubRepositoryUrl(input))
  }
  assert.equal(relativeDirectory('apps/web', 'Project directory'), 'apps/web')
  for (const input of ['../private', '/absolute', 'apps//web', 'apps/../web']) assert.throws(() => relativeDirectory(input, 'Project directory'))
})

test('API rejects invalid repository URLs before starting a build', async () => {
  const server = apiApp.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/deploy`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'http://127.0.0.1/private' }),
    })
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /GitHub/)
  } finally { server.close() }
})

test('builder publishes a static site and preview serves assets and SPA routes', async () => {
  const repository = path.join(fixtureRoot, 'repository')
  fs.mkdirSync(path.join(repository, 'web'), { recursive: true })
  fs.writeFileSync(path.join(repository, 'web', 'package.json'), JSON.stringify({
    name: 'fixture-site', version: '1.0.0', scripts: { build: 'node build.cjs' },
  }))
  fs.writeFileSync(path.join(repository, 'web', 'build.cjs'), `const fs = require('node:fs'); fs.mkdirSync('site/assets', { recursive: true }); fs.writeFileSync('site/index.html', '<h1>Fixture deployment</h1>'); fs.writeFileSync('site/assets/style.css', 'body { color: green; }');`)
  execFileSync('git', ['init', '-q', repository])
  execFileSync('git', ['-C', repository, 'add', '.'])
  execFileSync('git', ['-C', repository, '-c', 'user.name=HostMatic Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'])

  const id = 'abcd1234'
  writeDeployment({ id, repoUrl: `file://${repository}`, rootDirectory: 'web', outputDirectory: 'site', status: 'queued', url: `http://${id}.localhost:3001/`, logs: [], createdAt: new Date().toISOString() })
  await build(id)
  const deployment = readDeployment(id)
  assert.equal(deployment.status, 'deployed')
  assert.ok(deployment.logs.some((line) => line.includes('Deployment ready')))

  const server = previewApp.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const port = server.address().port
  function request(urlPath, accept) {
    return new Promise((resolve, reject) => {
      const headers = { Host: `${id}.localhost` }
      if (accept) headers.Accept = accept
      http.get({ host: '127.0.0.1', port, path: urlPath, headers }, (response) => {
        let body = ''
        response.on('data', (chunk) => { body += chunk })
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }))
      }).on('error', reject)
    })
  }
  try {
    const home = await request('/')
    assert.equal(home.status, 200, home.body)
    assert.match(home.body, /Fixture deployment/)
    const css = await request('/assets/style.css')
    assert.equal(css.status, 200)
    assert.match(css.headers['content-type'], /text\/css/)
    const spa = await request('/dashboard', 'text/html')
    assert.equal(spa.status, 200)
    assert.match(spa.body, /Fixture deployment/)
    const missing = await request('/missing.css')
    assert.equal(missing.status, 404)
  } finally { server.close() }
})
