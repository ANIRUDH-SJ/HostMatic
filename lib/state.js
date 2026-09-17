const Redis = require('ioredis');

function createRedis() {
  return new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', { maxRetriesPerRequest: 2 });
}

function key(id) { return `deployment:${id}`; }
function logKey(id) { return `logs:${id}`; }

async function getDeployment(redis, id) {
  const raw = await redis.get(key(id));
  return raw ? JSON.parse(raw) : null;
}

async function setDeployment(redis, record) {
  const next = { ...record, updatedAt: new Date().toISOString() };
  await redis.set(key(record.id), JSON.stringify(next));
  await redis.publish(`status:${record.id}`, JSON.stringify(next));
  return next;
}

async function updateDeployment(redis, id, fields) {
  const current = await getDeployment(redis, id);
  if (!current) throw new Error('Deployment not found.');
  return setDeployment(redis, { ...current, ...fields });
}

async function appendLog(redis, id, message) {
  const entry = { message: String(message), timestamp: new Date().toISOString() };
  await redis.rpush(logKey(id), JSON.stringify(entry));
  await redis.ltrim(logKey(id), -500, -1);
  await redis.publish(`logs:${id}`, JSON.stringify(entry));
  return entry;
}

async function getLogs(redis, id) {
  return (await redis.lrange(logKey(id), 0, -1)).map((value) => JSON.parse(value));
}

module.exports = { createRedis, getDeployment, setDeployment, updateDeployment, appendLog, getLogs };
