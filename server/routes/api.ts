import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { DashboardSummary, SystemHealthStatus } from '../../src/types/hypecut.ts';
import {
  clearDemoData,
  createDefaultCaptionConfig,
  createDefaultEditConfig,
  db,
  deleteOAuthConnection,
  getClipById,
  getOAuthConnection,
  getSettings,
  listClips,
  listHypeEvents,
  listStreams,
  listUploadJobs,
  listVideoJobs,
  saveSettings,
  seedDemoData,
} from '../db.ts';
import {
  cleanTempStorage,
  CLIPS_DIR,
  getStorageStats,
  isPathInsideDir,
  RECORDINGS_DIR,
  resolveSafeStoragePath,
  THUMBNAILS_DIR,
} from '../storage.ts';
import { checkFfmpegHealth, generateLocalTestRecording, probeMediaDuration } from '../services/ffmpegService.ts';
import { jobWorker } from '../services/jobWorker.ts';
import { checkOllamaHealth, generateHighlightMetadata } from '../services/ollamaService.ts';
import { twitchMonitor } from '../services/twitchService.ts';
import { buildYouTubeAuthUrl, executeResumableYouTubeUpload } from '../services/youtubeService.ts';

const recordingUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, RECORDINGS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const allowed = new Set(['.mp4', '.mov', '.mkv', '.webm']);
      const safeExt = allowed.has(ext) ? ext : '.mp4';
      cb(null, `rec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${safeExt}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.mp4', '.mov', '.mkv', '.webm'].includes(ext) || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only MP4, MOV, MKV, or WebM video files are accepted.'));
    }
  },
});

const settingsPatchSchema = z.object({
  ollamaBaseUrl: z.string().min(5).max(200).optional(),
  ollamaModel: z.string().min(1).max(120).optional(),
  ffmpegPath: z.string().min(1).max(260).optional(),
  ffprobePath: z.string().min(1).max(260).optional(),
  outputDir: z.string().min(1).max(260).optional(),
  hypeThreshold: z.number().int().min(20).max(99).optional(),
  cooldownSeconds: z.number().int().min(5).max(600).optional(),
  rollingWindowSeconds: z.number().int().min(5).max(120).optional(),
  baselineWindowSeconds: z.number().int().min(30).max(600).optional(),
  preBufferSeconds: z.number().int().min(2).max(120).optional(),
  postBufferSeconds: z.number().int().min(2).max(120).optional(),
  defaultPreset: z.enum(['quick_short', 'highlight', 'extended']).optional(),
  quickShortDuration: z.number().int().min(10).max(60).optional(),
  highlightDuration: z.number().int().min(60).max(180).optional(),
  extendedDuration: z.number().int().min(181).max(600).optional(),
  autoGenerateClips: z.boolean().optional(),
  captionTemplate: z.enum(['impact', 'clean-box', 'karaoke-pop', 'minimal']).optional(),
  audioNormalize: z.boolean().optional(),
  autoFlagMusic: z.boolean().optional(),
  tempRetentionHours: z.number().int().min(1).max(720).optional(),
  demoModeEnabled: z.boolean().optional(),
});

const clipPatchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(4900).optional(),
  hashtags: z.array(z.string().max(40)).max(15).optional(),
  thumbnailText: z.string().max(40).optional(),
  preset: z.enum(['quick_short', 'highlight', 'extended']).optional(),
  aspectRatio: z.enum(['9:16', '16:9']).optional(),
  startSec: z.number().min(0).optional(),
  endSec: z.number().min(1).optional(),
  audioReviewStatus: z.enum(['pending', 'clean', 'flagged', 'approved']).optional(),
  audioFlags: z.array(z.any()).optional(),
  captionConfig: z.any().optional(),
  editConfig: z.any().optional(),
});

const uploadCreateSchema = z.object({
  clipId: z.string().min(1),
  title: z.string().min(1).max(100),
  description: z.string().max(4900),
  tags: z.array(z.string().max(40)).max(15),
  visibility: z.enum(['private', 'unlisted', 'public']).default('private'),
  scheduledAt: z.string().nullable().optional(),
  approvedByUser: z.boolean().default(false),
});

function resolveAppBaseUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  // Dashboard aggregated summary
  router.get('/dashboard', (req, res) => {
    const includeDemo = req.query.includeDemo !== 'false' && getSettings().demoModeEnabled;
    const streams = listStreams(includeDemo);
    const clips = listClips(includeDemo);
    const allClips = listClips(true);
    const hypeEvents = listHypeEvents(includeDemo, 40);
    const jobs = listVideoJobs(15);
    const uploads = listUploadJobs(includeDemo);

    const totalMessages = streams.reduce((acc, s) => acc + s.totalMessages, 0);
    const avgHype =
      hypeEvents.length > 0
        ? Math.round(hypeEvents.reduce((acc, h) => acc + h.score, 0) / hypeEvents.length)
        : 0;

    const liveState = twitchMonitor.getState();
    const activeLiveCount =
      (liveState.isMonitoring && liveState.isLive ? 1 : 0) ||
      streams.filter((s) => s.isLive).length;

    const summary: DashboardSummary = {
      stats: {
        totalStreamsMonitored: streams.length,
        currentLiveStreams: activeLiveCount,
        totalChatMessages: totalMessages,
        averageHypeScore: avgHype,
        totalClipsGenerated: clips.length,
        videosAwaitingReview: clips.filter(
          (c) => c.status === 'ready' && c.youtubeStatus !== 'uploaded'
        ).length,
        videosUploadedToYouTube: uploads.filter((u) => u.status === 'uploaded').length,
        activeProcessingJobs: jobs.filter((j) => j.status === 'queued' || j.status === 'running').length,
      },
      includesDemoData: includeDemo,
      realClipsCount: allClips.filter((c) => !c.isDemo).length,
      demoClipsCount: allClips.filter((c) => c.isDemo).length,
      hypeTimeline: [...hypeEvents].reverse().map((e) => ({
        time: new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        score: e.score,
        mpm: e.mpm,
        velocityPct: e.velocityPct,
        isDemo: e.isDemo,
      })),
      recentStreams: streams.slice(0, 6),
      recentClips: clips.slice(0, 6),
      activeJobs: jobs.slice(0, 8),
      recentUploads: uploads.slice(0, 6),
    };

    res.json(summary);
  });

  // Settings & System Health
  router.get('/settings', (_req, res) => {
    res.json(getSettings());
  });

  router.patch('/settings', (req, res) => {
    const parsed = settingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid settings payload.' });
      return;
    }
    const updated = saveSettings(parsed.data);
    twitchMonitor.syncSettings();
    res.json(updated);
  });

  router.get('/system/health', async (_req, res) => {
    const settings = getSettings();
    const [ffmpeg, ollama] = await Promise.all([
      checkFfmpegHealth(settings.ffmpegPath),
      checkOllamaHealth(settings.ollamaBaseUrl, settings.ollamaModel),
    ]);
    const health: SystemHealthStatus = {
      ffmpeg,
      ollama,
      storage: getStorageStats(),
    };
    res.json(health);
  });

  router.post('/system/cleanup-temp', (_req, res) => {
    const result = cleanTempStorage();
    res.json(result);
  });

  router.post('/system/demo-data/seed', (_req, res) => {
    seedDemoData();
    saveSettings({ demoModeEnabled: true });
    res.json({ ok: true });
  });

  router.post('/system/demo-data/clear', (_req, res) => {
    clearDemoData();
    saveSettings({ demoModeEnabled: false });
    res.json({ ok: true });
  });

  // OAuth status & URL generators
  router.get('/oauth/status', (_req, res) => {
    res.json({
      twitch: getOAuthConnection('twitch'),
      youtube: getOAuthConnection('youtube'),
      appBaseUrl: resolveAppBaseUrl(),
    });
  });

  router.get('/oauth/twitch/url', (_req, res) => {
    try {
      const result = twitchMonitor.buildTwitchAuthUrl(resolveAppBaseUrl());
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Twitch OAuth unavailable.' });
    }
  });

  router.delete('/oauth/twitch', (_req, res) => {
    twitchMonitor.stopMonitoring();
    deleteOAuthConnection('twitch');
    res.json({ ok: true });
  });

  router.get('/oauth/youtube/url', (_req, res) => {
    try {
      const result = buildYouTubeAuthUrl(resolveAppBaseUrl());
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'YouTube OAuth unavailable.' });
    }
  });

  router.delete('/oauth/youtube', (_req, res) => {
    deleteOAuthConnection('youtube');
    res.json({ ok: true });
  });

  // Live Monitor & Real-Time SSE stream
  router.get('/monitor/state', (_req, res) => {
    res.json(twitchMonitor.getState());
  });

  router.get('/monitor/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('state', twitchMonitor.getState());

    const unsubMonitor = twitchMonitor.subscribe((evt) => {
      sendEvent(evt.type, evt.payload);
    });

    const unsubJobs = jobWorker.subscribe((job) => {
      sendEvent('job_update', job);
    });

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 20_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubMonitor();
      unsubJobs();
    });
  });

  router.post('/monitor/start', async (req, res) => {
    const mode =
      req.body?.mode === 'twitch'
        ? 'twitch'
        : req.body?.mode === 'twitch_public'
          ? 'twitch_public'
          : 'demo';
    const channel = typeof req.body?.channel === 'string' ? req.body.channel : 'novastrike_demo';
    try {
      const nextState =
        mode === 'twitch'
          ? await twitchMonitor.startRealTwitchMonitoring(channel)
          : mode === 'twitch_public'
            ? twitchMonitor.startPublicTwitchChatMonitoring(channel)
            : twitchMonitor.startDemoSimulation(channel || 'NovaStrike (Demo Channel)');
      res.json(nextState);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to start monitoring.' });
    }
  });

  router.post('/monitor/stop', (_req, res) => {
    res.json(twitchMonitor.stopMonitoring());
  });

  router.post('/monitor/demo-spike', (_req, res) => {
    twitchMonitor.triggerDemoSpike();
    res.json({ ok: true });
  });

  router.post('/monitor/capture-now', async (_req, res) => {
    try {
      const clipId = await twitchMonitor.recordManualHighlightCandidate();
      res.json({ ok: true, clipId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to capture highlight.' });
    }
  });

  // Hype Analytics
  router.get('/analytics/hype', (req, res) => {
    const includeDemo = req.query.includeDemo !== 'false' && getSettings().demoModeEnabled;
    const events = listHypeEvents(includeDemo, 100);
    const reactionTotals = new Map<string, number>();
    for (const evt of events) {
      for (const token of evt.topReactions) {
        reactionTotals.set(token, (reactionTotals.get(token) ?? 0) + 1);
      }
    }
    const reactionBreakdown = Array.from(reactionTotals.entries())
      .map(([reaction, count]) => ({ reaction, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    res.json({
      events,
      reactionBreakdown,
      settings: getSettings(),
    });
  });

  // Clips Library & Authorized Local Recording Upload
  router.get('/clips', (req, res) => {
    const includeDemo = req.query.includeDemo !== 'false' && getSettings().demoModeEnabled;
    res.json({
      clips: listClips(includeDemo),
      jobs: listVideoJobs(25),
    });
  });

  router.get('/clips/:id', (req, res) => {
    const clip = getClipById(req.params.id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }
    res.json(clip);
  });

  router.post('/recordings/upload', recordingUpload.single('video'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No video file uploaded.' });
        return;
      }

      const settings = getSettings();
      const channelName =
        typeof req.body?.channelName === 'string' && req.body.channelName.trim()
          ? req.body.channelName.trim().slice(0, 60)
          : 'Local Authorized Recording';

      const presetRaw = req.body?.preset;
      const preset: 'quick_short' | 'highlight' | 'extended' =
        presetRaw === 'highlight' || presetRaw === 'extended' ? presetRaw : 'quick_short';
      const aspectRatio: '9:16' | '16:9' = preset === 'extended' ? '16:9' : '9:16';

      const probed = await probeMediaDuration(settings.ffprobePath, req.file.path);
      const totalDur = probed?.durationSec ?? 30;
      const targetCap =
        preset === 'quick_short'
          ? settings.quickShortDuration
          : preset === 'highlight'
            ? settings.highlightDuration
            : settings.extendedDuration;
      const endSec = Math.min(totalDur, targetCap);

      const meta = await generateHighlightMetadata({
        ollamaBaseUrl: settings.ollamaBaseUrl,
        ollamaModel: settings.ollamaModel,
        channelName,
        gameName: 'Authorized Local Video Source',
        hypeScore: 84,
        durationSec: endSec,
        preset,
        topReactions: ['CLUTCH', 'NO WAY', 'W'],
      });

      const clipId = `clip-${crypto.randomBytes(5).toString('hex')}`;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO clips (
          id, stream_id, hype_event_id, channel_name, title, description, hashtags_json,
          thumbnail_text, summary, metadata_source, preset, aspect_ratio, duration_sec,
          start_sec, end_sec, hype_score, status, source_type, source_path, output_path,
          thumbnail_path, has_verified_media, audio_review_status, audio_flags_json,
          caption_config_json, edit_config_json, youtube_status, is_demo, stream_date, created_at, updated_at
        ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 84, 'ready', 'local_upload', ?, NULL, NULL, 1, 'pending', '[]', ?, ?, 'not_uploaded', 0, ?, ?, ?)
      `).run(
        clipId,
        channelName,
        typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim().slice(0, 100) : meta.title,
        meta.description,
        JSON.stringify(meta.hashtags),
        meta.thumbnailText,
        meta.summary,
        meta.source,
        preset,
        aspectRatio,
        endSec,
        endSec,
        req.file.path,
        JSON.stringify(createDefaultCaptionConfig()),
        JSON.stringify(createDefaultEditConfig(aspectRatio)),
        now,
        now,
        now
      );

      if (settings.autoFlagMusic) {
        jobWorker.enqueueAudioScanJob(clipId);
      }

      const created = getClipById(clipId);
      res.status(201).json(created);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Upload processing failed.' });
    }
  });

  router.post('/recordings/generate-test', async (_req, res) => {
    try {
      const settings = getSettings();
      const clipId = `clip-${crypto.randomBytes(5).toString('hex')}`;
      const generated = await generateLocalTestRecording({
        ffmpegPath: settings.ffmpegPath,
        fileName: `test_${clipId}.mp4`,
        durationSec: 12,
      });

      const meta = await generateHighlightMetadata({
        ollamaBaseUrl: settings.ollamaBaseUrl,
        ollamaModel: settings.ollamaModel,
        channelName: 'Local FFmpeg Test Capture',
        gameName: 'Verified Local Pipeline Test',
        hypeScore: 91,
        durationSec: generated.durationSec,
        preset: 'quick_short',
        topReactions: ['NO WAY', 'CLUTCH', 'LFG'],
      });

      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO clips (
          id, stream_id, hype_event_id, channel_name, title, description, hashtags_json,
          thumbnail_text, summary, metadata_source, preset, aspect_ratio, duration_sec,
          start_sec, end_sec, hype_score, status, source_type, source_path, output_path,
          thumbnail_path, has_verified_media, audio_review_status, audio_flags_json,
          caption_config_json, edit_config_json, youtube_status, is_demo, stream_date, created_at, updated_at
        ) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'quick_short', '9:16', ?, 0, ?, 91, 'ready', 'local_upload', ?, NULL, ?, 1, 'pending', '[]', ?, ?, 'not_uploaded', 0, ?, ?, ?)
      `).run(
        clipId,
        'Local FFmpeg Test Capture',
        'Verified Local FFmpeg Test Clip (Ready to Render 9:16)',
        meta.description,
        JSON.stringify(meta.hashtags),
        'TEST RENDER',
        'Real 12-second 720p MP4 generated locally via FFmpeg so you can immediately test vertical cropping, burned captions, audio scanning, and export.',
        meta.source,
        generated.durationSec,
        generated.durationSec,
        generated.filePath,
        generated.thumbnailPath,
        JSON.stringify(createDefaultCaptionConfig('NO WAY THIS LOCAL RENDER WORKS!')),
        JSON.stringify(createDefaultEditConfig('9:16')),
        now,
        now,
        now
      );

      jobWorker.enqueueAudioScanJob(clipId);
      res.status(201).json(getClipById(clipId));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate local test MP4.' });
    }
  });

  router.patch('/clips/:id', (req, res) => {
    const existing = getClipById(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }

    const parsed = clipPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid clip update.' });
      return;
    }

    const d = parsed.data;
    const startSec = d.startSec ?? existing.startSec;
    const endSec = Math.max(startSec + 2, d.endSec ?? existing.endSec);
    const durationSec = Math.round(endSec - startSec);
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE clips SET
        title = ?,
        description = ?,
        hashtags_json = ?,
        thumbnail_text = ?,
        preset = ?,
        aspect_ratio = ?,
        start_sec = ?,
        end_sec = ?,
        duration_sec = ?,
        audio_review_status = ?,
        audio_flags_json = ?,
        caption_config_json = ?,
        edit_config_json = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      d.title ?? existing.title,
      d.description ?? existing.description,
      JSON.stringify(d.hashtags ?? existing.hashtags),
      d.thumbnailText ?? existing.thumbnailText,
      d.preset ?? existing.preset,
      d.aspectRatio ?? existing.aspectRatio,
      startSec,
      endSec,
      durationSec,
      d.audioReviewStatus ?? existing.audioReviewStatus,
      JSON.stringify(d.audioFlags ?? existing.audioFlags),
      JSON.stringify(d.captionConfig ?? existing.captionConfig),
      JSON.stringify(d.editConfig ?? existing.editConfig),
      now,
      existing.id
    );

    res.json(getClipById(existing.id));
  });

  router.delete('/clips/:id', (req, res) => {
    const clip = getClipById(req.params.id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }

    // Safely remove local rendered file if confined to CLIPS_DIR
    if (clip.outputPath && isPathInsideDir(clip.outputPath, CLIPS_DIR) && fs.existsSync(clip.outputPath)) {
      try {
        fs.unlinkSync(clip.outputPath);
      } catch {
        // Ignore cleanup failure
      }
    }

    db.prepare('DELETE FROM upload_jobs WHERE clip_id = ?').run(clip.id);
    db.prepare('DELETE FROM video_jobs WHERE clip_id = ?').run(clip.id);
    db.prepare('DELETE FROM clips WHERE id = ?').run(clip.id);
    res.json({ ok: true });
  });

  router.post('/clips/:id/regenerate-metadata', async (req, res) => {
    const clip = getClipById(req.params.id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }

    const settings = getSettings();
    const meta = await generateHighlightMetadata({
      ollamaBaseUrl: settings.ollamaBaseUrl,
      ollamaModel: settings.ollamaModel,
      channelName: clip.channelName,
      hypeScore: clip.hypeScore,
      durationSec: clip.durationSec,
      preset: clip.preset,
      topReactions: ['NO WAY', 'CLUTCH', 'OMG'],
    });

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE clips
      SET title = ?, description = ?, hashtags_json = ?, thumbnail_text = ?,
          summary = ?, metadata_source = ?, updated_at = ?
      WHERE id = ?
    `).run(
      meta.title,
      meta.description,
      JSON.stringify(meta.hashtags),
      meta.thumbnailText,
      meta.summary,
      meta.source,
      now,
      clip.id
    );

    res.json({ clip: getClipById(clip.id), metadata: meta });
  });

  router.post('/clips/:id/render', (req, res) => {
    try {
      const jobId = jobWorker.enqueueRenderJob(req.params.id);
      res.status(202).json({ ok: true, jobId });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to start render job.' });
    }
  });

  router.post('/clips/:id/scan-audio', (req, res) => {
    try {
      const jobId = jobWorker.enqueueAudioScanJob(req.params.id);
      res.status(202).json({ ok: true, jobId });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Unable to start audio scan.' });
    }
  });

  // Safe local media streaming & downloads
  router.get('/media/clips/:id/video', (req, res) => {
    const clip = getClipById(req.params.id);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }
    const target = clip.outputPath || clip.sourcePath;
    if (!target || !fs.existsSync(target)) {
      res.status(404).json({ error: 'No verified local MP4 file exists for this clip.' });
      return;
    }
    if (!isPathInsideDir(target, CLIPS_DIR) && !isPathInsideDir(target, RECORDINGS_DIR)) {
      res.status(403).json({ error: 'Forbidden media path.' });
      return;
    }
    if (req.query.download === '1') {
      res.download(target, `${clip.id}.mp4`);
      return;
    }
    res.sendFile(target);
  });

  router.get('/media/thumbnails/:fileName', (req, res) => {
    try {
      const fullPath = resolveSafeStoragePath(THUMBNAILS_DIR, req.params.fileName);
      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: 'Thumbnail not found.' });
        return;
      }
      res.sendFile(fullPath);
    } catch {
      res.status(400).json({ error: 'Invalid thumbnail path.' });
    }
  });

  // YouTube Upload Queue & Publishing
  router.get('/uploads', (req, res) => {
    const includeDemo = req.query.includeDemo !== 'false' && getSettings().demoModeEnabled;
    res.json({
      uploads: listUploadJobs(includeDemo),
      youtubeConnection: getOAuthConnection('youtube'),
    });
  });

  router.post('/uploads', (req, res) => {
    const parsed = uploadCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid upload payload.' });
      return;
    }
    const clip = getClipById(parsed.data.clipId);
    if (!clip) {
      res.status(404).json({ error: 'Clip not found.' });
      return;
    }

    const yt = getOAuthConnection('youtube');
    const isShort = clip.aspectRatio === '9:16' && clip.durationSec <= 180;
    const id = `upl-${crypto.randomBytes(5).toString('hex')}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO upload_jobs (
        id, clip_id, youtube_channel_title, title, description, tags_json, visibility,
        is_short, scheduled_at, status, progress, youtube_video_id, youtube_url,
        error_message, approved_by_user, is_demo, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_approval', 0, NULL, NULL, NULL, ?, ?, ?, NULL)
    `).run(
      id,
      clip.id,
      yt.channelTitle,
      parsed.data.title,
      parsed.data.description,
      JSON.stringify(parsed.data.tags),
      parsed.data.visibility,
      isShort ? 1 : 0,
      parsed.data.scheduledAt ?? null,
      parsed.data.approvedByUser ? 1 : 0,
      clip.isDemo ? 1 : 0,
      now
    );

    db.prepare('UPDATE clips SET youtube_status = ?, updated_at = ? WHERE id = ?').run(
      'awaiting_approval',
      now,
      clip.id
    );

    res.status(201).json({ id, ok: true });
  });

  router.post('/uploads/:id/publish', async (req, res) => {
    const confirmPublic = Boolean(req.body?.confirmPublic);
    const job = db.prepare('SELECT id, visibility, clip_id FROM upload_jobs WHERE id = ?').get(req.params.id) as
      | { id: string; visibility: string; clip_id: string }
      | undefined;

    if (!job) {
      res.status(404).json({ error: 'Upload job not found.' });
      return;
    }

    if (job.visibility === 'public' && !confirmPublic) {
      res.status(400).json({ error: 'Explicit confirmation is required before publishing a Public video.' });
      return;
    }

    db.prepare('UPDATE upload_jobs SET approved_by_user = 1, status = ?, error_message = NULL WHERE id = ?').run(
      'queued',
      job.id
    );

    try {
      await executeResumableYouTubeUpload(job.id);
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'YouTube upload failed.';
      db.prepare('UPDATE upload_jobs SET status = ?, error_message = ?, progress = 0 WHERE id = ?').run(
        'failed',
        msg,
        job.id
      );
      db.prepare('UPDATE clips SET youtube_status = ? WHERE id = ?').run('failed', job.clip_id);
      res.status(400).json({ error: msg });
    }
  });

  router.patch('/uploads/:id', (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 100) : undefined;
    const description = typeof req.body?.description === 'string' ? req.body.description.slice(0, 4900) : undefined;
    const visibility = ['private', 'unlisted', 'public'].includes(req.body?.visibility)
      ? req.body.visibility
      : undefined;
    const tags = Array.isArray(req.body?.tags) ? req.body.tags.slice(0, 15).map(String) : undefined;
    const scheduledAt = req.body?.scheduledAt === null || typeof req.body?.scheduledAt === 'string'
      ? req.body.scheduledAt
      : undefined;

    const existing = db.prepare('SELECT * FROM upload_jobs WHERE id = ?').get(req.params.id) as
      | {
          title: string;
          description: string;
          visibility: string;
          tags_json: string;
          scheduled_at: string | null;
        }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Upload job not found.' });
      return;
    }

    db.prepare(`
      UPDATE upload_jobs
      SET title = ?, description = ?, visibility = ?, tags_json = ?, scheduled_at = ?
      WHERE id = ?
    `).run(
      title ?? existing.title,
      description ?? existing.description,
      visibility ?? existing.visibility,
      tags ? JSON.stringify(tags) : existing.tags_json,
      scheduledAt !== undefined ? scheduledAt : existing.scheduled_at,
      req.params.id
    );

    res.json({ ok: true });
  });

  router.delete('/uploads/:id', (req, res) => {
    db.prepare('DELETE FROM upload_jobs WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  return router;
}
