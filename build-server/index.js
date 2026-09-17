const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mime = require('mime-types');
const { validateRepository, validateDirectory, validateId } = require('../lib/shared');
const { createRedis, updateDeployment, appendLog } = require('../lib/state');

function createS3() {
  return new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
  });
}

function run(command, args, cwd, log, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, CI: 'true', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let pending = '';
    const handle = (chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) if (line.trim()) log(line.slice(0, 1000));
    };
    child.stdout.on('data', handle);
    child.stderr.on('data', handle);
    child.on('error', reject);
    child.on('close', (code) => {
      if (pending.trim()) log(pending.slice(0, 1000));
      code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function filesUnder(directory, relative = '') {
  const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(directory, name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

async function build(options = {}) {
  const id = options.id || process.env.DEPLOYMENT_ID;
  if (!validateId(id)) throw new Error('Invalid deployment ID.');
  const repoUrl = validateRepository(options.repoUrl || process.env.REPO_URL);
  const rootDirectory = validateDirectory(options.rootDirectory || process.env.ROOT_DIRECTORY, '.');
  const outputDirectory = validateDirectory(options.outputDirectory || process.env.OUTPUT_DIRECTORY, 'dist');
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET is required.');
  const redis = options.redis || createRedis();
  const s3 = options.s3 || createS3();
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hostmatic-'));
  const log = async (message) => { await appendLog(redis, id, message); };
  const writeLog = (message) => { log(message).catch(console.error); };
  try {
    await updateDeployment(redis, id, { status: 'cloning' });
    await log(`Cloning ${repoUrl}`);
    await run('git', ['clone', '--depth', '1', '--', repoUrl, path.join(temporary, 'source')], temporary, writeLog);
    const source = path.join(temporary, 'source');
    const project = path.resolve(source, rootDirectory);
    if (project !== source && !project.startsWith(`${source}${path.sep}`)) throw new Error('Project directory escapes the repository.');
    const manifest = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
    if (!manifest.scripts?.build) throw new Error('The project needs an npm build script.');
    await updateDeployment(redis, id, { status: 'building' });
    await log('Installing dependencies');
    const hasLock = await fs.access(path.join(project, 'package-lock.json')).then(() => true, () => false);
    const npmEnv = { npm_config_cache: process.env.HOSTMATIC_NPM_CACHE || path.join(temporary, 'npm-cache') };
    await run('npm', [hasLock ? 'ci' : 'install', '--no-audit', '--no-fund'], project, writeLog, npmEnv);
    await log('Building project');
    await run('npm', ['run', 'build'], project, writeLog, npmEnv);
    const output = path.resolve(project, outputDirectory);
    if (output !== project && !output.startsWith(`${project}${path.sep}`)) throw new Error('Output directory escapes the project.');
    const files = await filesUnder(output);
    if (!files.includes('index.html')) throw new Error('Output directory needs an index.html file.');
    await updateDeployment(redis, id, { status: 'publishing' });
    await log(`Uploading ${files.length} files`);
    for (const file of files) {
      const body = await fs.readFile(path.join(output, file));
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: `sites/${id}/${file.replaceAll(path.sep, '/')}`,
        Body: body, ContentType: mime.lookup(file) || 'application/octet-stream',
        CacheControl: file === 'index.html' ? 'no-cache' : 'public, max-age=3600'
      }));
    }
    await updateDeployment(redis, id, { status: 'deployed' });
    await log('Deployment ready');
  } catch (error) {
    await log(`Build failed: ${error.message}`);
    await updateDeployment(redis, id, { status: 'failed', error: error.message });
    throw error;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
    if (!options.redis) redis.disconnect();
    if (!options.s3) s3.destroy();
  }
}

if (require.main === module) build().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { build, createS3 };
