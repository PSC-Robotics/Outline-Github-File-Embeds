const fetch = require('node-fetch');
const path = require('path');

const MIME_TYPES = {
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.pdf':  'application/pdf',
  '.txt':  'text/plain; charset=utf-8',
  '.md':   'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.csv':  'text/csv',
  '.py':   'text/plain; charset=utf-8',
  '.js':   'text/plain; charset=utf-8',
  '.ts':   'text/plain; charset=utf-8',
  '.yaml': 'text/plain; charset=utf-8',
  '.yml':  'text/plain; charset=utf-8',
};

function getMimeType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Parse any GitHub URL into its components.
 * Handles:
 *   https://github.com/owner/repo/blob/main/path/to/file.svg
 *   https://github.com/owner/repo/raw/main/path/to/file.svg
 *   https://raw.githubusercontent.com/owner/repo/main/path/to/file.svg
 */
function parseGitHubUrl(url) {
  try {
    const u = new URL(url);

    // raw.githubusercontent.com/owner/repo/ref/path
    if (u.hostname === 'raw.githubusercontent.com') {
      const [, owner, repo, ref, ...rest] = u.pathname.split('/');
      if (!owner || !repo || !ref || rest.length === 0) return null;
      return { owner, repo, ref, filePath: rest.join('/'), type: 'raw' };
    }

    // github.com/owner/repo/blob/ref/path
    // github.com/owner/repo/raw/ref/path
    if (u.hostname === 'github.com') {
      const [, owner, repo, view, ref, ...rest] = u.pathname.split('/');
      if (!owner || !repo || !view || !ref || rest.length === 0) return null;
      if (view !== 'blob' && view !== 'raw') return null;
      return { owner, repo, ref, filePath: rest.join('/'), type: view };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch a file from GitHub using the GitHub Contents API.
 * Returns { data: Buffer, mimeType: string, size: number, sha: string }
 */
async function fetchFile(token, { owner, repo, ref, filePath }) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`;

  const response = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'outline-github-integration/1.0',
    },
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error(`File not found: ${owner}/${repo}@${ref}:${filePath}`);
    if (response.status === 401) throw new Error('GitHub token is invalid or expired');
    if (response.status === 403) throw new Error('GitHub token lacks permission to access this repo');
    throw new Error(`GitHub API error ${response.status}`);
  }

  const json = await response.json();

  if (json.type !== 'file') throw new Error('URL points to a directory, not a file');
  if (!json.content)        throw new Error('GitHub returned no content');

  const data = Buffer.from(json.content, 'base64');
  return {
    data,
    mimeType: getMimeType(filePath),
    size: json.size,
    sha: json.sha,
    name: json.name,
  };
}

/**
 * Test that a token can access an org.
 */
async function testToken(token, org) {
  const response = await fetch(`https://api.github.com/orgs/${org}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'outline-github-integration/1.0',
    },
  });

  if (!response.ok) throw new Error(`Token check failed: ${response.status}`);
  const json = await response.json();
  return { valid: true, org: json.login, name: json.name, repos: json.public_repos };
}

module.exports = { parseGitHubUrl, fetchFile, testToken, getMimeType };
