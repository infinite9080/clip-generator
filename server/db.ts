import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import type {
  AppSettings,
  AudioFlagSegment,
  CaptionConfig,
  ClipPreset,
  ClipRecord,
  EditConfig,
  HypeEventRecord,
  MonitoredStream,
  OAuthConnectionSummary,
  UploadJobRecord,
  VideoJobRecord,
} from '../src/types/hypecut.ts';
import { DB_PATH, ensureLocalDirectories } from './storage.ts';

ensureLocalDirectories();

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const DEFAULT_SETTINGS: AppSettings = {
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  outputDir: './storage/clips',
  hypeThreshold: 72,
  cooldownSeconds: 45,
  rollingWindowSeconds: 15,
  baselineWindowSeconds: 90,
  preBufferSeconds: 12,
  postBufferSeconds: 18,
  defaultPreset: 'quick_short',
  quickShortDuration: 30,
  highlightDuration: 165,
  extendedDuration: 300,
  autoGenerateClips: true,
  captionTemplate: 'impact',
  audioNormalize: true,
  autoFlagMusic: true,
  tempRetentionHours: 24,
  demoModeEnabled: true,
};

export function createDefaultCaptionConfig(textSnippet?: string): CaptionConfig {
  return {
    enabled: true,
    template: 'impact',
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 42,
    position: 'bottom',
    textColor: '#FFFFFF',
    highlightColor: '#3B82F6',
    backgroundColor: 'rgba(9, 12, 18, 0.72)',
    animation: 'word-pop',
    cues: [
      {
        id: 'cue-1',
        startSec: 0,
        endSec: 4.5,
        text: textSnippet || 'NO WAY HE ACTUALLY HIT THAT SHOT!',
        highlightWords: ['ACTUALLY', 'SHOT!'],
      },
      {
        id: 'cue-2',
        startSec: 4.5,
        endSec: 9.2,
        text: 'CHAT IS GOING COMPLETELY INSANE RIGHT NOW',
        highlightWords: ['COMPLETELY', 'INSANE'],
      },
      {
        id: 'cue-3',
        startSec: 9.2,
        endSec: 15.0,
        text: 'ONE VERSUS FOUR CLUTCH FOR OVERTIME!',
        highlightWords: ['CLUTCH', 'OVERTIME!'],
      },
    ],
  };
}

export function createDefaultEditConfig(aspectRatio: '9:16' | '16:9' = '9:16'): EditConfig {
  return {
    cropMode: aspectRatio === '9:16' ? 'split_facecam' : 'full_landscape',
    facecamRegion: { x: 0.76, y: 0.68, width: 0.22, height: 0.28 },
    gameplayZoom: 1.08,
    dynamicZoomOnPeak: true,
    removeSilences: true,
    normalizeAudio: true,
    introEnabled: false,
    outroEnabled: false,
    voiceGainDb: 2,
    gameAudioDb: -4,
    licensedTrackName: null,
  };
}

let dbInitialized = false;

export function initializeDatabase(): void {
  if (dbInitialized) return;
  dbInitialized = true;
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_connections (
      provider TEXT PRIMARY KEY,
      account_id TEXT,
      username TEXT,
      display_name TEXT,
      channel_title TEXT,
      avatar_url TEXT,
      access_token TEXT,
      refresh_token TEXT,
      scopes TEXT NOT NULL DEFAULT '[]',
      expires_at TEXT,
      connected_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monitored_streams (
      id TEXT PRIMARY KEY,
      channel_login TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      game_name TEXT NOT NULL,
      stream_title TEXT NOT NULL,
      is_live INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      peak_hype INTEGER NOT NULL DEFAULT 0,
      avg_hype INTEGER NOT NULL DEFAULT 0,
      total_messages INTEGER NOT NULL DEFAULT 0,
      clips_generated INTEGER NOT NULL DEFAULT 0,
      viewer_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      emote_count INTEGER NOT NULL DEFAULT 0,
      is_reaction INTEGER NOT NULL DEFAULT 0,
      matched_reactions TEXT NOT NULL DEFAULT '[]',
      is_demo INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hype_events (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      score INTEGER NOT NULL,
      level TEXT NOT NULL,
      mpm INTEGER NOT NULL,
      mps REAL NOT NULL,
      velocity_pct INTEGER NOT NULL,
      unique_users INTEGER NOT NULL,
      emote_rate REAL NOT NULL,
      repeated_reactions TEXT NOT NULL,
      top_reactions TEXT NOT NULL DEFAULT '[]',
      triggered_clip INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      stream_id TEXT,
      hype_event_id TEXT,
      channel_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      hashtags_json TEXT NOT NULL DEFAULT '[]',
      thumbnail_text TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      metadata_source TEXT NOT NULL DEFAULT 'rule_based',
      preset TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      duration_sec INTEGER NOT NULL,
      start_sec REAL NOT NULL DEFAULT 0,
      end_sec REAL NOT NULL DEFAULT 30,
      hype_score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      source_type TEXT NOT NULL DEFAULT 'demo_sample',
      source_path TEXT,
      output_path TEXT,
      thumbnail_path TEXT,
      has_verified_media INTEGER NOT NULL DEFAULT 0,
      audio_review_status TEXT NOT NULL DEFAULT 'pending',
      audio_flags_json TEXT NOT NULL DEFAULT '[]',
      caption_config_json TEXT NOT NULL,
      edit_config_json TEXT NOT NULL,
      youtube_status TEXT NOT NULL DEFAULT 'not_uploaded',
      is_demo INTEGER NOT NULL DEFAULT 0,
      stream_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS video_jobs (
      id TEXT PRIMARY KEY,
      clip_id TEXT NOT NULL,
      clip_title TEXT NOT NULL,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      logs TEXT NOT NULL DEFAULT '',
      error_message TEXT,
      attempts INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS upload_jobs (
      id TEXT PRIMARY KEY,
      clip_id TEXT NOT NULL,
      youtube_channel_title TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'private',
      is_short INTEGER NOT NULL DEFAULT 1,
      scheduled_at TEXT,
      status TEXT NOT NULL DEFAULT 'awaiting_approval',
      progress INTEGER NOT NULL DEFAULT 0,
      youtube_video_id TEXT,
      youtube_url TEXT,
      error_message TEXT,
      approved_by_user INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
  `);

  const existingSettings = db.prepare('SELECT COUNT(*) as count FROM app_settings').get() as { count: number };
  if (existingSettings.count === 0) {
    saveSettings(DEFAULT_SETTINGS);
  }

  const streamCount = db.prepare('SELECT COUNT(*) as count FROM monitored_streams').get() as { count: number };
  if (streamCount.count === 0) {
    seedDemoData();
  }
}

export function getSettings(): AppSettings {
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[];
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    try {
      merged[row.key] = JSON.parse(row.value);
    } catch {
      merged[row.key] = row.value;
    }
  }
  return merged as unknown as AppSettings;
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const next: AppSettings = { ...current, ...partial };
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  const tx = db.transaction((obj: AppSettings) => {
    for (const [k, v] of Object.entries(obj)) {
      stmt.run(k, JSON.stringify(v), now);
    }
  });
  tx(next);
  return next;
}

export function getOAuthConnection(provider: 'twitch' | 'youtube'): OAuthConnectionSummary {
  const row = db
    .prepare(
      `SELECT provider, account_id, username, display_name, channel_title, avatar_url, scopes, expires_at, connected_at
       FROM oauth_connections WHERE provider = ?`
    )
    .get(provider) as
    | {
        provider: 'twitch' | 'youtube';
        account_id: string | null;
        username: string | null;
        display_name: string | null;
        channel_title: string | null;
        avatar_url: string | null;
        scopes: string;
        expires_at: string | null;
        connected_at: string;
      }
    | undefined;

  const configuredInEnv =
    provider === 'twitch'
      ? Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET)
      : Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);

  const redirectUriPath = provider === 'twitch' ? '/auth/twitch/callback' : '/auth/youtube/callback';

  if (!row) {
    return {
      provider,
      connected: false,
      configuredInEnv,
      accountId: null,
      username: null,
      displayName: null,
      channelTitle: null,
      avatarUrl: null,
      scopes: [],
      expiresAt: null,
      connectedAt: null,
      redirectUriPath,
    };
  }

  let parsedScopes: string[] = [];
  try {
    parsedScopes = JSON.parse(row.scopes) as string[];
  } catch {
    parsedScopes = [];
  }

  return {
    provider,
    connected: true,
    configuredInEnv,
    accountId: row.account_id,
    username: row.username,
    displayName: row.display_name,
    channelTitle: row.channel_title,
    avatarUrl: row.avatar_url,
    scopes: parsedScopes,
    expiresAt: row.expires_at,
    connectedAt: row.connected_at,
    redirectUriPath,
  };
}

export function getOAuthTokens(provider: 'twitch' | 'youtube'): {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  accountId: string | null;
  username: string | null;
  channelTitle: string | null;
} | null {
  const row = db
    .prepare(
      `SELECT access_token, refresh_token, expires_at, account_id, username, channel_title
       FROM oauth_connections WHERE provider = ?`
    )
    .get(provider) as
    | {
        access_token: string;
        refresh_token: string | null;
        expires_at: string | null;
        account_id: string | null;
        username: string | null;
        channel_title: string | null;
      }
    | undefined;
  if (!row || !row.access_token) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    accountId: row.account_id,
    username: row.username,
    channelTitle: row.channel_title,
  };
}

export function saveOAuthConnection(input: {
  provider: 'twitch' | 'youtube';
  accountId: string;
  username: string;
  displayName: string;
  channelTitle: string;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  expiresAt: string | null;
}): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO oauth_connections (
      provider, account_id, username, display_name, channel_title, avatar_url,
      access_token, refresh_token, scopes, expires_at, connected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      account_id = excluded.account_id,
      username = excluded.username,
      display_name = excluded.display_name,
      channel_title = excluded.channel_title,
      avatar_url = excluded.avatar_url,
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, oauth_connections.refresh_token),
      scopes = excluded.scopes,
      expires_at = excluded.expires_at,
      connected_at = excluded.connected_at
  `).run(
    input.provider,
    input.accountId,
    input.username,
    input.displayName,
    input.channelTitle,
    input.avatarUrl,
    input.accessToken,
    input.refreshToken,
    JSON.stringify(input.scopes),
    input.expiresAt,
    now
  );
}

export function deleteOAuthConnection(provider: 'twitch' | 'youtube'): void {
  db.prepare('DELETE FROM oauth_connections WHERE provider = ?').run(provider);
}

interface ClipDbRow {
  id: string;
  stream_id: string | null;
  hype_event_id: string | null;
  channel_name: string;
  title: string;
  description: string;
  hashtags_json: string;
  thumbnail_text: string;
  summary: string;
  metadata_source: 'ollama' | 'rule_based' | 'manual';
  preset: ClipPreset;
  aspect_ratio: '9:16' | '16:9';
  duration_sec: number;
  start_sec: number;
  end_sec: number;
  hype_score: number;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  source_type: 'local_upload' | 'twitch_clip' | 'demo_sample';
  source_path: string | null;
  output_path: string | null;
  thumbnail_path: string | null;
  has_verified_media: number;
  audio_review_status: 'pending' | 'clean' | 'flagged' | 'approved';
  audio_flags_json: string;
  caption_config_json: string;
  edit_config_json: string;
  youtube_status: 'not_uploaded' | 'awaiting_approval' | 'queued' | 'uploading' | 'uploaded' | 'failed';
  is_demo: number;
  stream_date: string;
  created_at: string;
  updated_at: string;
}

export function mapClipRow(row: ClipDbRow): ClipRecord {
  return {
    id: row.id,
    streamId: row.stream_id,
    hypeEventId: row.hype_event_id,
    channelName: row.channel_name,
    title: row.title,
    description: row.description,
    hashtags: safeJsonParse<string[]>(row.hashtags_json, []),
    thumbnailText: row.thumbnail_text,
    summary: row.summary,
    metadataSource: row.metadata_source,
    preset: row.preset,
    aspectRatio: row.aspect_ratio,
    durationSec: row.duration_sec,
    startSec: row.start_sec,
    endSec: row.end_sec,
    hypeScore: row.hype_score,
    status: row.status,
    sourceType: row.source_type,
    sourcePath: row.source_path,
    outputPath: row.output_path,
    thumbnailPath: row.thumbnail_path,
    hasVerifiedMedia: Boolean(row.has_verified_media),
    audioReviewStatus: row.audio_review_status,
    audioFlags: safeJsonParse<AudioFlagSegment[]>(row.audio_flags_json, []),
    captionConfig: safeJsonParse<CaptionConfig>(row.caption_config_json, createDefaultCaptionConfig()),
    editConfig: safeJsonParse<EditConfig>(row.edit_config_json, createDefaultEditConfig(row.aspect_ratio)),
    youtubeStatus: row.youtube_status,
    isDemo: Boolean(row.is_demo),
    streamDate: row.stream_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function listClips(includeDemo = true): ClipRecord[] {
  const rows = (
    includeDemo
      ? db.prepare('SELECT * FROM clips ORDER BY created_at DESC').all()
      : db.prepare('SELECT * FROM clips WHERE is_demo = 0 ORDER BY created_at DESC').all()
  ) as ClipDbRow[];
  return rows.map(mapClipRow);
}

export function getClipById(id: string): ClipRecord | null {
  const row = db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as ClipDbRow | undefined;
  return row ? mapClipRow(row) : null;
}

export function listStreams(includeDemo = true): MonitoredStream[] {
  const rows = (
    includeDemo
      ? db.prepare('SELECT * FROM monitored_streams ORDER BY started_at DESC LIMIT 20').all()
      : db.prepare('SELECT * FROM monitored_streams WHERE is_demo = 0 ORDER BY started_at DESC LIMIT 20').all()
  ) as Array<{
    id: string;
    channel_login: string;
    channel_name: string;
    game_name: string;
    stream_title: string;
    is_live: number;
    is_demo: number;
    started_at: string;
    ended_at: string | null;
    peak_hype: number;
    avg_hype: number;
    total_messages: number;
    clips_generated: number;
    viewer_count: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    channelLogin: r.channel_login,
    channelName: r.channel_name,
    gameName: r.game_name,
    streamTitle: r.stream_title,
    isLive: Boolean(r.is_live),
    isDemo: Boolean(r.is_demo),
    startedAt: r.started_at,
    endedAt: r.ended_at,
    peakHype: r.peak_hype,
    avgHype: r.avg_hype,
    totalMessages: r.total_messages,
    clipsGenerated: r.clips_generated,
    viewerCount: r.viewer_count,
  }));
}

export function listHypeEvents(includeDemo = true, limit = 60): HypeEventRecord[] {
  const rows = (
    includeDemo
      ? db.prepare('SELECT * FROM hype_events ORDER BY timestamp DESC LIMIT ?').all(limit)
      : db.prepare('SELECT * FROM hype_events WHERE is_demo = 0 ORDER BY timestamp DESC LIMIT ?').all(limit)
  ) as Array<{
    id: string;
    stream_id: string;
    channel_name: string;
    score: number;
    level: HypeEventRecord['level'];
    mpm: number;
    mps: number;
    velocity_pct: number;
    unique_users: number;
    emote_rate: number;
    repeated_reactions: string;
    top_reactions: string;
    triggered_clip: number;
    is_demo: number;
    timestamp: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    streamId: r.stream_id,
    channelName: r.channel_name,
    score: r.score,
    level: r.level,
    mpm: r.mpm,
    mps: r.mps,
    velocityPct: r.velocity_pct,
    uniqueUsers: r.unique_users,
    emoteRate: r.emote_rate,
    repeatedReactions: r.repeated_reactions,
    topReactions: safeJsonParse<string[]>(r.top_reactions, []),
    triggeredClip: Boolean(r.triggered_clip),
    isDemo: Boolean(r.is_demo),
    timestamp: r.timestamp,
  }));
}

export function listVideoJobs(limit = 30): VideoJobRecord[] {
  const rows = db.prepare('SELECT * FROM video_jobs ORDER BY created_at DESC LIMIT ?').all(limit) as Array<{
    id: string;
    clip_id: string;
    clip_title: string;
    job_type: 'render' | 'audio_scan' | 'thumbnail';
    status: 'queued' | 'running' | 'completed' | 'failed';
    progress: number;
    logs: string;
    error_message: string | null;
    attempts: number;
    created_at: string;
    completed_at: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    clipId: r.clip_id,
    clipTitle: r.clip_title,
    jobType: r.job_type,
    status: r.status,
    progress: r.progress,
    logs: r.logs,
    errorMessage: r.error_message,
    attempts: r.attempts,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  }));
}

export function listUploadJobs(includeDemo = true): UploadJobRecord[] {
  const rows = (
    includeDemo
      ? db
          .prepare(
            `SELECT u.*, c.title as orig_clip_title, c.preset as clip_preset, c.duration_sec as clip_duration_sec,
                    c.aspect_ratio as clip_aspect_ratio, c.audio_review_status as clip_audio_review_status,
                    c.has_verified_media as clip_has_verified_media
             FROM upload_jobs u
             LEFT JOIN clips c ON c.id = u.clip_id
             ORDER BY u.created_at DESC`
          )
          .all()
      : db
          .prepare(
            `SELECT u.*, c.title as orig_clip_title, c.preset as clip_preset, c.duration_sec as clip_duration_sec,
                    c.aspect_ratio as clip_aspect_ratio, c.audio_review_status as clip_audio_review_status,
                    c.has_verified_media as clip_has_verified_media
             FROM upload_jobs u
             LEFT JOIN clips c ON c.id = u.clip_id
             WHERE u.is_demo = 0
             ORDER BY u.created_at DESC`
          )
          .all()
  ) as Array<{
    id: string;
    clip_id: string;
    orig_clip_title: string | null;
    clip_preset: ClipPreset | null;
    clip_duration_sec: number | null;
    clip_aspect_ratio: '9:16' | '16:9' | null;
    clip_audio_review_status: 'pending' | 'clean' | 'flagged' | 'approved' | null;
    clip_has_verified_media: number | null;
    youtube_channel_title: string | null;
    title: string;
    description: string;
    tags_json: string;
    visibility: 'private' | 'unlisted' | 'public';
    is_short: number;
    scheduled_at: string | null;
    status: 'awaiting_approval' | 'queued' | 'uploading' | 'uploaded' | 'failed';
    progress: number;
    youtube_video_id: string | null;
    youtube_url: string | null;
    error_message: string | null;
    approved_by_user: number;
    is_demo: number;
    created_at: string;
    completed_at: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    clipId: r.clip_id,
    clipTitle: r.orig_clip_title || r.title,
    clipPreset: r.clip_preset || 'quick_short',
    clipDurationSec: r.clip_duration_sec ?? 30,
    clipAspectRatio: r.clip_aspect_ratio || '9:16',
    clipAudioReviewStatus: r.clip_audio_review_status || 'pending',
    clipHasVerifiedMedia: Boolean(r.clip_has_verified_media),
    youtubeChannelTitle: r.youtube_channel_title,
    title: r.title,
    description: r.description,
    tags: safeJsonParse<string[]>(r.tags_json, []),
    visibility: r.visibility,
    isShort: Boolean(r.is_short),
    scheduledAt: r.scheduled_at,
    status: r.status,
    progress: r.progress,
    youtubeVideoId: r.youtube_video_id,
    youtubeUrl: r.youtube_url,
    errorMessage: r.error_message,
    approvedByUser: Boolean(r.approved_by_user),
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    completedAt: r.completed_at,
  }));
}

export function clearDemoData(): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM upload_jobs WHERE is_demo = 1').run();
    db.prepare('DELETE FROM clips WHERE is_demo = 1').run();
    db.prepare('DELETE FROM hype_events WHERE is_demo = 1').run();
    db.prepare('DELETE FROM chat_messages WHERE is_demo = 1').run();
    db.prepare('DELETE FROM monitored_streams WHERE is_demo = 1').run();
  });
  tx();
}

export function seedDemoData(): void {
  clearDemoData();
  const now = Date.now();
  const stream1Id = 'demo-stream-arena';
  const stream2Id = 'demo-stream-rpg';

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO monitored_streams (
        id, channel_login, channel_name, game_name, stream_title, is_live, is_demo,
        started_at, ended_at, peak_hype, avg_hype, total_messages, clips_generated, viewer_count
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stream1Id,
      'novastrike_demo',
      'NovaStrike (Demo Channel)',
      'Tactical Arena Championship',
      '[DEMO] Ranked Finals Push — Local Buffer Active',
      1,
      new Date(now - 1000 * 60 * 115).toISOString(),
      null,
      94,
      58,
      14820,
      3,
      4210
    );

    db.prepare(`
      INSERT INTO monitored_streams (
        id, channel_login, channel_name, game_name, stream_title, is_live, is_demo,
        started_at, ended_at, peak_hype, avg_hype, total_messages, clips_generated, viewer_count
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stream2Id,
      'ironspire_demo',
      'IronSpire (Demo Channel)',
      'Ashen Cathedral',
      '[DEMO] No-Hit Boss Marathon — Authorized Local VOD',
      0,
      new Date(now - 1000 * 60 * 60 * 14).toISOString(),
      new Date(now - 1000 * 60 * 60 * 10).toISOString(),
      88,
      46,
      9340,
      1,
      2680
    );

    // Seed realistic rolling hype timeline points over the past 60 minutes (demo)
    const timelineScores = [
      24, 29, 31, 42, 38, 52, 68, 86, 74, 48, 35, 33, 45, 61, 79, 94, 82, 54, 40, 36, 49, 71, 88, 63,
    ];
    const insertHype = db.prepare(`
      INSERT INTO hype_events (
        id, stream_id, channel_name, score, level, mpm, mps, velocity_pct,
        unique_users, emote_rate, repeated_reactions, top_reactions, triggered_clip, is_demo, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    timelineScores.forEach((score, idx) => {
      const ts = new Date(now - (timelineScores.length - idx) * 150_000).toISOString();
      const level =
        score >= 85
          ? 'Extreme'
          : score >= 70
            ? 'Very High'
            : score >= 50
              ? 'High'
              : score >= 30
                ? 'Moderate'
                : 'Normal';
      const mpm = Math.round(110 + score * 7.8);
      const mps = Number((mpm / 60).toFixed(1));
      const velocityPct = Math.round((score - 30) * 3.8);
      const uniqueUsers = Math.round(45 + score * 2.9);
      const emoteRate = Number((0.18 + (score / 100) * 0.65).toFixed(2));
      const repeated = score >= 80 ? 'Extreme' : score >= 60 ? 'High' : score >= 35 ? 'Moderate' : 'Low';
      const triggered = score >= 85 ? 1 : 0;
      const reactions =
        score >= 75 ? ['NO WAY', 'OMG', 'CLUTCH', 'W', 'LFG'] : ['LOL', 'GG', 'NICE', 'W'];

      insertHype.run(
        `demo-hype-${idx + 1}`,
        idx === 22 ? stream2Id : stream1Id,
        idx === 22 ? 'IronSpire (Demo Channel)' : 'NovaStrike (Demo Channel)',
        score,
        level,
        mpm,
        mps,
        velocityPct,
        uniqueUsers,
        emoteRate,
        repeated,
        JSON.stringify(reactions),
        triggered,
        ts
      );
    });

    const insertClip = db.prepare(`
      INSERT INTO clips (
        id, stream_id, hype_event_id, channel_name, title, description, hashtags_json,
        thumbnail_text, summary, metadata_source, preset, aspect_ratio, duration_sec,
        start_sec, end_sec, hype_score, status, source_type, source_path, output_path,
        thumbnail_path, has_verified_media, audio_review_status, audio_flags_json,
        caption_config_json, edit_config_json, youtube_status, is_demo, stream_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `);

    const clip1Flags: AudioFlagSegment[] = [];
    insertClip.run(
      'demo-clip-1',
      stream1Id,
      'demo-hype-16',
      'NovaStrike (Demo Channel)',
      '1v4 Overtime Arena Clutch With 0.4 Seconds Remaining',
      'Simulated demo highlight triggered when chat hit 94/100 hype (+240% velocity). Upload your own local recording in Clips to run real local FFmpeg rendering.',
      JSON.stringify(['#Shorts', '#GamingHighlights', '#TwitchClips', '#Clutch']),
      '0.4s LEFT?!',
      'Rapid 1v4 arena clutch at match point with immediate chat reaction spike (850 msg/min).',
      'rule_based',
      'quick_short',
      '9:16',
      30,
      14,
      44,
      94,
      'ready',
      'demo_sample',
      null,
      null,
      '/src/assets/images/clip_thumb_clutch_1795360387509.jpg',
      0,
      'clean',
      JSON.stringify(clip1Flags),
      JSON.stringify(createDefaultCaptionConfig('NO WAY HE ACTUALLY CLUTCHED THAT!')),
      JSON.stringify(createDefaultEditConfig('9:16')),
      'awaiting_approval',
      new Date(now - 1000 * 60 * 24).toISOString(),
      new Date(now - 1000 * 60 * 22).toISOString(),
      new Date(now - 1000 * 60 * 20).toISOString()
    );

    const clip2Flags: AudioFlagSegment[] = [
      {
        id: 'flag-demo-1',
        startSec: 42,
        endSec: 78,
        confidence: 0.84,
        label: 'Possible background music detected (42s – 78s)',
        action: 'unreviewed',
        notes: 'Harmonic energy persisted behind speech. Review manually, mute segment, or swap with licensed audio before publishing.',
      },
    ];
    insertClip.run(
      'demo-clip-2',
      stream1Id,
      'demo-hype-8',
      'NovaStrike (Demo Channel)',
      'Post-Match Studio Reaction & Instant Replay Breakdown',
      'Demo 2m45s vertical highlight combining two back-to-back hype spikes with studio facecam commentary. Flagged for background music review before upload.',
      JSON.stringify(['#Shorts', '#StreamMoments', '#LiveReaction', '#Esports']),
      'CHAT LOST IT',
      'Combined reaction and instant replay breakdown across two consecutive chat surges.',
      'rule_based',
      'highlight',
      '9:16',
      165,
      120,
      285,
      86,
      'ready',
      'demo_sample',
      null,
      null,
      '/src/assets/images/clip_thumb_reaction_1795360426691.jpg',
      0,
      'flagged',
      JSON.stringify(clip2Flags),
      JSON.stringify(createDefaultCaptionConfig('WAIT REWIND THAT FRAME RIGHT NOW!')),
      JSON.stringify(createDefaultEditConfig('9:16')),
      'not_uploaded',
      new Date(now - 1000 * 60 * 52).toISOString(),
      new Date(now - 1000 * 60 * 48).toISOString(),
      new Date(now - 1000 * 60 * 46).toISOString()
    );

    insertClip.run(
      'demo-clip-3',
      stream1Id,
      'demo-hype-15',
      'NovaStrike (Demo Channel)',
      'Full Final Round Sequence — Extended 5-Minute Tactical Breakdown',
      'Demo 5-minute 16:9 extended highlight formatted for standard YouTube upload (exceeds 3-minute Shorts cap).',
      JSON.stringify(['#Gameplay', '#ExtendedHighlight', '#TacticalFPS', '#Finals']),
      'FULL FINAL ROUND',
      'Complete 5-minute context capture spanning buildup, callouts, and match-winning sequence.',
      'rule_based',
      'extended',
      '16:9',
      300,
      600,
      900,
      82,
      'ready',
      'demo_sample',
      null,
      null,
      '/src/assets/images/stream_preview_fps_1795360386447.jpg',
      0,
      'approved',
      JSON.stringify([]),
      JSON.stringify(createDefaultCaptionConfig('HOLD CROSSFIRE — DO NOT PEEK YET!')),
      JSON.stringify(createDefaultEditConfig('16:9')),
      'not_uploaded',
      new Date(now - 1000 * 60 * 80).toISOString(),
      new Date(now - 1000 * 60 * 75).toISOString(),
      new Date(now - 1000 * 60 * 72).toISOString()
    );

    insertClip.run(
      'demo-clip-4',
      stream2Id,
      'demo-hype-23',
      'IronSpire (Demo Channel)',
      'Final Phase No-Hit Cathedral Boss Defeat at 1 HP',
      'Demo highlight from authorized local VOD buffer. Perfect parry sequence triggered 88/100 hype score.',
      JSON.stringify(['#Shorts', '#BossFight', '#NoHitRun', '#ActionRPG']),
      '1 HP PARRY!',
      'Final-phase boss encounter cleared at 1 HP after three consecutive parries.',
      'rule_based',
      'quick_short',
      '9:16',
      30,
      410,
      440,
      88,
      'ready',
      'demo_sample',
      null,
      null,
      '/src/assets/images/clip_thumb_boss_1795360450573.jpg',
      0,
      'clean',
      JSON.stringify([]),
      JSON.stringify(createDefaultCaptionConfig('THREE PARRIES IN A ROW AT ONE HP!')),
      JSON.stringify(createDefaultEditConfig('9:16')),
      'not_uploaded',
      new Date(now - 1000 * 60 * 60 * 11).toISOString(),
      new Date(now - 1000 * 60 * 60 * 10).toISOString(),
      new Date(now - 1000 * 60 * 60 * 10).toISOString()
    );

    db.prepare(`
      INSERT INTO upload_jobs (
        id, clip_id, youtube_channel_title, title, description, tags_json, visibility,
        is_short, scheduled_at, status, progress, youtube_video_id, youtube_url,
        error_message, approved_by_user, is_demo, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      `demo-upload-${crypto.randomBytes(3).toString('hex')}`,
      'demo-clip-1',
      null,
      '1v4 Overtime Arena Clutch With 0.4 Seconds Remaining #Shorts',
      'Demo upload draft awaiting verified local MP4 render and YouTube OAuth connection. Default visibility is Private until manually approved.',
      JSON.stringify(['Shorts', 'TwitchHighlights', 'Clutch', 'Gaming']),
      'private',
      1,
      null,
      'awaiting_approval',
      0,
      null,
      null,
      null,
      0,
      new Date(now - 1000 * 60 * 18).toISOString(),
      null
    );
  });

  tx();
}

initializeDatabase();

