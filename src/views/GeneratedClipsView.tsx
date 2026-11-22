import React, { useEffect, useState } from 'react';
import {
  Download,
  Film,
  Play,
  RefreshCw,
  Scissors,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from 'lucide-react';
import type { ClipPreset, ClipRecord, VideoJobRecord } from '../types/hypecut';
import { api } from '../lib/api';
import {
  cn,
  formatDuration,
  formatRelativeTime,
  getAudioReviewMeta,
  getClipStatusMeta,
  getHypeColorClass,
  getPresetLabel,
} from '../lib/utils';
import { Button, EmptyState, Input, MediaThumbnail, Panel, ProgressBar, Select } from '../components/ui/primitives';

type ClipFilter =
  | 'all'
  | 'quick_short'
  | 'highlight'
  | 'extended'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'uploaded';

export function GeneratedClipsView({
  includeDemo,
  onOpenEditor,
  onNavigateUploads,
  onNotify,
}: {
  includeDemo: boolean;
  onOpenEditor: (clip: ClipRecord) => void;
  onNavigateUploads: () => void;
  onNotify: (msg: string, tone?: 'info' | 'error') => void;
}) {
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [jobs, setJobs] = useState<VideoJobRecord[]>([]);
  const [filter, setFilter] = useState<ClipFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyClipId, setBusyClipId] = useState<string | null>(null);
  const [previewClip, setPreviewClip] = useState<ClipRecord | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Local authorized video upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadChannel, setUploadChannel] = useState('My Authorized Stream');
  const [uploadPreset, setUploadPreset] = useState<ClipPreset>('quick_short');
  const [uploadingLocal, setUploadingLocal] = useState(false);
  const [generatingTest, setGeneratingTest] = useState(false);

  const loadData = React.useCallback(async () => {
    try {
      const res = await api.getClips(includeDemo);
      setClips(res.clips);
      setJobs(res.jobs);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load clips', 'error');
    } finally {
      setLoading(false);
    }
  }, [includeDemo, onNotify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleLocalUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      onNotify('Select a local MP4, MOV, MKV, or WebM recording first.', 'error');
      return;
    }
    setUploadingLocal(true);
    try {
      const fd = new FormData();
      fd.append('video', uploadFile);
      fd.append('title', uploadTitle.trim());
      fd.append('channelName', uploadChannel.trim() || 'Local Recording');
      fd.append('preset', uploadPreset);

      const created = await api.uploadLocalRecording(fd);
      setShowUploadModal(false);
      setUploadFile(null);
      setUploadTitle('');
      await loadData();
      onNotify(`Imported "${created.title}" into local storage. Ready for FFmpeg editing & audio scan.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Local video upload failed.', 'error');
    } finally {
      setUploadingLocal(false);
    }
  };

  const handleGenerateTestMp4 = async () => {
    setGeneratingTest(true);
    try {
      const created = await api.generateLocalTestVideo();
      await loadData();
      onNotify(`Generated real local MP4 "${created.title}" via FFmpeg. Open in Editor to render 9:16!`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to generate local test MP4.', 'error');
    } finally {
      setGeneratingTest(false);
    }
  };

  const handleRegenerateMeta = async (clip: ClipRecord) => {
    setBusyClipId(clip.id);
    try {
      const res = await api.regenerateClipMetadata(clip.id);
      await loadData();
      onNotify(
        res.metadata.source === 'ollama'
          ? `Regenerated title & tags via local Ollama (${res.metadata.modelUsed}).`
          : 'Regenerated title & tags via local Rule-Based fallback (Ollama offline).'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Metadata generation failed.', 'error');
    } finally {
      setBusyClipId(null);
    }
  };

  const handleQueueYouTube = async (clip: ClipRecord) => {
    setBusyClipId(clip.id);
    try {
      await api.createUploadJob({
        clipId: clip.id,
        title: clip.title,
        description: clip.description,
        tags: clip.hashtags,
        visibility: 'private',
        approvedByUser: false,
      });
      await loadData();
      onNotify('Added Private upload draft to Upload Manager (awaiting manual approval).');
      onNavigateUploads();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not queue upload draft.', 'error');
    } finally {
      setBusyClipId(null);
    }
  };

  const handleDelete = async (clip: ClipRecord) => {
    setBusyClipId(clip.id);
    try {
      await api.deleteClip(clip.id);
      await loadData();
      onNotify(`Deleted "${clip.title}".`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed.', 'error');
    } finally {
      setBusyClipId(null);
    }
  };

  const filtered = clips.filter((clip) => {
    if (filter === 'quick_short' && clip.preset !== 'quick_short') return false;
    if (filter === 'highlight' && clip.preset !== 'highlight') return false;
    if (filter === 'extended' && clip.preset !== 'extended') return false;
    if (filter === 'processing' && clip.status !== 'processing' && clip.status !== 'queued') return false;
    if (filter === 'ready' && clip.status !== 'ready') return false;
    if (filter === 'failed' && clip.status !== 'failed') return false;
    if (filter === 'uploaded' && clip.youtubeStatus !== 'uploaded') return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        clip.title.toLowerCase().includes(q) ||
        clip.channelName.toLowerCase().includes(q) ||
        clip.hashtags.join(' ').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeJobByClip = new Map<string, VideoJobRecord>();
  for (const job of jobs) {
    if ((job.status === 'running' || job.status === 'queued') && !activeJobByClip.has(job.clipId)) {
      activeJobByClip.set(job.clipId, job);
    }
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-800 bg-[#111620] p-1">
          {(
            [
              ['all', 'All Clips'],
              ['quick_short', '30s Shorts'],
              ['highlight', '2–3m Highlights'],
              ['extended', '5m Extended'],
              ['processing', 'Processing'],
              ['ready', 'Ready'],
              ['failed', 'Failed'],
              ['uploaded', 'Uploaded'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'rounded px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer',
                filter === key ? 'bg-[#1D2638] text-slate-100' : 'text-slate-400 hover:text-slate-200'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clips or channels..."
            className="w-56"
          />
          <Button variant="secondary" onClick={handleGenerateTestMp4} disabled={generatingTest}>
            <Film className="h-4 w-4" />
            {generatingTest ? 'Generating MP4...' : 'Generate Test MP4'}
          </Button>
          <Button onClick={() => setShowUploadModal(true)}>
            <Upload className="h-4 w-4" />
            Import Local Recording
          </Button>
        </div>
      </div>

      {/* Clips Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-lg border border-slate-800 bg-[#111620]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No clips match this filter"
          description="Import an authorized local video recording (.mp4, .mov, .mkv) to edit with FFmpeg, or run Live Monitor to detect chat hype spikes."
          action={
            <Button onClick={() => setShowUploadModal(true)}>
              <Upload className="h-4 w-4" />
              Import Local Recording
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((clip) => {
            const st = getClipStatusMeta(clip.status);
            const audio = getAudioReviewMeta(clip.audioReviewStatus);
            const runningJob = activeJobByClip.get(clip.id);
            const isBusy = busyClipId === clip.id;

            return (
              <Panel key={clip.id} className="flex flex-col overflow-hidden">
                <div className="relative overflow-hidden border-b border-slate-800/80">
                  <MediaThumbnail
                    src={clip.thumbnailPath}
                    alt={clip.title}
                    fallbackLabel={`${clip.aspectRatio} · ${formatDuration(clip.durationSec)}`}
                  />
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 py-2 text-xs text-slate-200">
                    <span className="font-mono tabular-nums">
                      {formatDuration(clip.durationSec)} · {clip.aspectRatio}
                    </span>
                    <span className={cn('font-mono font-semibold tabular-nums', getHypeColorClass(clip.hypeScore))}>
                      {clip.hypeScore} Hype
                    </span>
                  </div>
                </div>

                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <p className="text-xs text-slate-400">
                      {clip.channelName}
                      <span className="mx-1.5 text-slate-600">·</span>
                      {getPresetLabel(clip.preset)}
                    </p>
                    <h3 className="mt-1 line-clamp-2 text-sm font-semibold text-slate-100">
                      {clip.title}
                    </h3>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                      <span className={st.colorClass}>{st.label}</span>
                      <span className="text-slate-600">·</span>
                      <span className={audio.colorClass}>{audio.label}</span>
                      <span className="text-slate-600">·</span>
                      <span>
                        {clip.hasVerifiedMedia ? 'Local MP4 Ready' : clip.isDemo ? 'Demo Sample' : 'Timestamp Only'}
                      </span>
                    </div>

                    <p className="mt-1 text-[11px] text-slate-500">
                      YouTube: {clip.youtubeStatus.replace('_', ' ')} · Created {formatRelativeTime(clip.createdAt)}
                    </p>

                    {runningJob ? (
                      <div className="mt-3 space-y-1">
                        <div className="flex justify-between text-[11px] text-blue-300">
                          <span>{runningJob.jobType === 'render' ? 'Rendering FFmpeg...' : 'Scanning audio...'}</span>
                          <span className="font-mono tabular-nums">{runningJob.progress}%</span>
                        </div>
                        <ProgressBar value={runningJob.progress} tone="blue" />
                      </div>
                    ) : null}
                  </div>

                  {/* Action bar */}
                  <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-800/80 pt-3">
                    <Button size="sm" onClick={() => onOpenEditor(clip)}>
                      <Scissors className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setPreviewClip(clip)}>
                      <Play className="h-3.5 w-3.5" />
                      Preview
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      title="Regenerate title & tags with local Ollama / rules"
                      onClick={() => handleRegenerateMeta(clip)}
                    >
                      <RefreshCw className={cn('h-3.5 w-3.5', isBusy && 'animate-spin')} />
                    </Button>
                    {clip.hasVerifiedMedia ? (
                      <a
                        href={`/api/media/clips/${encodeURIComponent(clip.id)}/video?download=1`}
                        className="inline-flex h-8 items-center justify-center rounded-md px-2.5 text-xs text-slate-300 transition-colors hover:bg-[#161C28] hover:text-white"
                        title="Download local MP4"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      title="Create YouTube Upload Draft"
                      onClick={() => handleQueueYouTube(clip)}
                    >
                      <UploadCloud className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      title="Delete Clip"
                      onClick={() => handleDelete(clip)}
                      className="ml-auto text-slate-400 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      {previewClip ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <Panel className="w-full max-w-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <div className="min-w-0 pr-4">
                <h3 className="truncate text-sm font-semibold text-slate-100">{previewClip.title}</h3>
                <p className="text-xs text-slate-400">
                  {previewClip.channelName} · {formatDuration(previewClip.durationSec)} · {previewClip.aspectRatio}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setPreviewClip(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="bg-black p-4">
              {previewClip.hasVerifiedMedia ? (
                <video
                  src={`/api/media/clips/${encodeURIComponent(previewClip.id)}/video`}
                  controls
                  className="mx-auto max-h-[420px] w-full rounded"
                />
              ) : (
                <div className="relative mx-auto max-w-xl overflow-hidden rounded border border-slate-800">
                  <MediaThumbnail
                    src={previewClip.thumbnailPath}
                    alt={previewClip.title}
                    fallbackLabel="No local video attached"
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-end bg-gradient-to-t from-black/90 via-black/30 to-transparent p-6 text-center">
                    <p className="text-lg font-extrabold tracking-tight text-white drop-shadow">
                      {previewClip.captionConfig.cues[0]?.text || previewClip.thumbnailText}
                    </p>
                    <p className="mt-2 text-xs text-slate-300">
                      Preview frame only — import an authorized local recording (.mp4) to play and render actual video with FFmpeg.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3">
              <span className="text-xs text-slate-400">
                Metadata: {previewClip.metadataSource === 'ollama' ? 'Local Ollama' : 'Rule-based fallback'}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setPreviewClip(null)}>
                  Close
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const target = previewClip;
                    setPreviewClip(null);
                    onOpenEditor(target);
                  }}
                >
                  Open in Video Editor
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      {/* Local Recording Upload Modal */}
      {showUploadModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <Panel className="w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Film className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-100">Import Authorized Local Recording</h3>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowUploadModal(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleLocalUpload} className="space-y-4 p-5">
              <p className="text-xs leading-relaxed text-slate-400">
                Upload your own OBS recording, authorized VOD segment, or test MP4 clip into <span className="font-mono text-slate-200">./storage/recordings/</span>. HypeCut AI will probe duration, run local audio analysis, and unlock real local FFmpeg rendering.
              </p>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Video File (.mp4, .mov, .mkv, .webm)</label>
                <input
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.mov,.mkv,.webm"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  className="block w-full rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs text-slate-200 file:mr-3 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-1 file:text-xs file:font-medium file:text-white hover:file:bg-blue-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Clip Title (optional — auto-generated if empty)</label>
                <Input
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="e.g. Overtime 1v3 Clutch on Arena"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Source Channel Name</label>
                  <Input
                    value={uploadChannel}
                    onChange={(e) => setUploadChannel(e.target.value)}
                    placeholder="Your Twitch channel"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Output Format Preset</label>
                  <Select
                    value={uploadPreset}
                    onChange={(e) => setUploadPreset(e.target.value as ClipPreset)}
                  >
                    <option value="quick_short">Quick Short (30s · 9:16)</option>
                    <option value="highlight">Highlight (2–3 min · 9:16)</option>
                    <option value="extended">Extended Highlight (5 min · 16:9)</option>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowUploadModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={uploadingLocal || !uploadFile}>
                  {uploadingLocal ? 'Importing...' : 'Import to Local Storage'}
                </Button>
              </div>
            </form>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
