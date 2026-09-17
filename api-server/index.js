const express = require('express')
const { randomBytes } = require('node:crypto')
const { spawn } = require('node:child_process')
const path = require('node:path')
const { host, apiPort, previewUrl } = require('../lib/config')
const { readDeployment, writeDeployment, updateDeployment } = require('../lib/store')
const { SLUG_PATTERN, githubRepositoryUrl, relativeDirectory } = require('../lib/validation')

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '8kb' }))

if (process.env.FRONTEND_ORIGIN) {
  app.use((req, res, next) => {
    if (req.get('origin') === process.env.FRONTEND_ORIGIN) {
      res.set('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN)
      res.set('Vary', 'Origin')
      res.set('Access-Control-Allow-Headers', 'Content-Type')
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

app.post('/api/deploy', (req, res) => {
  let repoUrl
  let rootDirectory
  let outputDirectory
  try {
    repoUrl = githubRepositoryUrl(req.body.repoUrl)
    rootDirectory = relativeDirectory(req.body.rootDirectory, 'Project directory')
    outputDirectory = relativeDirectory(req.body.outputDirectory, 'Output directory') || 'dist'
  } catch (error) {
    return res.status(400).json({ error: error.message })
  }

  const id = randomBytes(4).toString('hex')
  const deployment = {
    id,
    repoUrl,
    rootDirectory,
    outputDirectory,
    status: 'queued',
    url: previewUrl(id),
    logs: ['Deployment queued.'],
    createdAt: new Date().toISOString(),
  }
  writeDeployment(deployment)

  const worker = spawn(process.execPath, [path.join(__dirname, '..', 'build-server', 'index.js'), id], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  })
  worker.on('error', (error) => {
    updateDeployment(id, { status: 'failed', error: error.message }, `Build worker could not start: ${error.message}`)
  })
  worker.on('exit', (code) => {
    const current = readDeployment(id)
    if (code && current && current.status !== 'failed') {
      updateDeployment(id, { status: 'failed', error: `Build worker exited with code ${code}.` }, 'Build worker stopped unexpectedly.')
    }
  })

  res.status(202).json({ id, status: deployment.status, url: deployment.url })
})

app.get('/api/status/:id', (req, res) => {
  if (!SLUG_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'Invalid deployment ID.' })
  const deployment = readDeployment(req.params.id)
  if (!deployment) return res.status(404).json({ error: 'Deployment not found.' })
  res.set('Cache-Control', 'no-store')
  res.json(deployment)
})

app.use((error, _req, res, _next) => {
  res.status(error.status || 500).json({ error: error.status === 400 ? 'Invalid JSON request.' : 'Internal server error.' })
})

if (require.main === module) {
  app.listen(apiPort, host, () => console.log(`HostMatic API listening on http://${host}:${apiPort}`))
}

module.exports = app
