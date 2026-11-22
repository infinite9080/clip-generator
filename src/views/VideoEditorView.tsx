import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Film,
  Pause,
  Play,
  RefreshCw,
  Save,
  ShieldAlert,
  UploadCloud,
  Volume2,
} from 'lucide-react';
import type {
  AudioFlagSegment,
  CaptionConfig,
  ClipPreset,
  ClipRecord,
  EditConfig,
} from '../types/hypecut';
import { api } from '../lib/api';
import { cn, formatDuration, getAudioReviewMeta } from '../lib/utils';
import {
  Button,
  EmptyState,
  Input,
  MediaThumbnail,
  Panel,
  ProgressBar,
  Select,
  Switch,
  Textarea,
} from '../components/ui/primitives';

type InspectorTab = 'format' | 'captions' | 'audio' | 'metadata';

export function VideoEditorView({
  selectedClipId,
  includeDemo,
  onSelectClipId,
  onNavigateClips,
  onNavigateUploads,
  onNotify,
  activeJobProgress,
}: {
  selectedClipId: string | null;
  includeDemo: boolean;
  onSelectClipId: (id: string) => void;
  onNavigateClips: () => void;
  onNavigateUploads: () => void;
  onNotify: (msg: string, tone?: 'info' | 'error') => void;
  activeJobProgress: { clipId: string; status: string; progress: number; errorMessage: string | null } | null;
}) {
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [clip, setClip] = useState<ClipRecord | null>(null);
  const [tab, setTab] = useState<InspectorTab>('format');
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [scanningAudio, setScanningAudio] = useState(false);
  const [regeneratingMeta, setRegeneratingMeta] = useState(false);

  // Interactive preview playback clock (for caption timing preview even on demo frames)
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);

  useEffect(() => {
    api
      .getClips(includeDemo)
      .then((res) => {
        setClips(res.clips);
        const target =
          (selectedClipId && res.clips.find((c) => c.id === selectedClipId)) || res.clips[0] || null;
        if (target) {
          setClip(target);
          onSelectClipId(target.id);
        }
      })
      .catch((err) => onNotify(err instanceof Error ? err.message : 'Failed to load editor clips', 'error'));
  }, [includeDemo, selectedClipId, onSelectClipId, onNotify]);

  // Refresh clip when background FFmpeg/audio job completes
  useEffect(() => {
    if (
      activeJobProgress &&
      clip &&
      activeJobProgress.clipId === clip.id &&
      (activeJobProgress.status === 'completed' || activeJobProgress.status === 'failed')
    ) {
      setRendering(false);
      setScanningAudio(false);
      api
        .getClip(clip.id)
        .then((fresh) => setClip(fresh))
        .catch(() => {});
    }
  }, [activeJobProgress, clip]);

  // Preview caption playhead loop
  useEffect(() => {
    if (!isPlayingPreview || !clip) return;
    const duration = Math.max(5, clip.endSec - clip.startSec);
    const interval = setInterval(() => {
      setPlayheadSec((prev) => (prev + 0.25 >= duration ? 0 : Number((prev + 0.25).toFixed(2))));
    }, 250);
    return () => clearInterval(interval);
  }, [isPlayingPreview, clip]);

  if (!clip) {
    return (
      <EmptyState
        title="No clip selected for editing"
        description="Import an authorized local video recording or generate a highlight candidate first."
        action={<Button onClick={onNavigateClips}>Open Generated Clips</Button>}
      />
    );
  }

  const updateCaption = (patch: Partial<CaptionConfig>) => {
    setClip({ ...clip, captionConfig: { ...clip.captionConfig, ...patch } });
  };

  const updateEdit = (patch: Partial<EditConfig>) => {
    setClip({ ...clip, editConfig: { ...clip.editConfig, ...patch } });
  };

  const applyPreset = (preset: ClipPreset) => {
    const duration = preset === 'quick_short' ? 30 : preset === 'highlight' ? 165 : 300;
    const aspectRatio = preset === 'extended' ? '16:9' : '9:16';
    setClip({
      ...clip,
      preset,
      aspectRatio,
      endSec: clip.startSec + duration,
      durationSec: duration,
      editConfig: {
        ...clip.editConfig,
        cropMode: aspectRatio === '9:16' ? 'split_facecam' : 'full_landscape',
      },
    });
  };

  const handleSaveChanges = async () => {
    setSaving(true);
    try {
      const updated = await api.updateClip(clip.id, {
        title: clip.title,
        description: clip.description,
        hashtags: clip.hashtags,
        thumbnailText: clip.thumbnailText,
        preset: clip.preset,
        aspectRatio: clip.aspectRatio,
        startSec: clip.startSec,
        endSec: clip.endSec,
        audioReviewStatus: clip.audioReviewStatus,
        audioFlags: clip.audioFlags,
        captionConfig: clip.captionConfig,
        editConfig: clip.editConfig,
      });
      setClip(updated);
      onNotify('Editor settings saved to local SQLite.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to save changes.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRenderMp4 = async () => {
    setRendering(true);
    try {
      await handleSaveChanges();
      await api.renderClip(clip.id);
      onNotify('FFmpeg render job queued in background worker.');
    } catch (err) {
      setRendering(false);
      onNotify(err instanceof Error ? err.message : 'Failed to start render.', 'error');
    }
  };

  const handleScanAudio = async () => {
    setScanningAudio(true);
    try {
      await api.scanClipAudio(clip.id);
      onNotify('Local audio analysis job started.');
    } catch (err) {
      setScanningAudio(false);
      onNotify(err instanceof Error ? err.message : 'Failed to scan audio.', 'error');
    }
  };

  const handleRegenerateMetadata = async () => {
    setRegeneratingMeta(true);
    try {
      const res = await api.regenerateClipMetadata(clip.id);
      setClip(res.clip);
      onNotify(
        res.metadata.source === 'ollama'
          ? `Metadata generated locally using Ollama (${res.metadata.modelUsed}).`
          : 'Ollama offline — generated non-clickbait metadata with Rule-Based engine.'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Metadata generation failed.', 'error');
    } finally {
      setRegeneratingMeta(false);
    }
  };

  const handleUpdateAudioFlagAction = (flagId: string, action: AudioFlagSegment['action']) => {
    const nextFlags = clip.audioFlags.map((f) => (f.id === flagId ? { ...f, action } : f));
    const allResolved = nextFlags.every((f) => f.action !== 'unreviewed');
    setClip({
      ...clip,
      audioFlags: nextFlags,
      audioReviewStatus: allResolved ? 'approved' : 'flagged',
    });
  };

  const handleQueueUpload = async () => {
    try {
      await handleSaveChanges();
      await api.createUploadJob({
        clipId: clip.id,
        title: clip.title,
        description: clip.description,
        tags: clip.hashtags,
        visibility: 'private',
        approvedByUser: false,
      });
      onNotify('Sent to Upload Manager as a Private draft awaiting review.');
      onNavigateUploads();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not queue upload.', 'error');
    }
  };

  const activeDuration = Math.max(3, clip.endSec - clip.startSec);
  const currentCue =
    clip.captionConfig.cues.find((c) => playheadSec >= c.startSec && playheadSec <= c.endSec) ||
    clip.captionConfig.cues[0] ||
    null;

  const currentJobForClip =
    activeJobProgress && activeJobProgress.clipId === clip.id ? activeJobProgress : null;
  const audioMeta = getAudioReviewMeta(clip.audioReviewStatus);

  return (
    <div className="space-y-5">
      {/* Top Clip Selector & Primary Export Actions */}
      <Panel className="flex flex-wrap items-center justify-between gap-3 p-3.5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Select
            value={clip.id}
            onChange={(e) => {
              const found = clips.find((c) => c.id === e.target.value);
              if (found) {
                setClip(found);
                setPlayheadSec(0);
                onSelectClipId(found.id);
              }
            }}
            className="max-w-sm"
          >
            {clips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({formatDuration(c.durationSec)} · {c.aspectRatio})
              </option>
            ))}
          </Select>
          <span className="hidden text-xs text-slate-400 md:inline">
            {clip.hasVerifiedMedia ? 'Local source attached' : 'Preview-only sample (no MP4 attached)'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleSaveChanges} disabled={saving}>
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving...' : 'Save Edit'}
          </Button>
          <Button size="sm" onClick={handleRenderMp4} disabled={rendering}>
            <Film className="h-3.5 w-3.5" />
            {rendering ? 'Rendering...' : 'Render MP4 (FFmpeg)'}
          </Button>
          {clip.hasVerifiedMedia ? (
            <a
              href={`/api/media/clips/${encodeURIComponent(clip.id)}/video?download=1`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-700 px-3 text-xs font-medium text-slate-200 hover:bg-[#161C28]"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </a>
          ) : null}
          <Button variant="outline" size="sm" onClick={handleQueueUpload}>
            <UploadCloud className="h-3.5 w-3.5" />
            Send to Upload
          </Button>
        </div>
      </Panel>

      {/* Active FFmpeg / Audio Job Status Bar */}
      {currentJobForClip ? (
        <Panel className="p-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200">
              Background Worker: {currentJobForClip.status} ({currentJobForClip.progress}%)
            </span>
            {currentJobForClip.errorMessage ? (
              <span className="text-red-400">{currentJobForClip.errorMessage}</span>
            ) : null}
          </div>
          <div className="mt-2">
            <ProgressBar
              value={currentJobForClip.progress}
              tone={
                currentJobForClip.status === 'failed'
                  ? 'red'
                  : currentJobForClip.status === 'completed'
                    ? 'emerald'
                    : 'blue'
              }
            />
          </div>
        </Panel>
      ) : null}

      {/* Main Workspace Split: Preview + Timeline (Left) & Inspector (Right) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Video Canvas + Trim Timeline */}
        <div className="space-y-4 xl:col-span-7">
          <Panel className="flex flex-col items-center justify-center bg-[#07090E] p-5">
            {/* Aspect Ratio Frame */}
            <div
              className={cn(
                'relative overflow-hidden rounded-md border border-slate-700/80 bg-black shadow-2xl transition-all',
                clip.aspectRatio === '9:16' ? 'aspect-[9/16] w-[280px] sm:w-[310px]' : 'aspect-video w-full'
              )}
            >
              {clip.hasVerifiedMedia ? (
                <video
                  src={`/api/media/clips/${encodeURIComponent(clip.id)}/video`}
                  controls
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="relative h-full w-full">
                  <img
                    src={clip.thumbnailPath || '/src/assets/images/clip_thumb_clutch_1795360387509.jpg'}
                    alt={clip.title}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                    style={{
                      transform: `scale(${clip.editConfig.gameplayZoom})`,
                      transition: 'transform 200ms ease',
                    }}
                  />
                  {/* Split Facecam overlay guide for 9:16 */}
                  {clip.aspectRatio === '9:16' && clip.editConfig.cropMode === 'split_facecam' ? (
                    <div className="absolute inset-x-0 top-0 flex h-[30%] items-center justify-center border-b border-blue-400/50 bg-[#0B0F17]/65 text-[11px] font-medium text-blue-200">
                      Facecam Track Region (9:16 Split)
                    </div>
                  ) : null}
                </div>
              )}

              {/* Live Animated Word-by-Word Caption Preview */}
              {clip.captionConfig.enabled && currentCue ? (
                <div
                  className={cn(
                    'pointer-events-none absolute inset-x-3 flex justify-center text-center',
                    clip.captionConfig.position === 'top'
                      ? 'top-6'
                      : clip.captionConfig.position === 'center'
                        ? 'top-1/2 -translate-y-1/2'
                        : 'bottom-8'
                  )}
                >
                  <div
                    className="rounded px-3 py-1.5 font-extrabold leading-tight tracking-tight"
                    style={{
                      backgroundColor:
                        clip.captionConfig.template === 'minimal'
                          ? 'transparent'
                          : clip.captionConfig.backgroundColor,
                      fontSize: `${Math.max(14, Math.min(26, Math.round(clip.captionConfig.fontSize * 0.48)))}px`,
                      textShadow: '0 2px 6px rgba(0,0,0,0.9)',
                    }}
                  >
                    {currentCue.text.split(/\s+/).map((word, idx) => {
                      const highlighted = currentCue.highlightWords.some(
                        (hw) => hw.toUpperCase() === word.toUpperCase()
                      );
                      return (
                        <span
                          key={`${word}-${idx}`}
                          className="mx-0.5 inline-block"
                          style={{
                            color: highlighted ? clip.captionConfig.highlightColor : clip.captionConfig.textColor,
                          }}
                        >
                          {word}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Playback Controls */}
            <div className="mt-4 flex w-full items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsPlayingPreview((p) => !p)}
                >
                  {isPlayingPreview ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {isPlayingPreview ? 'Pause Captions' : 'Preview Captions'}
                </Button>
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  {formatDuration(playheadSec)} / {formatDuration(activeDuration)}
                </span>
              </div>
              <span className="text-xs text-slate-400">
                {clip.aspectRatio} · {clip.durationSec <= 180 && clip.aspectRatio === '9:16' ? 'Shorts Eligible' : 'Standard Video'}
              </span>
            </div>
          </Panel>

          {/* Visual Timeline & Trim Controls */}
          <Panel className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">Clip Timeline & Audio Track</h3>
              <span className={cn('text-xs font-medium', audioMeta.colorClass)}>{audioMeta.label}</span>
            </div>

            {/* Scrubber bar */}
            <div className="space-y-2">
              <div className="relative h-10 w-full overflow-hidden rounded border border-slate-800 bg-[#0B0F17]">
                {/* Video track block */}
                <div className="absolute inset-y-1 left-2 right-2 rounded bg-blue-600/20 border border-blue-500/40" />
                {/* Music warning segments */}
                {clip.audioFlags.map((f) => {
                  const leftPct = Math.min(95, Math.max(0, ((f.startSec - clip.startSec) / activeDuration) * 100));
                  const widthPct = Math.min(100 - leftPct, Math.max(6, ((f.endSec - f.startSec) / activeDuration) * 100));
                  return (
                    <div
                      key={f.id}
                      title={f.label}
                      className="absolute bottom-1 h-2.5 rounded-sm bg-amber-500/80"
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    />
                  );
                })}
                {/* Playhead line */}
                <div
                  className="absolute inset-y-0 w-0.5 bg-white"
                  style={{ left: `${Math.min(100, (playheadSec / activeDuration) * 100)}%` }}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Start Time (sec)</label>
                  <Input
                    type="number"
                    min={0}
                    value={clip.startSec}
                    onChange={(e) => {
                      const s = Math.max(0, Number(e.target.value));
                      setClip({
                        ...clip,
                        startSec: s,
                        durationSec: Math.max(2, Math.round(clip.endSec - s)),
                      });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">End Time (sec)</label>
                  <Input
                    type="number"
                    min={clip.startSec + 2}
                    value={clip.endSec}
                    onChange={(e) => {
                      const end = Math.max(clip.startSec + 2, Number(e.target.value));
                      setClip({
                        ...clip,
                        endSec: end,
                        durationSec: Math.round(end - clip.startSec),
                      });
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">Output Length</label>
                  <div className="flex h-9 items-center rounded-md border border-slate-800 bg-[#0B0F17] px-3 font-mono text-xs text-slate-200 tabular-nums">
                    {formatDuration(activeDuration)} ({Math.round(activeDuration)}s)
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {/* Right: Multi-tab Editing Inspector */}
        <Panel className="flex flex-col xl:col-span-5">
          <div className="flex items-center gap-1 border-b border-slate-800/90 p-2">
            {(
              [
                ['format', 'Format & Crop'],
                ['captions', 'Captions'],
                ['audio', 'Audio & Music'],
                ['metadata', 'AI Metadata'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  'flex-1 rounded px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer',
                  tab === key ? 'bg-[#1D2638] text-slate-100' : 'text-slate-400 hover:text-slate-200'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {tab === 'format' ? (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-300">Duration Preset</label>
                  <div className="grid grid-cols-1 gap-2">
                    {(
                      [
                        ['quick_short', 'Preset A: Quick Short', '30s · 9:16 vertical · Single fast reaction'],
                        ['highlight', 'Preset B: Highlight', '2–3 min · 9:16 vertical · Combined context'],
                        ['extended', 'Preset C: Extended Highlight', '5 min · 16:9 standard YouTube upload'],
                      ] as const
                    ).map(([key, title, desc]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => applyPreset(key)}
                        className={cn(
                          'flex flex-col rounded-md border px-3.5 py-2.5 text-left transition-colors cursor-pointer',
                          clip.preset === key
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-slate-800 bg-[#0B0F17] hover:border-slate-700'
                        )}
                      >
                        <span className="text-xs font-semibold text-slate-100">{title}</span>
                        <span className="mt-0.5 text-[11px] text-slate-400">{desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Aspect Ratio</label>
                    <Select
                      value={clip.aspectRatio}
                      onChange={(e) => setClip({ ...clip, aspectRatio: e.target.value as '9:16' | '16:9' })}
                    >
                      <option value="9:16">9:16 Vertical (Shorts)</option>
                      <option value="16:9">16:9 Landscape</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Framing / Crop Mode</label>
                    <Select
                      value={clip.editConfig.cropMode}
                      onChange={(e) =>
                        updateEdit({ cropMode: e.target.value as EditConfig['cropMode'] })
                      }
                    >
                      <option value="split_facecam">Split Facecam + Gameplay</option>
                      <option value="smart_center">Smart Center Action</option>
                      <option value="gameplay_focus">Gameplay Focus</option>
                      <option value="full_landscape">Full 16:9 Frame</option>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">Gameplay Zoom</span>
                    <span className="font-mono text-slate-400 tabular-nums">
                      {clip.editConfig.gameplayZoom.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={1.5}
                    step={0.02}
                    value={clip.editConfig.gameplayZoom}
                    onChange={(e) => updateEdit({ gameplayZoom: Number(e.target.value) })}
                    className="w-full accent-blue-500"
                  />
                </div>

                <div className="space-y-3 border-t border-slate-800/80 pt-4 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-200">Dynamic zoom on peak moment</p>
                      <p className="text-slate-400">Punch-in emphasis during hype surge</p>
                    </div>
                    <Switch
                      checked={clip.editConfig.dynamicZoomOnPeak}
                      onCheckedChange={(v) => updateEdit({ dynamicZoomOnPeak: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-200">Remove silent gaps</p>
                      <p className="text-slate-400">Trim dead air using FFmpeg silencedetect</p>
                    </div>
                    <Switch
                      checked={clip.editConfig.removeSilences}
                      onCheckedChange={(v) => updateEdit({ removeSilences: v })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-200">Normalize broadcast loudness (-14 LUFS)</p>
                      <p className="text-slate-400">Applies FFmpeg loudnorm filter</p>
                    </div>
                    <Switch
                      checked={clip.editConfig.normalizeAudio}
                      onCheckedChange={(v) => updateEdit({ normalizeAudio: v })}
                    />
                  </div>
                </div>
              </>
            ) : null}

            {tab === 'captions' ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-100">Animated Subtitles</p>
                    <p className="text-[11px] text-slate-400">Burned into MP4 via local FFmpeg ASS filter</p>
                  </div>
                  <Switch
                    checked={clip.captionConfig.enabled}
                    onCheckedChange={(v) => updateCaption({ enabled: v })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Caption Style</label>
                    <Select
                      value={clip.captionConfig.template}
                      onChange={(e) =>
                        updateCaption({ template: e.target.value as CaptionConfig['template'] })
                      }
                    >
                      <option value="impact">Impact Bold</option>
                      <option value="karaoke-pop">Word Pop Highlight</option>
                      <option value="clean-box">Clean Dark Box</option>
                      <option value="minimal">Minimal Shadow</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Position</label>
                    <Select
                      value={clip.captionConfig.position}
                      onChange={(e) =>
                        updateCaption({ position: e.target.value as CaptionConfig['position'] })
                      }
                    >
                      <option value="bottom">Lower Third</option>
                      <option value="center">Center Frame</option>
                      <option value="top">Upper Safe Zone</option>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Font Size</label>
                    <Input
                      type="number"
                      min={20}
                      max={72}
                      value={clip.captionConfig.fontSize}
                      onChange={(e) => updateCaption({ fontSize: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Text Color</label>
                    <Input
                      type="color"
                      value={clip.captionConfig.textColor}
                      onChange={(e) => updateCaption({ textColor: e.target.value })}
                      className="p-1"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Highlight Color</label>
                    <Input
                      type="color"
                      value={clip.captionConfig.highlightColor}
                      onChange={(e) => updateCaption({ highlightColor: e.target.value })}
                      className="p-1"
                    />
                  </div>
                </div>

                <div className="space-y-2.5 border-t border-slate-800/80 pt-4">
                  <p className="text-xs font-semibold text-slate-200">Subtitle Cues</p>
                  {clip.captionConfig.cues.map((cue, idx) => (
                    <div key={cue.id} className="space-y-1.5 rounded border border-slate-800 bg-[#0B0F17] p-3">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span>
                          Cue {idx + 1} · {cue.startSec}s – {cue.endSec}s
                        </span>
                      </div>
                      <Input
                        value={cue.text}
                        onChange={(e) => {
                          const nextCues = clip.captionConfig.cues.map((c) =>
                            c.id === cue.id ? { ...c, text: e.target.value } : c
                          );
                          updateCaption({ cues: nextCues });
                        }}
                      />
                      <Input
                        value={cue.highlightWords.join(', ')}
                        onChange={(e) => {
                          const words = e.target.value
                            .split(',')
                            .map((w) => w.trim())
                            .filter(Boolean);
                          const nextCues = clip.captionConfig.cues.map((c) =>
                            c.id === cue.id ? { ...c, highlightWords: words } : c
                          );
                          updateCaption({ cues: nextCues });
                        }}
                        placeholder="Highlight words (comma separated)"
                        className="h-8 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {tab === 'audio' ? (
              <>
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <p className="leading-relaxed">
                      Local audio detection flags sustained background music for review, but cannot guarantee copyright clearance. Only publish video and audio you own or have rights to use. Unresolved flags block YouTube upload.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-100">Audio & Music Inspection</p>
                    <p className={cn('text-xs', audioMeta.colorClass)}>{audioMeta.label}</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleScanAudio} disabled={scanningAudio}>
                    <Volume2 className="h-3.5 w-3.5" />
                    {scanningAudio ? 'Scanning...' : 'Run Audio Scan'}
                  </Button>
                </div>

                {clip.audioFlags.length > 0 ? (
                  <div className="space-y-3">
                    {clip.audioFlags.map((flag) => (
                      <div key={flag.id} className="space-y-2.5 rounded-md border border-slate-800 bg-[#0B0F17] p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                            <div>
                              <p className="text-xs font-semibold text-slate-100">{flag.label}</p>
                              <p className="mt-0.5 text-[11px] text-slate-400">{flag.notes}</p>
                            </div>
                          </div>
                          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                            {Math.round(flag.confidence * 100)}%
                          </span>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-slate-400">Resolution Action</label>
                          <Select
                            value={flag.action}
                            onChange={(e) =>
                              handleUpdateAudioFlagAction(flag.id, e.target.value as AudioFlagSegment['action'])
                            }
                          >
                            <option value="unreviewed">Unreviewed (Blocks YouTube Upload)</option>
                            <option value="mute">Mute Flagged Range During FFmpeg Render</option>
                            <option value="replace_licensed">Replace With Licensed Local Track</option>
                            <option value="keep_authorized">I Own / Have Permission (Approve)</option>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0B0F17] p-3.5 text-xs">
                    <div className="flex items-center gap-2 text-slate-300">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span>No background music warnings flagged.</span>
                    </div>
                    {clip.audioReviewStatus !== 'approved' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setClip({ ...clip, audioReviewStatus: 'approved' })}
                      >
                        Mark Approved
                      </Button>
                    ) : null}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 border-t border-slate-800/80 pt-4">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-300">Streamer Voice Gain (dB)</label>
                    <Input
                      type="number"
                      min={-12}
                      max={12}
                      value={clip.editConfig.voiceGainDb}
                      onChange={(e) => updateEdit({ voiceGainDb: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-300">Game Audio Mix (dB)</label>
                    <Input
                      type="number"
                      min={-24}
                      max={6}
                      value={clip.editConfig.gameAudioDb}
                      onChange={(e) => updateEdit({ gameAudioDb: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </>
            ) : null}

            {tab === 'metadata' ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-100">Local AI Metadata</p>
                    <p className="text-[11px] text-slate-400">
                      Source: {clip.metadataSource === 'ollama' ? 'Local Ollama LLM' : 'Rule-based local engine'}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleRegenerateMetadata}
                    disabled={regeneratingMeta}
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', regeneratingMeta && 'animate-spin')} />
                    Regenerate
                  </Button>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Video Title</label>
                    <Input
                      value={clip.title}
                      onChange={(e) => setClip({ ...clip, title: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Description</label>
                    <Textarea
                      rows={4}
                      value={clip.description}
                      onChange={(e) => setClip({ ...clip, description: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Hashtags (comma separated)</label>
                    <Input
                      value={clip.hashtags.join(', ')}
                      onChange={(e) =>
                        setClip({
                          ...clip,
                          hashtags: e.target.value
                            .split(',')
                            .map((h) => h.trim())
                            .filter(Boolean),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-300">Thumbnail Callout Text</label>
                    <Input
                      value={clip.thumbnailText}
                      onChange={(e) => setClip({ ...clip, thumbnailText: e.target.value })}
                    />
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}
