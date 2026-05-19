require('dotenv').config();
const express = require('express');
const github = require('./github');
const cache = require('./cache');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3456;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ─── Startup Check ────────────────────────────────────────────────────────
const hasAppAuth = !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_APP_INSTALLATION_ID);
const hasTokenAuth = !!process.env.GITHUB_TOKEN;

if (!hasAppAuth && !hasTokenAuth) {
  console.error('\n❌ ERROR: No GitHub authentication configured.');
  console.error('Please set either GITHUB_APP_ID/KEY/INSTALLATION_ID (preferred for orgs) OR GITHUB_TOKEN.\n');
  process.exit(1);
}

// ─── CORS ─────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  const outlineUrl = process.env.OUTLINE_URL || '';
  res.setHeader('Access-Control-Allow-Origin', outlineUrl || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Health ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  auth_mode: hasAppAuth ? 'github_app' : 'personal_access_token'
}));

// ─── Iframely-compatible endpoint ─────────────────────────────────────────
// Outline calls: GET ${IFRAMELY_URL}/iframely?url=<encoded>&api_key=<key>
// It expects the Iframely API response format, NOT oEmbed format.
// See: outline/plugins/iframely/server/iframely.ts
app.get('/iframely', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  console.log(`[IFRAMELY] Processing URL: ${url}`);

  // 1. Try to handle it as a GitHub URL
  const parsed = github.parseGitHubUrl(url);
  if (parsed) {
    try {
      const { owner, repo, ref, filePath } = parsed;
      const content = await cache.getOrFetch(url, () => github.fetchFile(parsed));
      const fileName = require('path').basename(filePath);

      // Convert image content to Base64 Data URI
      const base64Data = content.data.toString('base64');
      const thumbnailUrl = `data:${content.mimeType};base64,${base64Data}`;

      // Return the EXACT format Outline's Iframely plugin expects
      const response = {
        url: url,
        meta: {
          title: `${fileName} — ${owner}/${repo}`,
          description: `${filePath} on branch ${ref}`,
          site: 'GitHub'
        },
        links: {
          thumbnail: [{
            href: thumbnailUrl,
            type: content.mimeType,
            rel: ['thumbnail']
          }],
          icon: [{
            href: 'https://github.githubassets.com/favicons/favicon.svg',
            type: 'image/svg+xml',
            rel: ['icon']
          }]
        }
      };

      console.log(`[IFRAMELY] ✅ Returning GitHub file metadata for: ${fileName}`);
      return res.json(response);
    } catch (err) {
      console.error(`[IFRAMELY] GitHub error for ${url}:`, err.message);
      // Fall through to real Iframely
    }
  }

  // 2. Pass through to real Iframely for everything else (YouTube, Twitter, etc)
  console.log(`[IFRAMELY] Proxying to real Iframely: ${url}`);
  try {
    const queryParams = new URLSearchParams(req.query).toString();
    const iframelyRes = await fetch(`https://iframe.ly/api/iframely?${queryParams}`);
    const iframelyData = await iframelyRes.json();
    return res.status(iframelyRes.status).json(iframelyData);
  } catch (err) {
    console.error(`[IFRAMELY] Proxy error for ${url}:`, err.message);
    return res.status(500).json({ error: 'Failed to fetch from Iframely' });
  }
});

// ─── oEmbed endpoint (kept for direct testing / future use) ───────────────
app.get('/oembed', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  const parsed = github.parseGitHubUrl(url);
  if (!parsed) return res.status(404).json({ error: 'Not a GitHub URL' });

  try {
    const content = await cache.getOrFetch(url, () => github.fetchFile(parsed));
    const oembed = require('./oembed');
    const embed = oembed.build(url, parsed, content, BASE_URL);
    return res.json(embed);
  } catch (err) {
    console.error(`[oEmbed error] ${url} -`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Content Proxy ────────────────────────────────────────────────────────
// Serves the raw file bytes (Images, SVGs) for the browser to render inline.
app.get('/content', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const parsed = github.parseGitHubUrl(url);
    if (!parsed) return res.status(400).json({ error: 'Not a GitHub URL' });

    const content = await cache.getOrFetch(url, () => github.fetchFile(parsed));

    res.setHeader('Content-Type', content.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(content.data);

  } catch (err) {
    console.error(`[Content error] ${url} -`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ Headless Outline GitHub Integration running at ${BASE_URL}`);
  console.log(`Auth Mode: ${hasAppAuth ? 'GitHub App (Organization)' : 'Personal Access Token'}`);
  console.log(`\nTo enable in Outline, set IFRAMELY_URL=${BASE_URL}\n`);
});
