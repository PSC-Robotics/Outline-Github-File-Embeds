require('dotenv').config();
const express = require('express');
const github = require('./github');
const oembed = require('./oembed');
const cache = require('./cache');

const app = express();
const PORT = process.env.PORT || 3456;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ─── Token Management ────────────────────────────────────────────────────────
// Load tokens from environment variables.
// Use a generic GITHUB_TOKEN for all repos, OR specific GITHUB_TOKEN_ORGNAME 
// (e.g., GITHUB_TOKEN_PSC_ROBOTICS=ghp_...)
const tokens = {};
if (process.env.GITHUB_TOKEN) {
  tokens['default'] = process.env.GITHUB_TOKEN;
}
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith('GITHUB_TOKEN_') && key !== 'GITHUB_TOKEN_') {
    // e.g. GITHUB_TOKEN_PSC_ROBOTICS -> psc_robotics -> psc-robotics
    const org = key.replace('GITHUB_TOKEN_', '').toLowerCase().replace(/_/g, '-');
    tokens[org] = value;
  }
}

function getTokenForOrg(org) {
  return tokens[org.toLowerCase()] || tokens['default'];
}

if (Object.keys(tokens).length === 0) {
  console.warn('\n⚠️ WARNING: No GITHUB_TOKEN environment variables found. Integration will fail to fetch private repos.\n');
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
app.get('/health', (req, res) => res.json({ status: 'ok', tokens_loaded: Object.keys(tokens).length }));

// ─── oEmbed Endpoint ─────────────────────────────────────────────────────────
// Outline calls this when a GitHub URL is pasted.
// Returns oEmbed JSON with a rendered preview.
app.get('/oembed', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url parameter required' });

  try {
    const parsed = github.parseGitHubUrl(url);
    if (!parsed) return res.status(400).json({ error: 'Not a recognised GitHub content URL' });

    const token = getTokenForOrg(parsed.owner);
    if (!token) {
      return res.status(401).json({
        error: `No token configured for org "${parsed.owner}". Set GITHUB_TOKEN or GITHUB_TOKEN_${parsed.owner.replace(/-/g, '_').toUpperCase()} in .env`
      });
    }

    const content = await cache.getOrFetch(url, () => github.fetchFile(token, parsed));
    const embed = oembed.build(url, parsed, content, BASE_URL);
    res.json(embed);

  } catch (err) {
    console.error('[oEmbed error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Content Proxy ────────────────────────────────────────────────────────────
// Serves the raw file bytes. Used as the src for <img> tags in oEmbed responses.
app.get('/content', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const parsed = github.parseGitHubUrl(url);
    if (!parsed) return res.status(400).json({ error: 'Not a GitHub URL' });

    const token = getTokenForOrg(parsed.owner);
    if (!token) return res.status(401).json({ error: 'Org token not configured' });

    const content = await cache.getOrFetch(url, () => github.fetchFile(token, parsed));

    res.setHeader('Content-Type', content.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(content.data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ Headless Outline GitHub Integration running at ${BASE_URL}`);
  console.log(`\nTo enable in Outline, add this to your Outline .env:`);
  console.log(`  OEMBED_PROVIDERS=${BASE_URL}/oembed\n`);
});
