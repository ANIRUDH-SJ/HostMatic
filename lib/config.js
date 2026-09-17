const path = require('node:path')

const dataDir = path.resolve(process.env.HOSTMATIC_DATA_DIR || path.join(__dirname, '..', '.hostmatic-data'))
const host = process.env.HOSTMATIC_HOST || '127.0.0.1'
const apiPort = Number(process.env.HOSTMATIC_API_PORT || 9000)
const previewPort = Number(process.env.HOSTMATIC_PREVIEW_PORT || 8000)
const previewDomain = process.env.HOSTMATIC_PREVIEW_DOMAIN || 'localhost'

function previewUrl(id) {
  return `http://${id}.${previewDomain}:${previewPort}/`
}

module.exports = { dataDir, host, apiPort, previewPort, previewDomain, previewUrl }
