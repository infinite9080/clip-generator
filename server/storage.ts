import fs from 'node:fs';
import path from 'node:path';

export const WORKSPACE_ROOT = process.cwd();
export const DATA_DIR = path.resolve(WORKSPACE_ROOT, 'data');
export const DB_PATH = path.resolve(DATA_DIR, 'hypecut.db');
export const STORAGE_ROOT = path.resolve(WORKSPACE_ROOT, 'storage');
export const RECORDINGS_DIR = path.resolve(STORAGE_ROOT, 'recordings');
export const CLIPS_DIR = path.resolve(STORAGE_ROOT, 'clips');
export const THUMBNAILS_DIR = path.resolve(STORAGE_ROOT, 'thumbnails');
export const TEMP_DIR = path.resolve(STORAGE_ROOT, 'temp');
export const LOGS_DIR = path.resolve(WORKSPACE_ROOT, 'logs');

const REQUIRED_DIRS = [
  DATA_DIR,
  STORAGE_ROOT,
  RECORDINGS_DIR,
  CLIPS_DIR,
  THUMBNAILS_DIR,
  TEMP_DIR,
  LOGS_DIR,
];

export function ensureLocalDirectories(): void {
  for (const dir of REQUIRED_DIRS) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export function resolveSafeStoragePath(baseDir: string, fileName: string): string {
  const sanitizedName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, sanitizedName);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Invalid storage path outside permitted directory.');
  }
  return resolvedTarget;
}

export function isPathInsideDir(targetPath: string, baseDir: string): boolean {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget.startsWith(resolvedBase + path.sep);
}

export function appendLog(level: 'INFO' | 'WARN' | 'ERROR', scope: string, message: string): void {
  try {
    ensureLocalDirectories();
    const logFile = path.resolve(LOGS_DIR, 'hypecut.log');
    const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}\n`;
    fs.appendFileSync(logFile, line, 'utf8');
  } catch {
    // Logging failure must never crash the server
  }
}

function getDirStats(dirPath: string): { bytes: number; count: number } {
  if (!fs.existsSync(dirPath)) return { bytes: 0, count: 0 };
  let bytes = 0;
  let count = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      const stat = fs.statSync(full);
      bytes += stat.size;
      count += 1;
    }
  }
  return { bytes, count };
}

export function getStorageStats() {
  ensureLocalDirectories();
  const dbBytes = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
  const recordings = getDirStats(RECORDINGS_DIR);
  const clips = getDirStats(CLIPS_DIR);
  const thumbnails = getDirStats(THUMBNAILS_DIR);
  const temp = getDirStats(TEMP_DIR);

  return {
    databaseBytes: dbBytes,
    recordingsBytes: recordings.bytes,
    clipsBytes: clips.bytes,
    thumbnailsBytes: thumbnails.bytes,
    tempBytes: temp.bytes,
    recordingsCount: recordings.count,
    clipsCount: clips.count,
    tempCount: temp.count,
  };
}

export function cleanTempStorage(): { deletedFiles: number; freedBytes: number } {
  ensureLocalDirectories();
  let deletedFiles = 0;
  let freedBytes = 0;
  for (const entry of fs.readdirSync(TEMP_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.resolve(TEMP_DIR, entry.name);
    if (!isPathInsideDir(full, TEMP_DIR)) continue;
    const stat = fs.statSync(full);
    fs.unlinkSync(full);
    deletedFiles += 1;
    freedBytes += stat.size;
  }
  appendLog('INFO', 'storage', `Cleaned ${deletedFiles} temp file(s), freed ${freedBytes} bytes`);
  return { deletedFiles, freedBytes };
}
