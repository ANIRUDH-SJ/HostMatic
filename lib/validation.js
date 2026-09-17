const SLUG_PATTERN = /^[a-f0-9]{8}$/

function githubRepositoryUrl(value) {
  if (typeof value !== 'string') throw new Error('Enter a public GitHub repository URL.')
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Enter a valid GitHub repository URL.')
  }

  const parts = url.pathname.split('/').filter(Boolean)
  if (
    url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' ||
    url.username || url.password || url.search || url.hash || parts.length !== 2 ||
    !/^[a-zA-Z0-9-]+$/.test(parts[0]) ||
    !/^[a-zA-Z0-9._-]+$/.test(parts[1])
  ) {
    throw new Error('Use a public GitHub URL such as https://github.com/owner/repo.')
  }

  const repository = parts[1].replace(/\.git$/i, '')
  if (!repository || repository === '.' || repository === '..') {
    throw new Error('Enter a valid GitHub repository name.')
  }
  return `https://github.com/${parts[0]}/${repository}.git`
}

function relativeDirectory(value, label) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || value.length > 150) {
    throw new Error(`${label} must be a relative folder inside the repository.`)
  }
  const segments = value.split('/')
  if (segments.some((part) => !part || part === '.' || part === '..' || !/^[a-zA-Z0-9._-]+$/.test(part))) {
    throw new Error(`${label} must be a relative folder inside the repository.`)
  }
  return segments.join('/')
}

module.exports = { SLUG_PATTERN, githubRepositoryUrl, relativeDirectory }
