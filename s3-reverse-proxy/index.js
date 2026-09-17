const { Readable } = require('node:stream');
const express = require('express');
const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { createRedis, getDeployment } = require('../lib/state');
const { validateId } = require('../lib/shared');

function createS3() {
  return new S3Client({ region: process.env.AWS_REGION || 'us-east-1', endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' });
}

function createApp(redis, s3) {
  const app = express();
  app.disable('x-powered-by');
  app.get('*', async (req, res) => {
    const domain = process.env.PREVIEW_DOMAIN || 'localhost';
    const hostname = (req.headers.host || '').split(':')[0].toLowerCase();
    const suffix = `.${domain}`;
    const id = hostname.endsWith(suffix) ? hostname.slice(0, -suffix.length) : '';
    if (!validateId(id)) return res.status(404).send('Preview not found');
    try {
      const record = await getDeployment(redis, id);
      if (!record || record.status !== 'deployed') return res.status(404).send('Preview is not ready');
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.originalUrl, 'http://localhost').pathname); }
      catch { return res.status(400).send('Invalid path'); }
      const parts = pathname.split('/').filter(Boolean);
      if (parts.some((part) => part === '.' || part === '..' || part.includes('\\'))) return res.status(400).send('Invalid path');
      const key = parts.length ? parts.join('/') : 'index.html';
      let asset;
      try { asset = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: `sites/${id}/${key}` })); }
      catch (error) {
        if (!['NoSuchKey', 'NotFound'].includes(error.name) || key.includes('.')) throw error;
        asset = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: `sites/${id}/index.html` }));
      }
      res.setHeader('Content-Type', asset.ContentType || 'application/octet-stream');
      if (asset.CacheControl) res.setHeader('Cache-Control', asset.CacheControl);
      if (asset.ContentLength) res.setHeader('Content-Length', asset.ContentLength);
      const body = asset.Body instanceof Readable ? asset.Body : Readable.fromWeb(asset.Body.transformToWebStream());
      body.on('error', () => { if (!res.headersSent) res.status(502); res.end(); });
      body.pipe(res);
    } catch (error) {
      if (['NoSuchKey', 'NotFound'].includes(error.name)) return res.status(404).send('File not found');
      console.error(error);
      if (!res.headersSent) res.status(502).send('Preview storage unavailable');
    }
  });
  return app;
}

async function main() {
  if (!process.env.S3_BUCKET) throw new Error('S3_BUCKET is required.');
  const redis = createRedis();
  await redis.ping();
  const app = createApp(redis, createS3());
  app.listen(Number(process.env.PREVIEW_PORT || 8000), process.env.HOSTMATIC_HOST || '127.0.0.1', () => console.log('Preview server listening'));
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { createApp };
