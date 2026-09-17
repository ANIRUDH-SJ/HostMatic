const express = require('express')
const fs = require('node:fs')
const path = require('node:path')
const { dataDir, host, previewPort, previewDomain } = require('../lib/config')
const { readDeployment } = require('../lib/store')
const { SLUG_PATTERN } = require('../lib/validation')

const app = express()
app.disable('x-powered-by')

app.use((req, res, next) => {
  const hostname = req.hostname.toLowerCase()
  const suffix = `.${previewDomain.toLowerCase()}`
  const id = hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : ''
  if (!SLUG_PATTERN.test(id)) return res.status(404).send('Preview not found.')
  const deployment = readDeployment(id)
  if (!deployment || deployment.status !== 'deployed') return res.status(404).send('Preview is not ready yet.')

  const site = path.join(dataDir, 'sites', id)
  if (!fs.existsSync(path.join(site, 'index.html'))) return res.status(404).send('Preview not found.')
  res.set('X-Content-Type-Options', 'nosniff')
  express.static(site, { dotfiles: 'deny', fallthrough: true })(req, res, () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (path.extname(req.path) || !req.accepts('html')) return res.status(404).send('File not found.')
    res.sendFile('index.html', { root: site })
  })
})

if (require.main === module) {
  app.listen(previewPort, host, () => console.log(`HostMatic previews listening on http://${host}:${previewPort}`))
  if (host === '127.0.0.1') {
    app.listen(previewPort, '::1', () => console.log('HostMatic previews also listening on IPv6 loopback'))
      .on('error', () => console.warn('IPv6 loopback is unavailable; IPv4 previews remain active.'))
  }
}

module.exports = app
