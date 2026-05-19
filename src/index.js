require('dotenv').config();
const express = require('express');
const github = require('./github');
const oembed = require('./oembed');
const cache = require('./cache');

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

// ─── oEmbed Endpoint ─────────────────────────────────────────────────────────
app.get('/oembed', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  try {
    const parsed = github.parseGitHubUrl(url);
    if (!parsed) return res.status(400).json({ error: 'Not a recognised GitHub content URL' });

    const content = await cache.getOrFetch(url, () => github.fetchFile(parsed));
    const embed = oembed.build(url, parsed, content, BASE_URL);
    res.json(embed);

  } catch (err) {
    console.error(`[oEmbed error] ${url} -`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Content Proxy ────────────────────────────────────────────────────────────
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
  console.log(`\nTo enable in Outline, add this to your Outline .env:`);
  console.log(`  OEMBED_PROVIDERS=${BASE_URL}/oembed\n`);
});
