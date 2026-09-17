const fs = require('node:fs')
const path = require('node:path')
const { dataDir } = require('./config')
const { SLUG_PATTERN } = require('./validation')

function deploymentPath(id) {
  if (!SLUG_PATTERN.test(id)) throw new Error('Invalid deployment ID.')
  return path.join(dataDir, 'deployments', `${id}.json`)
}

function readDeployment(id) {
  try {
    return JSON.parse(fs.readFileSync(deploymentPath(id), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function writeDeployment(deployment) {
  const target = deploymentPath(deployment.id)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify({ ...deployment, updatedAt: new Date().toISOString() }, null, 2))
  fs.renameSync(temporary, target)
}

function updateDeployment(id, changes, log) {
  const deployment = readDeployment(id)
  if (!deployment) throw new Error(`Deployment ${id} was not found.`)
  Object.assign(deployment, changes)
  if (log) deployment.logs = [...deployment.logs, log].slice(-300)
  writeDeployment(deployment)
  return deployment
}

module.exports = { readDeployment, writeDeployment, updateDeployment }
