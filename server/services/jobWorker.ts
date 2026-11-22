import crypto from 'node:crypto';
import { db, getClipById, getSettings } from '../db.ts';
import { appendLog } from '../storage.ts';
import { analyzeLocalClipAudio } from './audioAnalysisService.ts';
import { renderClipWithFfmpeg } from './ffmpegService.ts';

type JobEventListener = (job: {
  id: string;
  clipId: string;
  jobType: string;
  status: string;
  progress: number;
  errorMessage: string | null;
}) => void;

class BackgroundJobWorker {
  private isRunning = false;
  private listeners = new Set<JobEventListener>();

  subscribe(listener: JobEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(job: {
    id: string;
    clipId: string;
    jobType: string;
    status: string;
    progress: number;
    errorMessage: string | null;
  }): void {
    for (const fn of this.listeners) {
      try {
        fn(job);
      } catch {
        // Ignore closed SSE listeners
      }
    }
  }

  enqueueRenderJob(clipId: string): string {
    const clip = getClipById(clipId);
    if (!clip) throw new Error('Clip not found.');

    const jobId = `job-${crypto.randomBytes(5).toString('hex')}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO video_jobs (id, clip_id, clip_title, job_type, status, progress, logs, error_message, attempts, created_at, completed_at)
      VALUES (?, ?, ?, 'render', 'queued', 0, 'Queued for local FFmpeg worker...', NULL, 1, ?, NULL)
    `).run(jobId, clip.id, clip.title, now);

    db.prepare('UPDATE clips SET status = ?, updated_at = ? WHERE id = ?').run('queued', now, clip.id);

    this.notify({ id: jobId, clipId: clip.id, jobType: 'render', status: 'queued', progress: 0, errorMessage: null });
    this.scheduleNext();
    return jobId;
  }

  enqueueAudioScanJob(clipId: string): string {
    const clip = getClipById(clipId);
    if (!clip) throw new Error('Clip not found.');

    const jobId = `job-${crypto.randomBytes(5).toString('hex')}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO video_jobs (id, clip_id, clip_title, job_type, status, progress, logs, error_message, attempts, created_at, completed_at)
      VALUES (?, ?, ?, 'audio_scan', 'queued', 0, 'Queued for local audio analysis...', NULL, 1, ?, NULL)
    `).run(jobId, clip.id, clip.title, now);

    this.notify({
      id: jobId,
      clipId: clip.id,
      jobType: 'audio_scan',
      status: 'queued',
      progress: 0,
      errorMessage: null,
    });
    this.scheduleNext();
    return jobId;
  }

  private scheduleNext(): void {
    if (this.isRunning) return;
    setImmediate(() => {
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      while (true) {
        const nextJob = db
          .prepare(`SELECT id, clip_id, job_type FROM video_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`)
          .get() as { id: string; clip_id: string; job_type: 'render' | 'audio_scan' } | undefined;

        if (!nextJob) break;
        await this.executeJob(nextJob.id, nextJob.clip_id, nextJob.job_type);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async executeJob(jobId: string, clipId: string, jobType: 'render' | 'audio_scan'): Promise<void> {
    const settings = getSettings();
    const clip = getClipById(clipId);
    const now = new Date().toISOString();

    if (!clip) {
      db.prepare(`UPDATE video_jobs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`).run(
        'Clip record no longer exists.',
        now,
        jobId
      );
      return;
    }

    db.prepare(`UPDATE video_jobs SET status = 'running', progress = 10 WHERE id = ?`).run(jobId);
    if (jobType === 'render') {
      db.prepare(`UPDATE clips SET status = 'processing', updated_at = ? WHERE id = ?`).run(now, clip.id);
    }
    this.notify({ id: jobId, clipId: clip.id, jobType, status: 'running', progress: 10, errorMessage: null });

    try {
      if (jobType === 'render') {
        const result = await renderClipWithFfmpeg({
          ffmpegPath: settings.ffmpegPath,
          clip,
          onProgress: (pct, line) => {
            db.prepare('UPDATE video_jobs SET progress = ?, logs = ? WHERE id = ?').run(pct, line, jobId);
            this.notify({ id: jobId, clipId: clip.id, jobType, status: 'running', progress: pct, errorMessage: null });
          },
        });

        const doneIso = new Date().toISOString();
        db.prepare(`
          UPDATE clips
          SET status = 'ready',
              output_path = ?,
              thumbnail_path = COALESCE(?, thumbnail_path),
              has_verified_media = 1,
              updated_at = ?
          WHERE id = ?
        `).run(result.outputPath, result.thumbnailPath, doneIso, clip.id);

        db.prepare(`
          UPDATE video_jobs
          SET status = 'completed', progress = 100, logs = ?, completed_at = ?
          WHERE id = ?
        `).run(result.logs || 'Render verified.', doneIso, jobId);

        this.notify({ id: jobId, clipId: clip.id, jobType, status: 'completed', progress: 100, errorMessage: null });
      } else {
        const scan = await analyzeLocalClipAudio({
          ffmpegPath: settings.ffmpegPath,
          sourcePath: clip.outputPath || clip.sourcePath,
          durationSec: clip.durationSec,
        });

        const doneIso = new Date().toISOString();
        db.prepare(`
          UPDATE clips
          SET audio_review_status = ?, audio_flags_json = ?, updated_at = ?
          WHERE id = ?
        `).run(scan.reviewStatus, JSON.stringify(scan.flags), doneIso, clip.id);

        db.prepare(`
          UPDATE video_jobs
          SET status = 'completed', progress = 100, logs = ?, completed_at = ?
          WHERE id = ?
        `).run(
          `Audio scan complete: status=${scan.reviewStatus}, silences=${scan.silenceCount}, meanDb=${scan.meanVolumeDb ?? 'n/a'}`,
          doneIso,
          jobId
        );

        this.notify({ id: jobId, clipId: clip.id, jobType, status: 'completed', progress: 100, errorMessage: null });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Background job failed';
      const doneIso = new Date().toISOString();
      appendLog('ERROR', 'job-worker', `Job ${jobId} failed: ${msg}`);

      db.prepare(`
        UPDATE video_jobs
        SET status = 'failed', error_message = ?, completed_at = ?
        WHERE id = ?
      `).run(msg, doneIso, jobId);

      if (jobType === 'render') {
        db.prepare(`UPDATE clips SET status = 'failed', updated_at = ? WHERE id = ?`).run(doneIso, clip.id);
      }

      this.notify({ id: jobId, clipId: clip.id, jobType, status: 'failed', progress: 0, errorMessage: msg });
    }
  }
}

export const jobWorker = new BackgroundJobWorker();
