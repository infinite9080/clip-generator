import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { initializeDatabase } from './server/db.ts';
import { createApiRouter } from './server/routes/api.ts';
import { twitchMonitor } from './server/services/twitchService.ts';
import { handleYouTubeCallback } from './server/services/youtubeService.ts';
import { appendLog, ensureLocalDirectories } from './server/storage.ts';

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderOAuthPopupResult(provider: 'twitch' | 'youtube', ok: boolean, message: string): string {
  const safeMsg = escapeHtmlText(message);
  const eventType = ok ? 'OAUTH_AUTH_SUCCESS' : 'OAUTH_AUTH_ERROR';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>HypeCut AI — Authorization</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #090c12; color: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
      .box { max-width: 420px; background: #111620; border: 1px solid rgba(148,163,184,0.2); border-radius: 10px; padding: 24px; }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p { font-size: 14px; color: #94a3b8; margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>${ok ? 'Connection Complete' : 'Authorization Failed'}</h1>
      <p>${safeMsg}</p>
    </div>
    <script>
      (function() {
        var payload = { type: ${JSON.stringify(eventType)}, provider: ${JSON.stringify(provider)} };
        if (window.opener) {
          window.opener.postMessage(payload, '*');
          setTimeout(function() { window.close(); }, ${ok ? 500 : 2800});
        }
      })();
    </script>
  </body>
</html>`;
}

async function startServer(): Promise<void> {
  ensureLocalDirectories();
  initializeDatabase();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));

  const appBaseUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

  // Mount API routes
  app.use('/api', createApiRouter());

  // Official Twitch OAuth callback (handles with and without trailing slash)
  app.get(['/auth/twitch/callback', '/auth/twitch/callback/'], async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const errorDesc = typeof req.query.error_description === 'string' ? req.query.error_description : '';

    if (errorDesc || !code || !state) {
      res
        .status(400)
        .send(renderOAuthPopupResult('twitch', false, errorDesc || 'Missing authorization code from Twitch.'));
      return;
    }

    try {
      await twitchMonitor.handleTwitchCallback(code, state, appBaseUrl);
      res.send(
        renderOAuthPopupResult('twitch', true, 'Your Twitch account is connected. This window will close shortly.')
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Twitch authorization error.';
      appendLog('ERROR', 'oauth-twitch', msg);
      res.status(400).send(renderOAuthPopupResult('twitch', false, msg));
    }
  });

  // Official YouTube / Google OAuth callback (handles with and without trailing slash)
  app.get(['/auth/youtube/callback', '/auth/youtube/callback/'], async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const errorParam = typeof req.query.error === 'string' ? req.query.error : '';

    if (errorParam || !code || !state) {
      res
        .status(400)
        .send(renderOAuthPopupResult('youtube', false, errorParam || 'Missing authorization code from Google.'));
      return;
    }

    try {
      await handleYouTubeCallback(code, state, appBaseUrl);
      res.send(
        renderOAuthPopupResult('youtube', true, 'Your YouTube channel is connected. This window will close shortly.')
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'YouTube authorization error.';
      appendLog('ERROR', 'oauth-youtube', msg);
      res.status(400).send(renderOAuthPopupResult('youtube', false, msg));
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    appendLog('INFO', 'server', `HypeCut AI server listening on http://0.0.0.0:${port}`);
    console.log(`HypeCut AI running on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
