require('dotenv').config();
const express = require('express');
const github = require('./github');
const oembed = require('./oembed');
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

// ─── CORS: Allow Outline to call our oEmbed endpoint ─────────────────────────
app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url}`);
  const outlineUrl = process.env.OUTLINE_URL || '';
  res.setHeader('Access-Control-Allow-Origin', outlineUrl || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  auth_mode: hasAppAuth ? 'github_app' : 'personal_access_token' 
}));

// ─── Iframely / oEmbed Drop-in Replacement ───────────────────────────────────
// Set Outline's IFRAMELY_URL to this proxy.
// If it's a GitHub URL, we render it. If not, we pass it to the real Iframely.
app.get(['/oembed', '/iframely'], async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  // 1. Try to handle it as a GitHub URL
  const parsed = github.parseGitHubUrl(url);
  if (parsed) {
    try {
      const content = await cache.getOrFetch(url, () => github.fetchFile(parsed));
      const embed = oembed.build(url, parsed, content, BASE_URL);
      return res.json(embed);
    } catch (err) {
      console.error(`[GitHub embed error] ${url} -`, err.message);
      // Fall through to real Iframely on error, just in case
    }
  }

  // 2. Pass through to real Iframely for everything else (YouTube, Twitter, etc)
  try {
    const queryParams = new URLSearchParams(req.query).toString();
    const iframelyRes = await fetch(`https://iframe.ly/api/oembed?${queryParams}`);
    const iframelyData = await iframelyRes.json();
    return res.status(iframelyRes.status).json(iframelyData);
  } catch (err) {
    console.error(`[Iframely proxy error] ${url} -`, err.message);
    return res.status(500).json({ error: 'Failed to fetch from Iframely' });
  }
});

// ─── Content Proxy ────────────────────────────────────────────────────────────
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
  console.log(`\nTo enable in Outline, change your Outline .env to:`);
  console.log(`  IFRAMELY_URL=${BASE_URL}\n`);
});
