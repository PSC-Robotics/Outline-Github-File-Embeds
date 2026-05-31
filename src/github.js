const path = require('path');
const { App, Octokit } = require('octokit');
const fetch = require('node-fetch');

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

function parseGitHubUrl(url) {
  try {
    const u = new URL(url);
    const allowedOrg = process.env.ALLOWED_ORG || 'PSC-Robotics';
    
    if (u.hostname === 'raw.githubusercontent.com') {
      const [, owner, repo, ref, ...rest] = u.pathname.split('/');
      if (!owner || !repo || !ref || rest.length === 0) return null;
      if (allowedOrg && owner.toLowerCase() !== allowedOrg.toLowerCase()) return null;
      return { owner, repo, ref, filePath: decodeURIComponent(rest.join('/')), type: 'raw' };
    }
    if (u.hostname === 'github.com') {
      const [, owner, repo, view, ref, ...rest] = u.pathname.split('/');
      if (!owner || !repo || !view || !ref || rest.length === 0) return null;
      if (view !== 'blob' && view !== 'raw') return null;
      if (allowedOrg && owner.toLowerCase() !== allowedOrg.toLowerCase()) return null;
      return { owner, repo, ref, filePath: decodeURIComponent(rest.join('/')), type: view };
    }
    return null;
  } catch {
    return null;
  }
}

// Global cached octokit instance
let cachedOctokit = null;

async function getOctokitClient() {
  if (cachedOctokit) return cachedOctokit;

  // Method 1: GitHub App (Preferred for Organizations)
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

  if (appId && privateKey && installationId) {
    const app = new App({
      appId,
      privateKey: privateKey.replace(/\\n/g, '\n'), // handle newlines in env vars
    });
    cachedOctokit = await app.getInstallationOctokit(installationId);
    return cachedOctokit;
  }

  // Method 2: Fallback to Personal Access Token / Service Account
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    cachedOctokit = new Octokit({ auth: token });
    return cachedOctokit;
  }

  throw new Error('No GitHub authentication configured. Set GITHUB_APP_ID/KEY/INSTALLATION_ID or GITHUB_TOKEN.');
}

async function fetchFile({ owner, repo, ref, filePath }) {
  const octokit = await getOctokitClient();
  const authInfo = await octokit.auth({ type: 'installation' });
  const token = authInfo.token;

  // The GitHub API expects paths to be strictly URI encoded
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${ref}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'outline-github-integration'
    }
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error(`File not found on branch ${ref}: ${filePath}`);
    if (response.status === 403) throw new Error(`Forbidden (might be file size limit > 1MB): ${await response.text()}`);
    throw new Error(`GitHub API HTTP ${response.status}`);
  }

  const data = await response.json();

  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error('URL points to a directory, not a file');
  }

  let buffer;
  if (data.content) {
    buffer = Buffer.from(data.content, 'base64');
  } else if (data.download_url) {
    // For files > 1MB, GitHub omits 'content' and provides a download_url
    const dlRes = await fetch(data.download_url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!dlRes.ok) throw new Error(`Failed to download large file: ${dlRes.status}`);
    buffer = Buffer.from(await dlRes.arrayBuffer());
  } else {
    throw new Error('GitHub returned no content and no download_url');
  }

  return {
    data: buffer,
    mimeType: getMimeType(filePath),
    size: data.size,
    sha: data.sha,
    name: data.name,
  };
}

module.exports = { parseGitHubUrl, fetchFile, getMimeType };
