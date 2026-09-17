const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { dataDir } = require('../lib/config')
const { readDeployment, updateDeployment } = require('../lib/store')

function log(id, message) {
  const lines = message.toString().split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (const line of lines) updateDeployment(id, {}, line.slice(0, 500))
}

function run(command, args, cwd, id, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${command} exceeded its time limit.`))
      settled = true
    }, timeoutMs)

    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        output += chunk.toString()
        const lines = output.split(/\r?\n/)
        output = lines.pop() || ''
        for (const line of lines) log(id, line)
      })
    }
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (output) log(id, output)
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}.`))
    })
  })
}

async function copyStaticFiles(source, destination) {
  await fs.mkdir(destination, { recursive: true })
  for (const item of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, item.name)
    const to = path.join(destination, item.name)
    if (item.isSymbolicLink()) throw new Error('Build output cannot contain symbolic links.')
    if (item.isDirectory()) await copyStaticFiles(from, to)
    else if (item.isFile()) await fs.copyFile(from, to)
  }
}

async function build(id) {
  const deployment = readDeployment(id)
  if (!deployment) throw new Error('Deployment not found.')
  const workspace = path.join(dataDir, 'workspaces', id)
  const source = path.join(workspace, 'source')
  const project = path.join(source, deployment.rootDirectory)
  const output = path.join(project, deployment.outputDirectory)
  const site = path.join(dataDir, 'sites', id)
  const temporarySite = `${site}.tmp`

  await fs.mkdir(workspace, { recursive: true })
  updateDeployment(id, { status: 'cloning' }, `Cloning ${deployment.repoUrl.replace(/\.git$/, '')}...`)
  await run('git', ['clone', '--depth=1', '--single-branch', deployment.repoUrl, source], workspace, id, 120000)

  const packagePath = path.join(project, 'package.json')
  try {
    await fs.access(packagePath)
  } catch {
    throw new Error('No package.json was found in the selected project directory.')
  }

  updateDeployment(id, { status: 'building' }, 'Installing dependencies...')
  const hasLock = await fs.access(path.join(project, 'package-lock.json')).then(() => true, () => false)
  await run('npm', [hasLock ? 'ci' : 'install', '--no-audit', '--no-fund'], project, id, 600000)
  log(id, 'Building project...')
  await run('npm', ['run', 'build'], project, id, 600000)

  try {
    await fs.access(path.join(output, 'index.html'))
  } catch {
    throw new Error(`Build did not create ${deployment.outputDirectory}/index.html.`)
  }

  updateDeployment(id, { status: 'publishing' }, 'Publishing static files...')
  await fs.rm(temporarySite, { recursive: true, force: true })
  await copyStaticFiles(output, temporarySite)
  await fs.rename(temporarySite, site)
  updateDeployment(id, { status: 'deployed' }, `Deployment ready at ${deployment.url}`)
  await fs.rm(workspace, { recursive: true, force: true })
}

if (require.main === module) {
  const id = process.argv[2]
  build(id).catch((error) => {
    console.error(error)
    if (readDeployment(id)) updateDeployment(id, { status: 'failed', error: error.message }, `Build failed: ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { build, copyStaticFiles }
