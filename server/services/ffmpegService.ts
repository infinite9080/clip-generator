import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CaptionConfig, ClipRecord, EditConfig } from '../../src/types/hypecut.ts';
import {
  appendLog,
  CLIPS_DIR,
  isPathInsideDir,
  RECORDINGS_DIR,
  resolveSafeStoragePath,
  TEMP_DIR,
  THUMBNAILS_DIR,
} from '../storage.ts';

const execFileAsync = promisify(execFile);

export interface FfmpegHealth {
  available: boolean;
  version: string | null;
  nvencSupported: boolean;
  binaryPath: string;
  error: string | null;
}

export function validateBinaryPath(binaryPath: string, fallback: 'ffmpeg' | 'ffprobe'): string {
  const trimmed = (binaryPath || fallback).trim();
  if (!trimmed || trimmed.length > 260) return fallback;
  // Block shell metacharacters even though execFile uses shell: false
  if (/[;&|`$<>!?\n\r]/.test(trimmed)) {
    throw new Error(`Invalid characters in ${fallback} path.`);
  }
  return trimmed;
}

export async function checkFfmpegHealth(ffmpegPathInput: string): Promise<FfmpegHealth> {
  const binaryPath = validateBinaryPath(ffmpegPathInput, 'ffmpeg');
  try {
    const { stdout } = await execFileAsync(binaryPath, ['-version'], {
      timeout: 5000,
      shell: false,
    });
    const firstLine = stdout.split('\n')[0]?.trim() || 'FFmpeg detected';

    let nvencSupported = false;
    try {
      const enc = await execFileAsync(binaryPath, ['-hide_banner', '-encoders'], {
        timeout: 4000,
        shell: false,
      });
      nvencSupported = enc.stdout.includes('h264_nvenc');
    } catch {
      nvencSupported = false;
    }

    return {
      available: true,
      version: firstLine,
      nvencSupported,
      binaryPath,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'FFmpeg not found in PATH';
    return {
      available: false,
      version: null,
      nvencSupported: false,
      binaryPath,
      error: msg,
    };
  }
}

export async function probeMediaDuration(
  ffprobePathInput: string,
  mediaPath: string
): Promise<{ durationSec: number; width: number; height: number } | null> {
  if (!isPathInsideDir(mediaPath, RECORDINGS_DIR) && !isPathInsideDir(mediaPath, CLIPS_DIR)) {
    throw new Error('Media path outside authorized local storage.');
  }
  const binary = validateBinaryPath(ffprobePathInput, 'ffprobe');
  try {
    const { stdout } = await execFileAsync(
      binary,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', mediaPath],
      { timeout: 10000, shell: false }
    );
    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };
    const durationSec = Math.max(1, Math.round(Number(data.format?.duration || 30)));
    const videoStream = data.streams?.find((s) => s.codec_type === 'video');
    return {
      durationSec,
      width: videoStream?.width ?? 1920,
      height: videoStream?.height ?? 1080,
    };
  } catch {
    return null;
  }
}

function hexToAssColor(hex: string): string {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '&H00FFFFFF';
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function formatAssTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const cs = Math.floor((safe - Math.floor(safe)) * 100);
  return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function buildAssSubtitleFile(clipId: string, config: CaptionConfig, isVertical: boolean): string {
  const playResX = isVertical ? 1080 : 1920;
  const playResY = isVertical ? 1920 : 1080;
  const alignment = config.position === 'top' ? 8 : config.position === 'center' ? 5 : 2;
  const marginV = config.position === 'center' ? 0 : isVertical ? 260 : 90;
  const primaryColor = hexToAssColor(config.textColor);
  const highlightColor = hexToAssColor(config.highlightColor);

  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${config.fontFamily.replace(/,/g, '')},${Math.max(24, Math.min(88, config.fontSize + 18))},${primaryColor},${highlightColor},&H00090C12,&H80090C12,1,0,0,0,100,100,0,0,1,4,2,${alignment},60,60,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const highlightSet = new Set<string>();
  for (const cue of config.cues) {
    highlightSet.clear();
    for (const w of cue.highlightWords) highlightSet.add(w.toUpperCase());

    const styledWords = cue.text
      .replace(/[\r\n]+/g, ' ')
      .replace(/[{}]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => {
        if (highlightSet.has(word.toUpperCase())) {
          return `{\\c${highlightColor}}${word}{\\c${primaryColor}}`;
        }
        return word;
      })
      .join(' ');

    lines.push(
      `Dialogue: 0,${formatAssTime(cue.startSec)},${formatAssTime(cue.endSec)},Default,,0,0,0,,${styledWords}`
    );
  }

  const assPath = resolveSafeStoragePath(TEMP_DIR, `${clipId}_captions.ass`);
  fs.writeFileSync(assPath, lines.join('\n'), 'utf8');
  return assPath;
}

export async function renderClipWithFfmpeg(input: {
  ffmpegPath: string;
  clip: ClipRecord;
  onProgress?: (pct: number, logLine: string) => void;
}): Promise<{ outputPath: string; thumbnailPath: string | null; logs: string }> {
  const { clip, onProgress } = input;
  const binary = validateBinaryPath(input.ffmpegPath, 'ffmpeg');

  if (!clip.sourcePath || !fs.existsSync(clip.sourcePath)) {
    throw new Error(
      'No authorized local source video is attached to this clip. Upload a local recording (.mp4/.mov/.mkv) in Generated Clips to run local FFmpeg rendering.'
    );
  }

  if (!isPathInsideDir(clip.sourcePath, RECORDINGS_DIR) && !isPathInsideDir(clip.sourcePath, CLIPS_DIR)) {
    throw new Error('Source video path is outside authorized local storage.');
  }

  const health = await checkFfmpegHealth(binary);
  if (!health.available) {
    throw new Error(
      `Local FFmpeg binary "${binary}" is not available (${health.error || 'not installed'}). Install FFmpeg and verify the path in Settings.`
    );
  }

  const outputPath = resolveSafeStoragePath(CLIPS_DIR, `${clip.id}_rendered.mp4`);
  const thumbnailPath = resolveSafeStoragePath(THUMBNAILS_DIR, `${clip.id}_thumb.jpg`);
  const isVertical = clip.aspectRatio === '9:16';
  const duration = Math.max(3, clip.endSec - clip.startSec);

  const filters: string[] = [];
  if (isVertical) {
    // Center crop 16:9 gameplay into 9:16 vertical 1080x1920 with optional zoom factor
    const zoom = Math.max(1, Math.min(1.6, clip.editConfig.gameplayZoom || 1.0));
    if (zoom > 1.01) {
      filters.push(`scale=iw*${zoom.toFixed(2)}:ih*${zoom.toFixed(2)}`);
    }
    filters.push('crop=min(iw\\,ih*9/16):ih:(iw-min(iw\\,ih*9/16))/2:0');
    filters.push('scale=1080:1920:flags=lanczos');
  } else {
    filters.push('scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black');
  }

  let assTempPath: string | null = null;
  if (clip.captionConfig.enabled && clip.captionConfig.cues.length > 0) {
    assTempPath = buildAssSubtitleFile(clip.id, clip.captionConfig, isVertical);
    const escapedAssPath = assTempPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    filters.push(`ass='${escapedAssPath}'`);
  }

  const audioFilters: string[] = [];
  // Apply mute filters for any user-selected muted copyright/music segments
  for (const flag of clip.audioFlags) {
    if (flag.action === 'mute') {
      const s = Math.max(0, flag.startSec - clip.startSec);
      const e = Math.max(s + 0.2, flag.endSec - clip.startSec);
      audioFilters.push(`volume=enable='between(t,${s.toFixed(2)},${e.toFixed(2)})':volume=0`);
    }
  }
  if (clip.editConfig.normalizeAudio) {
    audioFilters.push('loudnorm=I=-14:TP=-1.5:LRA=11');
  }

  const videoCodec = health.nvencSupported ? 'h264_nvenc' : 'libx264';
  const args: string[] = [
    '-y',
    '-ss',
    String(Math.max(0, clip.startSec)),
    '-t',
    String(duration),
    '-i',
    clip.sourcePath,
    '-vf',
    filters.join(','),
    '-c:v',
    videoCodec,
    ...(videoCodec === 'libx264' ? ['-preset', 'veryfast', '-crf', '21'] : ['-preset', 'p4', '-cq', '22']),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    ...(audioFilters.length > 0 ? ['-af', audioFilters.join(',')] : []),
    '-movflags',
    '+faststart',
    outputPath,
  ];

  onProgress?.(25, `Starting FFmpeg render (${videoCodec}, ${clip.aspectRatio}, ${duration.toFixed(1)}s)...`);
  appendLog('INFO', 'ffmpeg', `Rendering clip ${clip.id} with ${videoCodec}`);

  const { stderr } = await execFileAsync(binary, args, {
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
  });

  onProgress?.(85, 'Verifying rendered MP4 output file...');

  // Verify the output video truly exists and has non-zero size
  if (!fs.existsSync(outputPath)) {
    throw new Error('FFmpeg exited without producing an output MP4 file.');
  }
  const outStat = fs.statSync(outputPath);
  if (outStat.size < 1024) {
    throw new Error('Rendered MP4 file verification failed (file is empty or corrupted).');
  }

  let verifiedThumb: string | null = null;
  try {
    await execFileAsync(
      binary,
      ['-y', '-ss', String(Math.min(2, duration / 2)), '-i', outputPath, '-vframes', '1', '-q:v', '3', thumbnailPath],
      { timeout: 15_000, shell: false }
    );
    if (fs.existsSync(thumbnailPath) && fs.statSync(thumbnailPath).size > 200) {
      verifiedThumb = `/api/media/thumbnails/${path.basename(thumbnailPath)}`;
    }
  } catch {
    verifiedThumb = null;
  }

  // Cleanup temp ASS subtitle file
  if (assTempPath && fs.existsSync(assTempPath) && isPathInsideDir(assTempPath, TEMP_DIR)) {
    try {
      fs.unlinkSync(assTempPath);
    } catch {
      // Ignore temp cleanup failure
    }
  }

  onProgress?.(100, `Verified output MP4 (${(outStat.size / (1024 * 1024)).toFixed(2)} MB).`);
  return {
    outputPath,
    thumbnailPath: verifiedThumb,
    logs: stderr.slice(-1500),
  };
}

export async function generateLocalTestRecording(input: {
  ffmpegPath: string;
  fileName: string;
  durationSec?: number;
}): Promise<{ filePath: string; thumbnailPath: string | null; durationSec: number }> {
  const binary = validateBinaryPath(input.ffmpegPath, 'ffmpeg');
  const health = await checkFfmpegHealth(binary);
  if (!health.available) {
    throw new Error(`Local FFmpeg binary "${binary}" is unavailable (${health.error || 'not installed'}).`);
  }

  const durationSec = Math.max(5, Math.min(30, input.durationSec ?? 12));
  const outPath = resolveSafeStoragePath(RECORDINGS_DIR, input.fileName);
  const thumbPath = resolveSafeStoragePath(THUMBNAILS_DIR, `${path.parse(input.fileName).name}_thumb.jpg`);

  await execFileAsync(
    binary,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=1280x720:rate=30:duration=${durationSec}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:sample_rate=48000:duration=${durationSec}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      outPath,
    ],
    { timeout: 45_000, shell: false }
  );

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1024) {
    throw new Error('FFmpeg did not produce a valid test MP4 recording.');
  }

  let verifiedThumb: string | null = null;
  try {
    await execFileAsync(
      binary,
      ['-y', '-ss', '2', '-i', outPath, '-vframes', '1', '-q:v', '3', thumbPath],
      { timeout: 10_000, shell: false }
    );
    if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 200) {
      verifiedThumb = `/api/media/thumbnails/${path.basename(thumbPath)}`;
    }
  } catch {
    verifiedThumb = null;
  }

  return { filePath: outPath, thumbnailPath: verifiedThumb, durationSec };
}

