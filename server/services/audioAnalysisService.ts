import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { promisify } from 'node:util';
import type { AudioFlagSegment, AudioReviewStatus } from '../../src/types/hypecut.ts';
import { appendLog, CLIPS_DIR, isPathInsideDir, RECORDINGS_DIR } from '../storage.ts';
import { checkFfmpegHealth, validateBinaryPath } from './ffmpegService.ts';

const execFileAsync = promisify(execFile);

export interface AudioScanResult {
  reviewStatus: AudioReviewStatus;
  flags: AudioFlagSegment[];
  silenceCount: number;
  meanVolumeDb: number | null;
  disclaimer: string;
  scannedWithFfmpeg: boolean;
}

const COPYRIGHT_DISCLAIMER =
  'Automated local audio analysis identifies likely continuous background music segments for review, but does NOT guarantee copyright clearance. Only publish video and audio you own or have permission to use.';

export async function analyzeLocalClipAudio(input: {
  ffmpegPath: string;
  sourcePath: string | null;
  durationSec: number;
}): Promise<AudioScanResult> {
  const { sourcePath, durationSec } = input;

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return {
      reviewStatus: 'pending',
      flags: [],
      silenceCount: 0,
      meanVolumeDb: null,
      disclaimer: COPYRIGHT_DISCLAIMER,
      scannedWithFfmpeg: false,
    };
  }

  if (!isPathInsideDir(sourcePath, RECORDINGS_DIR) && !isPathInsideDir(sourcePath, CLIPS_DIR)) {
    throw new Error('Audio scan blocked: file outside authorized local storage.');
  }

  const binary = validateBinaryPath(input.ffmpegPath, 'ffmpeg');
  const health = await checkFfmpegHealth(binary);
  if (!health.available) {
    return {
      reviewStatus: 'flagged',
      flags: [
        {
          id: `flag-${crypto.randomBytes(4).toString('hex')}`,
          startSec: 0,
          endSec: Math.min(durationSec, 30),
          confidence: 0.5,
          label: 'Manual audio review required (local FFmpeg unavailable)',
          action: 'unreviewed',
          notes: 'Install FFmpeg locally to enable automated spectral/silence scanning before publishing.',
        },
      ],
      silenceCount: 0,
      meanVolumeDb: null,
      disclaimer: COPYRIGHT_DISCLAIMER,
      scannedWithFfmpeg: false,
    };
  }

  try {
    const { stderr } = await execFileAsync(
      binary,
      [
        '-i',
        sourcePath,
        '-af',
        'silencedetect=noise=-34dB:d=1.2,volumedetect',
        '-f',
        'null',
        '-',
      ],
      { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, shell: false }
    );

    const silenceMatches = stderr.match(/silence_end:/g) ?? [];
    const silenceCount = silenceMatches.length;

    const meanMatch = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
    const meanVolumeDb = meanMatch ? Number(meanMatch[1]) : null;

    const flags: AudioFlagSegment[] = [];

    // Heuristic: continuous non-silent dense audio (no silence breaks over >= 20s and loud floor)
    // frequently indicates steady background music underneath voice/game audio.
    if (durationSec >= 20 && silenceCount === 0 && (meanVolumeDb === null || meanVolumeDb > -24)) {
      flags.push({
        id: `flag-${crypto.randomBytes(4).toString('hex')}`,
        startSec: 0,
        endSec: Math.min(durationSec, Math.round(durationSec * 0.65)),
        confidence: 0.76,
        label: 'Sustained background audio floor detected (possible music)',
        action: 'unreviewed',
        notes:
          'Zero silence gaps and elevated mean loudness suggest persistent background audio. Review manually, mute this range, or run Demucs separation locally.',
      });
    }

    appendLog(
      'INFO',
      'audio-analysis',
      `Scanned ${sourcePath}: silences=${silenceCount}, meanDb=${meanVolumeDb}, flags=${flags.length}`
    );

    return {
      reviewStatus: flags.length > 0 ? 'flagged' : 'clean',
      flags,
      silenceCount,
      meanVolumeDb,
      disclaimer: COPYRIGHT_DISCLAIMER,
      scannedWithFfmpeg: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Audio scan error';
    appendLog('ERROR', 'audio-analysis', msg);
    return {
      reviewStatus: 'flagged',
      flags: [
        {
          id: `flag-${crypto.randomBytes(4).toString('hex')}`,
          startSec: 0,
          endSec: Math.min(durationSec, 30),
          confidence: 0.5,
          label: 'Audio scan inconclusive — manual verification needed',
          action: 'unreviewed',
          notes: msg,
        },
      ],
      silenceCount: 0,
      meanVolumeDb: null,
      disclaimer: COPYRIGHT_DISCLAIMER,
      scannedWithFfmpeg: false,
    };
  }
}
