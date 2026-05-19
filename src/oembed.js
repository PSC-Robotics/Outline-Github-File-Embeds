const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3456';

const IMAGE_TYPES = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const TEXT_TYPES  = ['text/plain; charset=utf-8', 'text/markdown', 'text/csv', 'application/json'];

/**
 * Build an oEmbed response for a GitHub file.
 * https://oembed.com/
 *
 * Outline uses oEmbed to decide how to render pasted links.
 * We return "rich" type with an HTML snippet that Outline embeds.
 */
function build(originalUrl, parsed, content, baseUrl) {
  const { owner, repo, ref, filePath } = parsed;
  const fileName = path.basename(filePath);
  const proxyUrl = `${baseUrl}/content?url=${encodeURIComponent(originalUrl)}`;

  let html;

  // ── Images & SVGs ──────────────────────────────────────────────────────────
  if (IMAGE_TYPES.includes(content.mimeType)) {
    html = `
<div style="
  background:#1a1a2e;
  border:1px solid #2d2d4e;
  border-radius:8px;
  padding:12px;
  font-family:system-ui,sans-serif;
  max-width:100%;
">
  <div style="
    font-size:11px;
    color:#8b8ba7;
    margin-bottom:8px;
    display:flex;
    align-items:center;
    gap:6px;
  ">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
    </svg>
    ${owner}/${repo} · ${ref} · ${filePath}
  </div>
  <img
    src="${proxyUrl}"
    alt="${fileName}"
    style="max-width:100%;border-radius:4px;display:block;"
    loading="lazy"
  />
</div>`.trim();
  }

  // ── Text / Code / Markdown ─────────────────────────────────────────────────
  else if (TEXT_TYPES.includes(content.mimeType) || content.mimeType === 'text/plain; charset=utf-8') {
    const text = content.data.toString('utf-8');
    const ext  = path.extname(filePath).slice(1) || 'text';
    const lines = text.split('\n').length;
    // Escape HTML entities for display
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    html = `
<div style="
  background:#0d1117;
  border:1px solid #30363d;
  border-radius:8px;
  font-family:system-ui,sans-serif;
  overflow:hidden;
  max-width:100%;
">
  <div style="
    background:#161b22;
    padding:8px 14px;
    font-size:12px;
    color:#8b949e;
    display:flex;
    justify-content:space-between;
    align-items:center;
    border-bottom:1px solid #30363d;
  ">
    <span style="display:flex;align-items:center;gap:6px;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="color:#8b949e;">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
      </svg>
      ${owner}/${repo}
    </span>
    <span>${filePath} · ${lines} lines</span>
  </div>
  <pre style="
    margin:0;
    padding:14px;
    overflow-x:auto;
    font-size:12px;
    line-height:1.6;
    color:#e6edf3;
    max-height:400px;
    overflow-y:auto;
    background:#0d1117;
  "><code class="language-${ext}">${escaped}</code></pre>
</div>`.trim();
  }

  // ── Generic file (PDF, etc.) ───────────────────────────────────────────────
  else {
    html = `
<div style="
  background:#161b22;
  border:1px solid #30363d;
  border-radius:8px;
  padding:14px 16px;
  font-family:system-ui,sans-serif;
  display:flex;
  align-items:center;
  gap:12px;
">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
  <div>
    <div style="color:#e6edf3;font-size:14px;font-weight:500;">${fileName}</div>
    <div style="color:#8b949e;font-size:12px;margin-top:2px;">
      ${owner}/${repo} · ${(content.size / 1024).toFixed(1)} KB
      · <a href="${originalUrl}" target="_blank" style="color:#58a6ff;">View on GitHub</a>
    </div>
  </div>
</div>`.trim();
  }

  return {
    version: '1.0',
    type: 'rich',
    provider_name: 'GitHub (Private)',
    provider_url: `https://github.com/${owner}`,
    title: `${fileName} — ${owner}/${repo}`,
    html,
    width: 800,
    height: null,
  };
}

module.exports = { build };
