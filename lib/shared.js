const crypto = require('node:crypto');

const ID_PATTERN = /^[a-f0-9]{12}$/;

function deploymentId() {
  return crypto.randomBytes(6).toString('hex');
}

function validateRepository(value) {
  if (typeof value !== 'string') throw new Error('Enter a public GitHub repository URL.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid GitHub repository URL.'); }
  const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || parts.length !== 2 ||
      !parts.every((part) => /^[a-zA-Z0-9_.-]+$/.test(part))) {
    throw new Error('Use a public repository URL like https://github.com/owner/repository.');
  }
  return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/i, '')}`;
}

function validateDirectory(value, fallback) {
  const input = (value || fallback).trim();
  if (input === '.') return input;
  if (!input || input.startsWith('/') || input.includes('\\') || input.split('/').some((part) => part === '..' || part === '.') ||
      !/^[a-zA-Z0-9_./-]+$/.test(input)) throw new Error('Use a relative project or output directory.');
  return input;
}

function validateId(id) {
  return ID_PATTERN.test(id || '');
}

function previewUrl(id) {
  const protocol = process.env.PREVIEW_PROTOCOL || 'http';
  const domain = process.env.PREVIEW_DOMAIN || 'localhost';
  const port = process.env.PREVIEW_PORT || '8000';
  return `${protocol}://${id}.${domain}${port === '80' || port === '443' ? '' : `:${port}`}/`;
}

module.exports = { deploymentId, validateRepository, validateDirectory, validateId, previewUrl };
