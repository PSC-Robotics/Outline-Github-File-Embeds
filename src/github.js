const path = require('path');
const { App, Octokit } = require('octokit');

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
    if (u.hostname === 'raw.githubusercontent.com') {
      const [, owner, repo, ref, ...rest] = u.pathname.split('/');
      if (!owner || !repo || !ref || rest.length === 0) return null;
      return { owner, repo, ref, filePath: decodeURIComponent(rest.join('/')), type: 'raw' };
    }
    if (u.hostname === 'github.com') {
      const [, owner, repo, view, ref, ...rest] = u.pathname.split('/');
      if (!owner || !repo || !view || !ref || rest.length === 0) return null;
      if (view !== 'blob' && view !== 'raw') return null;
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

  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref,
    });

    const data = response.data;
    if (Array.isArray(data) || data.type !== 'file') {
      throw new Error('URL points to a directory, not a file');
    }
    if (!data.content) {
      throw new Error('GitHub returned no content');
    }

    const buffer = Buffer.from(data.content, 'base64');
    return {
      data: buffer,
      mimeType: getMimeType(filePath),
      size: data.size,
      sha: data.sha,
      name: data.name,
    };
  } catch (err) {
    if (err.status === 404) throw new Error(`File not found: ${owner}/${repo}@${ref}:${filePath}`);
    if (err.status === 401) throw new Error('GitHub authentication is invalid or expired');
    if (err.status === 403) throw new Error('GitHub app lacks permission to access this repo');
    throw err;
  }
}

module.exports = { parseGitHubUrl, fetchFile, getMimeType };
