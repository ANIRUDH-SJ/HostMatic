const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const express = require('express');
const { Server } = require('socket.io');
const { ECSClient, RunTaskCommand } = require('@aws-sdk/client-ecs');
const { deploymentId, validateRepository, validateDirectory, validateId, previewUrl } = require('../lib/shared');
const { createRedis, getDeployment, setDeployment, updateDeployment, appendLog, getLogs } = require('../lib/state');

function allowedOrigin(origin) {
  return !origin || (process.env.FRONTEND_ORIGIN || 'http://localhost:3002').split(',').map((v) => v.trim()).includes(origin);
}

async function startBuild(record) {
  if ((process.env.DEPLOYMENT_DRIVER || 'local') === 'ecs') {
    const cluster = process.env.ECS_CLUSTER_ARN;
    const taskDefinition = process.env.ECS_TASK_DEFINITION_ARN;
    const subnets = (process.env.ECS_SUBNET_IDS || '').split(',').filter(Boolean);
    const securityGroups = (process.env.ECS_SECURITY_GROUP_IDS || '').split(',').filter(Boolean);
    if (!cluster || !taskDefinition || !subnets.length || !securityGroups.length) throw new Error('ECS configuration is incomplete.');
    const client = new ECSClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const command = new RunTaskCommand({
      cluster, taskDefinition, launchType: 'FARGATE', count: 1,
      networkConfiguration: { awsvpcConfiguration: { subnets, securityGroups, assignPublicIp: process.env.ECS_ASSIGN_PUBLIC_IP || 'ENABLED' } },
      overrides: { containerOverrides: [{
        name: process.env.ECS_CONTAINER_NAME || 'build-server',
        environment: [
          ['DEPLOYMENT_ID', record.id], ['REPO_URL', record.repoUrl],
          ['ROOT_DIRECTORY', record.rootDirectory], ['OUTPUT_DIRECTORY', record.outputDirectory]
        ].map(([name, value]) => ({ name, value }))
      }] }
    });
    const result = await client.send(command);
    if (result.failures?.length || !result.tasks?.length) throw new Error(result.failures?.[0]?.reason || 'ECS did not start a task.');
    return result.tasks[0].taskArn;
  }
  const worker = spawn(process.execPath, [path.join(__dirname, '../build-server/index.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DEPLOYMENT_ID: record.id, REPO_URL: record.repoUrl, ROOT_DIRECTORY: record.rootDirectory, OUTPUT_DIRECTORY: record.outputDirectory },
    stdio: 'ignore', detached: true
  });
  worker.unref();
  return `local:${worker.pid}`;
}

function createApp(redis) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(allowedOrigin(origin) ? 204 : 403);
    next();
  });
  app.get('/health', async (_req, res) => {
    try { await redis.ping(); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
  });
  app.post('/project', async (req, res) => {
    try {
      const repoUrl = validateRepository(req.body?.repoUrl);
      const rootDirectory = validateDirectory(req.body?.rootDirectory, '.');
      const outputDirectory = validateDirectory(req.body?.outputDirectory, 'dist');
      const id = deploymentId();
      let record = await setDeployment(redis, { id, repoUrl, rootDirectory, outputDirectory, status: 'queued', url: previewUrl(id), createdAt: new Date().toISOString() });
      await appendLog(redis, id, 'Deployment queued');
      try {
        const task = await startBuild(record);
        record = await updateDeployment(redis, id, { task });
      } catch (error) {
        await appendLog(redis, id, `Unable to start build: ${error.message}`);
        record = await updateDeployment(redis, id, { status: 'failed', error: error.message });
      }
      res.status(202).json(record);
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.get('/project/:id', async (req, res) => {
    if (!validateId(req.params.id)) return res.status(400).json({ error: 'Invalid deployment ID.' });
    try {
      const record = await getDeployment(redis, req.params.id);
      if (!record) return res.status(404).json({ error: 'Deployment not found.' });
      res.json({ ...record, logs: await getLogs(redis, req.params.id) });
    } catch { res.status(503).json({ error: 'Storage unavailable.' }); }
  });
  return app;
}

async function main() {
  const redis = createRedis();
  const subscriber = createRedis();
  await redis.ping();
  const app = createApp(redis);
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: (origin, callback) => callback(null, allowedOrigin(origin)), methods: ['GET'] } });
  io.on('connection', (socket) => {
    socket.on('subscribe', async (id) => {
      if (!validateId(id)) return;
      socket.join(id);
      const record = await getDeployment(redis, id);
      if (record) socket.emit('status', record);
      for (const entry of await getLogs(redis, id)) socket.emit('log', entry);
    });
  });
  await subscriber.psubscribe('logs:*', 'status:*');
  subscriber.on('pmessage', (_pattern, channel, message) => {
    const [kind, id] = channel.split(':');
    io.to(id).emit(kind === 'logs' ? 'log' : 'status', JSON.parse(message));
  });
  server.listen(Number(process.env.SOCKET_PORT || 9002), process.env.HOSTMATIC_HOST || '127.0.0.1', () => console.log('Live events listening'));
  app.listen(Number(process.env.API_PORT || 9000), process.env.HOSTMATIC_HOST || '127.0.0.1', () => console.log('API listening'));
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { createApp, startBuild };
