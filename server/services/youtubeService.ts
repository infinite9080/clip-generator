import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  db,
  getClipById,
  getOAuthTokens,
  saveOAuthConnection,
} from '../db.ts';
import { appendLog, CLIPS_DIR, isPathInsideDir, RECORDINGS_DIR } from '../storage.ts';

const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

const pendingYoutubeStates = new Map<string, number>();

export function buildYouTubeAuthUrl(baseUrl: string): { url: string; redirectUri: string } {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId || !process.env.YOUTUBE_CLIENT_SECRET) {
    throw new Error('YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are not configured in environment variables.');
  }

  const redirectUri = `${baseUrl.replace(/\/$/, '')}/auth/youtube/callback`;
  const state = crypto.randomBytes(24).toString('hex');
  pendingYoutubeStates.set(state, Date.now() + 10 * 60 * 1000);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    redirectUri,
  };
}

export async function handleYouTubeCallback(code: string, state: string, baseUrl: string): Promise<void> {
  const expiry = pendingYoutubeStates.get(state);
  if (!expiry || expiry < Date.now()) {
    throw new Error('Invalid or expired YouTube OAuth state parameter.');
  }
  pendingYoutubeStates.delete(state);

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('YouTube OAuth credentials are missing on the server.');
  }

  const redirectUri = `${baseUrl.replace(/\/$/, '')}/auth/youtube/callback`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    throw new Error(`Google token exchange failed (${tokenRes.status}): ${txt}`);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  const chanRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
    {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    }
  );

  if (!chanRes.ok) {
    throw new Error(`Failed to fetch YouTube channel details (HTTP ${chanRes.status}).`);
  }

  const chanData = (await chanRes.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        customUrl?: string;
        thumbnails?: { default?: { url?: string } };
      };
    }>;
  };
  const channel = chanData.items?.[0];
  if (!channel) {
    throw new Error('No YouTube channel found on the authenticated Google account.');
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;

  saveOAuthConnection({
    provider: 'youtube',
    accountId: channel.id,
    username: channel.snippet?.customUrl || channel.id,
    displayName: channel.snippet?.title || 'YouTube Channel',
    channelTitle: channel.snippet?.title || 'YouTube Channel',
    avatarUrl: channel.snippet?.thumbnails?.default?.url || null,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    scopes: tokenData.scope ? tokenData.scope.split(' ') : YOUTUBE_SCOPES,
    expiresAt,
  });

  appendLog('INFO', 'youtube', `Connected YouTube channel: ${channel.snippet?.title}`);
}

async function refreshYouTubeAccessToken(): Promise<string> {
  const tokens = getOAuthTokens('youtube');
  if (!tokens) {
    throw new Error('YouTube channel is not connected. Connect via Google OAuth in YouTube Channels first.');
  }

  const expiresMs = tokens.expiresAt ? new Date(tokens.expiresAt).getTime() : Infinity;
  if (expiresMs - Date.now() > 120_000) {
    return tokens.accessToken;
  }

  if (!tokens.refreshToken || !process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    return tokens.accessToken;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID,
      client_secret: process.env.YOUTUBE_CLIENT_SECRET,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to refresh YouTube OAuth token (HTTP ${res.status}). Reconnect your channel.`);
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  saveOAuthConnection({
    provider: 'youtube',
    accountId: tokens.accountId || '',
    username: tokens.username || '',
    displayName: tokens.channelTitle || 'YouTube Channel',
    channelTitle: tokens.channelTitle || 'YouTube Channel',
    avatarUrl: null,
    accessToken: data.access_token,
    refreshToken: tokens.refreshToken,
    scopes: YOUTUBE_SCOPES,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  });

  return data.access_token;
}

export async function executeResumableYouTubeUpload(uploadJobId: string): Promise<void> {
  const job = db.prepare('SELECT * FROM upload_jobs WHERE id = ?').get(uploadJobId) as
    | {
        id: string;
        clip_id: string;
        title: string;
        description: string;
        tags_json: string;
        visibility: 'private' | 'unlisted' | 'public';
        is_short: number;
        scheduled_at: string | null;
        approved_by_user: number;
      }
    | undefined;

  if (!job) throw new Error('Upload job not found.');

  if (!job.approved_by_user) {
    throw new Error('Manual user approval is required before uploading to YouTube.');
  }

  const clip = getClipById(job.clip_id);
  if (!clip) throw new Error('Associated clip record not found.');

  // Block unresolved audio/copyright warnings
  if (clip.audioReviewStatus === 'flagged') {
    throw new Error(
      'Upload blocked: this clip has unresolved background music / audio warnings. Review and approve audio in the Video Editor first.'
    );
  }

  // Verify real local video file exists on disk
  const videoFile = clip.outputPath || clip.sourcePath;
  if (!videoFile || !fs.existsSync(videoFile)) {
    throw new Error(
      'Upload blocked: no verified local MP4 file exists for this clip. Upload an authorized recording and render it with FFmpeg first.'
    );
  }

  if (!isPathInsideDir(videoFile, CLIPS_DIR) && !isPathInsideDir(videoFile, RECORDINGS_DIR)) {
    throw new Error('Upload blocked: video file outside authorized local storage.');
  }

  const accessToken = await refreshYouTubeAccessToken();
  const fileBuffer = fs.readFileSync(videoFile);
  const fileSize = fileBuffer.byteLength;

  db.prepare('UPDATE upload_jobs SET status = ?, progress = ?, error_message = NULL WHERE id = ?').run(
    'uploading',
    15,
    uploadJobId
  );
  db.prepare('UPDATE clips SET youtube_status = ? WHERE id = ?').run('uploading', clip.id);

  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(job.tags_json) as string[];
  } catch {
    parsedTags = [];
  }

  // Enforce YouTube Shorts rule: vertical/square up to 3 minutes (180s) -> Shorts; 5-minute -> standard video
  const eligibleShort = clip.aspectRatio === '9:16' && clip.durationSec <= 180;
  const finalDescription =
    eligibleShort && !job.description.includes('#Shorts')
      ? `${job.description}\n\n#Shorts`
      : job.description;

  const metadataBody = {
    snippet: {
      title: job.title.slice(0, 100),
      description: finalDescription.slice(0, 4900),
      tags: parsedTags.map((t) => t.replace(/^#/, '')).slice(0, 15),
      categoryId: '20', // Gaming
    },
    status: {
      privacyStatus: job.scheduled_at ? 'private' : job.visibility,
      ...(job.scheduled_at ? { publishAt: job.scheduled_at } : {}),
      selfDeclaredMadeForKids: false,
    },
  };

  // Step 1: Initiate YouTube Data API v3 Resumable Upload session
  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(fileSize),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(metadataBody),
    }
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    throw new Error(`YouTube resumable session init failed (HTTP ${initRes.status}): ${errText}`);
  }

  const uploadLocation = initRes.headers.get('location');
  if (!uploadLocation) {
    throw new Error('YouTube did not return a resumable upload Location header.');
  }

  db.prepare('UPDATE upload_jobs SET progress = ? WHERE id = ?').run(45, uploadJobId);

  // Step 2: Upload MP4 payload to resumable session URL
  const uploadRes = await fetch(uploadLocation, {
    method: 'PUT',
    headers: {
      'Content-Length': String(fileSize),
      'Content-Type': 'video/mp4',
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`YouTube binary upload failed (HTTP ${uploadRes.status}): ${errText}`);
  }

  const result = (await uploadRes.json()) as { id?: string };
  if (!result.id) {
    throw new Error('YouTube upload completed without returning a video ID.');
  }

  const youtubeUrl = eligibleShort
    ? `https://www.youtube.com/shorts/${result.id}`
    : `https://www.youtube.com/watch?v=${result.id}`;

  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE upload_jobs
     SET status = 'uploaded', progress = 100, youtube_video_id = ?, youtube_url = ?, completed_at = ?
     WHERE id = ?`
  ).run(result.id, youtubeUrl, nowIso, uploadJobId);

  db.prepare('UPDATE clips SET youtube_status = ?, updated_at = ? WHERE id = ?').run(
    'uploaded',
    nowIso,
    clip.id
  );

  appendLog('INFO', 'youtube', `Uploaded clip ${clip.id} to YouTube (${youtubeUrl})`);
}
