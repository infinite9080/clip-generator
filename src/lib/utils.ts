import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { AudioReviewStatus, ClipPreset, ClipStatus, HypeLevel } from '../types/hypecut';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[idx]}`;
}

export function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function formatCompactNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

export function getPresetLabel(preset: ClipPreset): string {
  switch (preset) {
    case 'quick_short':
      return 'Quick Short (30s)';
    case 'highlight':
      return 'Highlight (2–3m)';
    case 'extended':
      return 'Extended (5m)';
  }
}

export function getHypeColorClass(score: number): string {
  if (score >= 85) return 'text-red-400';
  if (score >= 70) return 'text-amber-400';
  if (score >= 50) return 'text-blue-400';
  return 'text-slate-300';
}

export function getHypeLevelFromScore(score: number): HypeLevel {
  if (score >= 85) return 'Extreme';
  if (score >= 70) return 'Very High';
  if (score >= 50) return 'High';
  if (score >= 30) return 'Moderate';
  return 'Normal';
}

export function getClipStatusMeta(status: ClipStatus): { label: string; colorClass: string } {
  switch (status) {
    case 'ready':
      return { label: 'Ready', colorClass: 'text-emerald-400' };
    case 'processing':
      return { label: 'Processing', colorClass: 'text-blue-400' };
    case 'queued':
      return { label: 'Queued', colorClass: 'text-amber-400' };
    case 'failed':
      return { label: 'Failed', colorClass: 'text-red-400' };
  }
}

export function getAudioReviewMeta(status: AudioReviewStatus): { label: string; colorClass: string } {
  switch (status) {
    case 'clean':
      return { label: 'Audio Clean', colorClass: 'text-emerald-400' };
    case 'approved':
      return { label: 'Audio Approved', colorClass: 'text-emerald-400' };
    case 'flagged':
      return { label: 'Music Flagged', colorClass: 'text-amber-400' };
    case 'pending':
      return { label: 'Review Pending', colorClass: 'text-slate-400' };
  }
}
