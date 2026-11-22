import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Unlink } from 'lucide-react';
import type { OAuthConnectionSummary } from '../types/hypecut';
import { api } from '../lib/api';
import { Button, Panel } from '../components/ui/primitives';

export function ConnectionsView({
  provider,
  connection,
  appBaseUrl,
  onRefreshOAuth,
  onNotify,
}: {
  provider: 'twitch' | 'youtube';
  connection: OAuthConnectionSummary | null;
  appBaseUrl: string;
  onRefreshOAuth: () => Promise<void>;
  onNotify: (msg: string, tone?: 'info' | 'error') => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const isTwitch = provider === 'twitch';
  const title = isTwitch ? 'Twitch OAuth & EventSub' : 'YouTube Data API v3 (Google OAuth)';
  const redirectPath = isTwitch ? '/auth/twitch/callback' : '/auth/youtube/callback';
  const resolvedOrigin =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : appBaseUrl || 'http://localhost:3000';
  const redirectUri = `${resolvedOrigin.replace(/\/$/, '')}${redirectPath}`;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      if (!origin.endsWith('.run.app') && !origin.includes('localhost') && !origin.includes('127.0.0.1')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === provider) {
        void onRefreshOAuth();
        onNotify(`${isTwitch ? 'Twitch' : 'YouTube'} account connected successfully.`);
      } else if (event.data?.type === 'OAUTH_AUTH_ERROR' && event.data?.provider === provider) {
        onNotify(`${isTwitch ? 'Twitch' : 'YouTube'} authorization failed. Check your app credentials.`, 'error');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [provider, isTwitch, onRefreshOAuth, onNotify]);

  const handleConnect = async () => {
    setBusy(true);
    try {
      const { url } = isTwitch ? await api.getTwitchOAuthUrl() : await api.getYouTubeOAuthUrl();
      const popup = window.open(url, `${provider}_oauth_popup`, 'width=600,height=720');
      if (!popup) {
        onNotify('Browser blocked the OAuth popup window. Allow popups for this site and retry.', 'error');
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to start OAuth flow.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      if (isTwitch) {
        await api.disconnectTwitch();
      } else {
        await api.disconnectYouTube();
      }
      await onRefreshOAuth();
      onNotify(`Disconnected ${isTwitch ? 'Twitch' : 'YouTube'} account.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Disconnect failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyUri = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotify('Could not copy to clipboard.', 'error');
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <Panel className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {isTwitch
                ? 'Free official Twitch API connection for EventSub live chat monitoring, stream status checks, and authorized clip creation.'
                : 'Free official YouTube Data API v3 connection for resumable Shorts and standard video uploads (default quota includes 100 uploads/day).'}
            </p>
          </div>
          <span
            className={
              connection?.connected
                ? 'text-xs font-semibold text-emerald-400'
                : 'text-xs font-semibold text-slate-400'
            }
          >
            {connection?.connected ? 'Connected' : 'Not Connected'}
          </span>
        </div>

        {/* Connected Account Summary OR Missing Env Warning */}
        <div className="mt-5 space-y-4">
          {connection?.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-slate-800 bg-[#0B0F17] p-4">
              <div>
                <p className="text-sm font-semibold text-slate-100">
                  {connection.displayName || connection.channelTitle || connection.username}
                </p>
                <p className="mt-0.5 font-mono text-xs text-slate-400">
                  ID: {connection.accountId} · Connected{' '}
                  {connection.connectedAt ? new Date(connection.connectedAt).toLocaleString() : '—'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Scopes: {connection.scopes.join(', ') || 'Default'}
                </p>
              </div>
              <Button variant="destructive" size="sm" onClick={handleDisconnect} disabled={busy}>
                <Unlink className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {!connection?.configuredInEnv ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
                  <p className="font-semibold text-amber-300">Server OAuth Credentials Not Set Yet</p>
                  <p className="mt-1 leading-relaxed">
                    Add{' '}
                    <span className="font-mono text-white">
                      {isTwitch ? 'TWITCH_CLIENT_ID & TWITCH_CLIENT_SECRET' : 'YOUTUBE_CLIENT_ID & YOUTUBE_CLIENT_SECRET'}
                    </span>{' '}
                    to your server <span className="font-mono text-white">.env</span> file (or AI Studio Secrets panel), then restart the server. Secrets stay strictly on the server and are never exposed to the browser.
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={handleConnect}
                  disabled={busy || !connection?.configuredInEnv}
                >
                  <Link2 className="h-4 w-4" />
                  {isTwitch ? 'Connect Twitch Account' : 'Connect YouTube Channel'}
                </Button>
                <a
                  href={isTwitch ? 'https://dev.twitch.tv/console/apps' : 'https://console.cloud.google.com/apis/credentials'}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-700 px-3.5 text-xs font-medium text-slate-200 hover:bg-[#161C28]"
                >
                  {isTwitch ? 'Twitch Developer Console' : 'Google Cloud Credentials'}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          )}
        </div>
      </Panel>

      {/* Redirect URI & Official API Limitations */}
      <Panel className="space-y-4 p-6">
        <h3 className="text-sm font-semibold text-slate-100">OAuth Callback URI Configuration</h3>
        <p className="text-xs text-slate-400">
          Register this exact callback URL in your {isTwitch ? 'Twitch Developer Application' : 'Google Cloud OAuth 2.0 Client'} settings:
        </p>

        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-md border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs text-blue-300">
            {redirectUri}
          </code>
          <Button variant="secondary" size="sm" onClick={handleCopyUri}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <div className="border-t border-slate-800/80 pt-4 text-xs leading-relaxed text-slate-400">
          {isTwitch ? (
            <p>
              <strong className="text-slate-200">Official Twitch Platform Note:</strong> Twitch EventSub delivers real-time chat events and does not provide downloadable video streams. The official Twitch Clips API captures up to 90 seconds (5–60s editable published segment). For 2–3 minute Highlights and 5-minute Extended Highlights, record your own authorized stream locally (e.g. OBS Replay Buffer / local recording) and import it into <span className="font-mono text-slate-200">./storage/recordings/</span>.
            </p>
          ) : (
            <p>
              <strong className="text-slate-200">Official YouTube Upload Rules:</strong> Vertical (9:16) or square videos up to 3 minutes are automatically classified as YouTube Shorts. Five-minute Extended Highlights are uploaded as standard YouTube videos. All uploads default to Private visibility and require manual approval before publishing.
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
