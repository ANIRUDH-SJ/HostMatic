import { spawn } from 'node:child_process'

const commands = [
  ['api', process.execPath, ['api-server/index.js']],
  ['proxy', process.execPath, ['s3-reverse-proxy/index.js']],
  ['web', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:web']],
]

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, { stdio: 'inherit', env: process.env })
  child.on('error', (error) => console.error(`${name}: ${error.message}`))
  return child
})

let stopping = false
function stop(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill(signal)
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
for (const child of children) {
  child.on('exit', (code) => {
    if (!stopping) {
      stop()
      process.exitCode = code || 1
    }
  })
}
