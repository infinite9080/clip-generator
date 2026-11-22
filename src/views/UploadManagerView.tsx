import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { OAuthConnectionSummary, UploadJobRecord, YouTubeVisibility } from '../types/hypecut';
import { api } from '../lib/api';
import { cn, formatDuration, formatRelativeTime } from '../lib/utils';
import {
  Button,
  EmptyState,
  Input,
  Panel,
  ProgressBar,
  Select,
  Textarea,
} from '../components/ui/primitives';

export function UploadManagerView({
  includeDemo,
  onNavigateYouTube,
  onNavigateClips,
  onNotify,
}: {
  includeDemo: boolean;
  onNavigateYouTube: () => void;
  onNavigateClips: () => void;
  onNotify: (msg: string, tone?: 'info' | 'error') => void;
}) {
  const [uploads, setUploads] = useState<UploadJobRecord[]>([]);
  const [ytConn, setYtConn] = useState<OAuthConnectionSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publicConfirmJob, setPublicConfirmJob] = useState<UploadJobRecord | null>(null);

  // Editable fields for selected draft
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDesc, setDraftDesc] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftVisibility, setDraftVisibility] = useState<YouTubeVisibility>('private');
  const [draftSchedule, setDraftSchedule] = useState('');

  const loadUploads = React.useCallback(async () => {
    try {
      const res = await api.getUploads(includeDemo);
      setUploads(res.uploads);
      setYtConn(res.youtubeConnection);
      if (res.uploads.length > 0 && !selectedId) {
        selectDraft(res.uploads[0]);
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load upload queue', 'error');
    }
  }, [includeDemo, selectedId, onNotify]);

  useEffect(() => {
    void loadUploads();
  }, [loadUploads]);

  const selectDraft = (u: UploadJobRecord) => {
    setSelectedId(u.id);
    setDraftTitle(u.title);
    setDraftDesc(u.description);
    setDraftTags(u.tags.join(', '));
    setDraftVisibility(u.visibility);
    setDraftSchedule(u.scheduledAt ? u.scheduledAt.slice(0, 16) : '');
  };

  const selectedJob = uploads.find((u) => u.id === selectedId) || null;

  const handleSaveDraft = async () => {
    if (!selectedJob) return;
    setSaving(true);
    try {
      await api.updateUploadJob(selectedJob.id, {
        title: draftTitle.trim(),
        description: draftDesc,
        tags: draftTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        visibility: draftVisibility,
        scheduledAt: draftSchedule ? new Date(draftSchedule).toISOString() : null,
      });
      await loadUploads();
      onNotify('Upload draft metadata saved.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save draft.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const triggerPublish = async (job: UploadJobRecord, confirmPublic = false) => {
    if (draftVisibility === 'public' && !confirmPublic) {
      setPublicConfirmJob(job);
      return;
    }

    setPublishingId(job.id);
    setPublicConfirmJob(null);
    try {
      if (selectedJob && selectedJob.id === job.id) {
        await api.updateUploadJob(job.id, {
          title: draftTitle.trim(),
          description: draftDesc,
          tags: draftTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          visibility: draftVisibility,
          scheduledAt: draftSchedule ? new Date(draftSchedule).toISOString() : null,
        });
      }
      await api.publishUploadJob(job.id, confirmPublic);
      await loadUploads();
      onNotify('Video uploaded to YouTube via Data API v3!');
    } catch (err) {
      await loadUploads();
      onNotify(err instanceof Error ? err.message : 'YouTube upload failed.', 'error');
    } finally {
      setPublishingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteUploadJob(id);
      if (selectedId === id) setSelectedId(null);
      await loadUploads();
      onNotify('Upload draft removed.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to delete draft.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Connection Status Banner */}
      <Panel className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="text-xs text-slate-300">
          <span className="font-semibold text-slate-100">
            YouTube Data API v3 Status:{' '}
            {ytConn?.connected ? `Connected (${ytConn.channelTitle})` : 'Not Connected'}
          </span>
          <span className="mx-2 text-slate-600">·</span>
          <span className="text-slate-400">
            Default visibility is Private. Vertical clips ≤ 3 min upload as YouTube Shorts; 5-minute videos upload as standard videos.
          </span>
        </div>
        {!ytConn?.connected ? (
          <Button size="sm" variant="secondary" onClick={onNavigateYouTube}>
            Connect YouTube Channel
          </Button>
        ) : null}
      </Panel>

      {uploads.length === 0 ? (
        <EmptyState
          title="No videos in the Upload Manager"
          description="Select a clip from Generated Clips or Video Editor and click Send to Upload to prepare metadata and review before publishing."
          action={<Button onClick={onNavigateClips}>Open Generated Clips</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Left: Queue & Upload History List */}
          <Panel className="divide-y divide-slate-800/80 xl:col-span-5">
            <div className="px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-100">Upload Queue & History</h2>
              <p className="text-xs text-slate-400">{uploads.length} item(s) tracked in local SQLite</p>
            </div>
            {uploads.map((u) => {
              const isSelected = u.id === selectedId;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => selectDraft(u)}
                  className={cn(
                    'flex w-full flex-col gap-1.5 px-4 py-3.5 text-left transition-colors cursor-pointer',
                    isSelected ? 'bg-[#172033]' : 'hover:bg-[#141A26]'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-1 text-sm font-medium text-slate-100">{u.title}</p>
                    <span
                      className={cn(
                        'shrink-0 text-xs font-medium capitalize',
                        u.status === 'uploaded'
                          ? 'text-emerald-400'
                          : u.status === 'failed'
                            ? 'text-red-400'
                            : 'text-amber-400'
                      )}
                    >
                      {u.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {u.isShort ? 'YouTube Short' : 'Regular Video'}
                    <span className="mx-1.5 text-slate-600">·</span>
                    <span className="font-mono tabular-nums">{formatDuration(u.clipDurationSec)}</span>
                    <span className="mx-1.5 text-slate-600">·</span>
                    <span className="capitalize">{u.visibility}</span>
                    <span className="mx-1.5 text-slate-600">·</span>
                    {formatRelativeTime(u.createdAt)}
                  </p>
                  {u.status === 'uploading' || u.progress > 0 ? (
                    <div className="pt-1">
                      <ProgressBar value={u.progress} tone={u.status === 'uploaded' ? 'emerald' : 'blue'} />
                    </div>
                  ) : null}
                  {u.errorMessage ? (
                    <p className="line-clamp-2 text-[11px] text-red-400">{u.errorMessage}</p>
                  ) : null}
                </button>
              );
            })}
          </Panel>

          {/* Right: Pre-Publish Review & Approval Panel */}
          <Panel className="p-5 xl:col-span-7">
            {selectedJob ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">Pre-Publish Review & Metadata</h2>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Format classification:{' '}
                      <span className="text-slate-200">
                        {selectedJob.isShort
                          ? 'YouTube Shorts (Vertical 9:16, ≤ 3 minutes)'
                          : 'Standard YouTube Video (> 3 minutes or 16:9)'}
                      </span>
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(selectedJob.id)}
                    className="text-slate-400 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>

                {/* Mandatory Preflight Checklist */}
                <div className="space-y-2 rounded-md border border-slate-800 bg-[#0B0F17] p-4 text-xs">
                  <p className="font-semibold text-slate-200">Publishing Safety Gates</p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-slate-400">1. Verified local MP4 render on disk</span>
                    <span className={selectedJob.clipHasVerifiedMedia ? 'text-emerald-400' : 'text-amber-400'}>
                      {selectedJob.clipHasVerifiedMedia ? 'Verified MP4' : 'Missing local MP4'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">2. Audio & background music review</span>
                    <span
                      className={
                        selectedJob.clipAudioReviewStatus === 'flagged' ? 'text-red-400' : 'text-emerald-400'
                      }
                    >
                      {selectedJob.clipAudioReviewStatus === 'flagged'
                        ? 'Blocked — Unresolved Audio Flag'
                        : `Passed (${selectedJob.clipAudioReviewStatus})`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">3. Official YouTube OAuth channel</span>
                    <span className={ytConn?.connected ? 'text-emerald-400' : 'text-amber-400'}>
                      {ytConn?.connected ? ytConn.channelTitle : 'Connect YouTube first'}
                    </span>
                  </div>
                </div>

                {selectedJob.youtubeUrl ? (
                  <div className="flex items-center justify-between rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-200">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span>Uploaded to YouTube successfully.</span>
                    </div>
                    <a
                      href={selectedJob.youtubeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium underline"
                    >
                      Open Video
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                ) : null}

                {selectedJob.errorMessage ? (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-200">
                    <p className="font-semibold text-red-300">Last Upload Error</p>
                    <p className="mt-1">{selectedJob.errorMessage}</p>
                  </div>
                ) : null}

                {/* Metadata Form */}
                <div className="space-y-3.5">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Title (max 100 chars)</label>
                    <Input
                      maxLength={100}
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Description</label>
                    <Textarea
                      rows={4}
                      value={draftDesc}
                      onChange={(e) => setDraftDesc(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Tags / Hashtags (comma separated)</label>
                    <Input
                      value={draftTags}
                      onChange={(e) => setDraftTags(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-300">Visibility (Default: Private)</label>
                      <Select
                        value={draftVisibility}
                        onChange={(e) => setDraftVisibility(e.target.value as YouTubeVisibility)}
                      >
                        <option value="private">Private (Recommended default)</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="public">Public (Requires confirmation)</option>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-300">Schedule Publish (Optional)</label>
                      <Input
                        type="datetime-local"
                        value={draftSchedule}
                        onChange={(e) => setDraftSchedule(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        const text = `${draftTitle}\n\n${draftDesc}\n\n${draftTags}`;
                        try {
                          await navigator.clipboard.writeText(text);
                          onNotify('Copied title, description, and hashtags — ready to paste into YouTube Studio!');
                        } catch {
                          onNotify('Could not copy to clipboard.', 'error');
                        }
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy for YouTube Studio
                    </Button>
                    {selectedJob.clipHasVerifiedMedia ? (
                      <a
                        href={`/api/media/clips/${encodeURIComponent(selectedJob.clipId)}/video?download=1`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-700 px-3 text-xs font-medium text-slate-200 hover:bg-[#161C28]"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download MP4
                      </a>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={handleSaveDraft} disabled={saving}>
                      {saving ? 'Saving...' : 'Save Draft'}
                    </Button>
                    <Button
                      size="sm"
                      disabled={publishingId === selectedJob.id || selectedJob.status === 'uploaded'}
                      onClick={() => triggerPublish(selectedJob, false)}
                    >
                      {selectedJob.status === 'failed' ? (
                        <RefreshCw className="h-3.5 w-3.5" />
                      ) : (
                        <UploadCloud className="h-3.5 w-3.5" />
                      )}
                      {publishingId === selectedJob.id
                        ? 'Uploading...'
                        : selectedJob.status === 'failed'
                          ? 'Retry API Upload'
                          : 'Upload via YouTube API'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Select an upload draft on the left to review and publish.</p>
            )}
          </Panel>
        </div>
      )}

      {/* Explicit Public Confirmation Modal */}
      {publicConfirmJob ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <Panel className="w-full max-w-md space-y-4 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <h3 className="text-sm font-semibold text-slate-100">Confirm Public YouTube Upload</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  You selected <strong className="text-slate-200">Public</strong> visibility for "{draftTitle}". Confirm that you own or have permission to publish both the video footage and audio, and that you reviewed all captions and copyright warnings.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-800 pt-3">
              <Button variant="secondary" size="sm" onClick={() => setPublicConfirmJob(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => triggerPublish(publicConfirmJob, true)}>
                <ShieldCheck className="h-3.5 w-3.5" />
                Confirm & Publish Publicly
              </Button>
            </div>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
