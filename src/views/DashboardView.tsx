import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, Play, Radio, Scissors, UploadCloud } from 'lucide-react';
import type { ClipRecord, DashboardSummary, NavSection } from '../types/hypecut';
import type { LiveMonitorState } from '../../server/services/twitchService';
import {
  cn,
  formatCompactNumber,
  formatDuration,
  formatRelativeTime,
  getAudioReviewMeta,
  getClipStatusMeta,
  getHypeColorClass,
} from '../lib/utils';
import { Button, EmptyState, MediaThumbnail, Panel, ProgressBar } from '../components/ui/primitives';

export function DashboardView({
  summary,
  liveState,
  hypeThreshold,
  loading,
  onNavigate,
  onOpenEditor,
  onToggleDemoFilter,
  includeDemo,
}: {
  summary: DashboardSummary | null;
  liveState: LiveMonitorState | null;
  hypeThreshold: number;
  loading: boolean;
  onNavigate: (section: NavSection) => void;
  onOpenEditor: (clip: ClipRecord) => void;
  onToggleDemoFilter: (next: boolean) => void;
  includeDemo: boolean;
}) {
  if (loading && !summary) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-slate-800 bg-[#111620]" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-lg border border-slate-800 bg-[#111620]" />
      </div>
    );
  }

  const stats = summary?.stats ?? {
    totalStreamsMonitored: 0,
    currentLiveStreams: 0,
    totalChatMessages: 0,
    averageHypeScore: 0,
    totalClipsGenerated: 0,
    videosAwaitingReview: 0,
    videosUploadedToYouTube: 0,
    activeProcessingJobs: 0,
  };

  const currentHype = liveState?.isMonitoring ? liveState.snapshot.score : stats.averageHypeScore;

  return (
    <div className="space-y-6">
      {/* Honest Demo vs Live Data notice bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800/90 bg-[#111620] px-4 py-3">
        <div className="text-sm text-slate-300">
          <span className="font-medium text-slate-100">
            {includeDemo ? 'Demo + Local Workspace Data' : 'Live & Local Workspace Data Only'}
          </span>
          <span className="mx-2 text-slate-600">·</span>
          <span className="text-slate-400">
            {summary?.realClipsCount ?? 0} real clip(s) and {summary?.demoClipsCount ?? 0} demo sample(s) in local SQLite
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#0B0F17] p-0.5">
          <button
            type="button"
            onClick={() => onToggleDemoFilter(true)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer',
              includeDemo ? 'bg-[#1D2638] text-slate-100' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Include Demo
          </button>
          <button
            type="button"
            onClick={() => onToggleDemoFilter(false)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer',
              !includeDemo ? 'bg-[#1D2638] text-slate-100' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Real Data Only
          </button>
        </div>
      </div>

      {/* Primary 4-column KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Panel className="p-4">
          <p className="text-xs font-medium text-slate-400">
            {liveState?.isMonitoring ? 'Live Hype Score' : 'Average Hype Score'}
          </p>
          <div className="mt-2 flex items-baseline gap-1.5 font-mono tabular-nums">
            <span className={cn('text-3xl font-bold', getHypeColorClass(currentHype))}>{currentHype}</span>
            <span className="text-sm text-slate-500">/ 100</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {liveState?.isMonitoring
              ? `${liveState.snapshot.level} · ${liveState.snapshot.messagesPerMinute} msg/min`
              : `Trigger threshold ${hypeThreshold}/100`}
          </p>
        </Panel>

        <Panel className="p-4">
          <p className="text-xs font-medium text-slate-400">Clips Generated</p>
          <p className="mt-2 font-mono text-3xl font-bold text-slate-100 tabular-nums">
            {stats.totalClipsGenerated}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {stats.videosAwaitingReview} awaiting review · {stats.activeProcessingJobs} in render queue
          </p>
        </Panel>

        <Panel className="p-4">
          <p className="text-xs font-medium text-slate-400">Chat Messages Analyzed</p>
          <p className="mt-2 font-mono text-3xl font-bold text-slate-100 tabular-nums">
            {formatCompactNumber(stats.totalChatMessages + (liveState?.isMonitoring ? liveState.totalMessages : 0))}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {stats.totalStreamsMonitored} streams monitored · {stats.currentLiveStreams} active
          </p>
        </Panel>

        <Panel className="p-4">
          <p className="text-xs font-medium text-slate-400">Uploaded to YouTube</p>
          <p className="mt-2 font-mono text-3xl font-bold text-slate-100 tabular-nums">
            {stats.videosUploadedToYouTube}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {summary?.recentUploads.filter((u) => u.status === 'awaiting_approval').length ?? 0} draft(s) pending approval
          </p>
        </Panel>
      </div>

      {/* Main 2-column Focal Anchor: Hype Score Timeline + Live Stream Monitor Snapshot */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-stretch">
        <Panel className="flex flex-col p-5 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">Hype Score Timeline</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Rolling chat velocity & hype spikes across monitored sessions
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('hype-analytics')}>
              Full Analytics
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          {summary && summary.hypeTimeline.length > 0 ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary.hypeTimeline} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hypeBlueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
                  <XAxis dataKey="time" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0E131D',
                      border: '1px solid rgba(148,163,184,0.2)',
                      borderRadius: '6px',
                      fontSize: '12px',
                      color: '#F1F5F9',
                    }}
                  />
                  <ReferenceLine
                    y={hypeThreshold}
                    stroke="#F59E0B"
                    strokeDasharray="4 4"
                    label={{ value: `Trigger ${hypeThreshold}`, position: 'insideTopRight', fill: '#F59E0B', fontSize: 11 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="score"
                    name="Hype Score"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#hypeBlueFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="No hype timeline events recorded"
              description="Start Live Monitor or run the Demo Simulator to record real-time chat velocity and hype score peaks."
              action={
                <Button size="sm" onClick={() => onNavigate('live-monitor')}>
                  Open Live Monitor
                </Button>
              }
            />
          )}
        </Panel>

        {/* Live Monitor Snapshot */}
        <Panel className="flex flex-col justify-between p-5 lg:col-span-4">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-100">Stream Monitor</h2>
              <span
                className={cn(
                  'text-xs font-semibold',
                  liveState?.isMonitoring ? 'text-emerald-400' : 'text-slate-400'
                )}
              >
                {liveState?.isMonitoring
                  ? liveState.mode === 'twitch_eventsub'
                    ? 'Live EventSub'
                    : liveState.mode === 'twitch_public_irc'
                      ? 'Live Twitch'
                      : 'Demo Active'
                  : 'Standby'}
              </span>
            </div>

            <div className="relative mt-3 overflow-hidden rounded-md border border-slate-800">
              <MediaThumbnail
                src="/src/assets/images/stream_preview_fps_1795360386447.jpg"
                alt="Live broadcast feed preview"
                fallbackLabel="Broadcast Feed Preview"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-3">
                <p className="truncate text-sm font-semibold text-white">
                  {liveState?.channelName || 'NovaStrike (Demo Channel)'}
                </p>
                <p className="truncate text-xs text-slate-300">
                  {liveState?.gameName || 'Tactical Arena Championship'}
                  <span className="mx-1.5 text-slate-500">·</span>
                  {liveState?.isMonitoring ? `${liveState.snapshot.messagesPerMinute} msg/min` : 'Monitor idle'}
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              Connect an authorized Twitch account for EventSub chat monitoring, or test the rolling-window hype algorithm locally using simulated chat bursts.
            </p>
          </div>

          <div className="mt-4 flex gap-2">
            <Button className="flex-1" size="sm" onClick={() => onNavigate('live-monitor')}>
              <Radio className="h-3.5 w-3.5" />
              {liveState?.isMonitoring ? 'Inspect Feed' : 'Launch Monitor'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onNavigate('clips')}>
              <Scissors className="h-3.5 w-3.5" />
              Clips
            </Button>
          </div>
        </Panel>
      </div>

      {/* Bottom 2-Column Operational Tables: Recent Generated Clips & Processing/Upload Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Panel className="p-5 lg:col-span-7">
          <div className="flex items-center justify-between pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-100">Recent Generated Clips</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Review captions, check audio flags, or render verified local MP4s
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('clips')}>
              All Clips
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          {summary && summary.recentClips.length > 0 ? (
            <div className="divide-y divide-slate-800/80 border-t border-slate-800/80">
              {summary.recentClips.map((clip) => {
                const st = getClipStatusMeta(clip.status);
                const audio = getAudioReviewMeta(clip.audioReviewStatus);
                return (
                  <div
                    key={clip.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 transition-colors hover:bg-[#151B27]/60"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="w-20 shrink-0 overflow-hidden rounded border border-slate-800">
                        <MediaThumbnail
                          src={clip.thumbnailPath}
                          alt={clip.title}
                          fallbackLabel={clip.aspectRatio}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-100">{clip.title}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                          <span className="font-mono tabular-nums">{formatDuration(clip.durationSec)}</span>
                          <span className="text-slate-600">·</span>
                          <span className={cn('font-mono font-medium tabular-nums', getHypeColorClass(clip.hypeScore))}>
                            {clip.hypeScore} hype
                          </span>
                          <span className="text-slate-600">·</span>
                          <span className={st.colorClass}>{st.label}</span>
                          <span className="text-slate-600">·</span>
                          <span className={audio.colorClass}>{audio.label}</span>
                          {clip.isDemo ? (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="text-slate-500">Demo sample</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => onOpenEditor(clip)}>
                      <Play className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No clips in workspace"
              description="Upload an authorized local video recording or detect highlights from a monitored stream."
              action={
                <Button size="sm" onClick={() => onNavigate('clips')}>
                  Go to Clips Library
                </Button>
              }
            />
          )}
        </Panel>

        <Panel className="flex flex-col justify-between p-5 lg:col-span-5">
          <div className="space-y-5">
            {/* Background Render & Audio Jobs */}
            <div>
              <div className="flex items-center justify-between pb-3">
                <h2 className="text-base font-semibold text-slate-100">Background Worker Queue</h2>
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  {summary?.activeJobs.length ?? 0} recent
                </span>
              </div>
              {summary && summary.activeJobs.length > 0 ? (
                <div className="space-y-3 border-t border-slate-800/80 pt-3">
                  {summary.activeJobs.slice(0, 4).map((job) => (
                    <div key={job.id} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium text-slate-200">{job.clipTitle}</span>
                        <span className="font-mono text-slate-400 tabular-nums">
                          {job.jobType === 'render' ? 'FFmpeg' : 'Audio'} · {job.status} ({job.progress}%)
                        </span>
                      </div>
                      <ProgressBar
                        value={job.progress}
                        tone={
                          job.status === 'completed'
                            ? 'emerald'
                            : job.status === 'failed'
                              ? 'red'
                              : 'blue'
                        }
                      />
                      {job.errorMessage ? (
                        <p className="text-xs text-red-400">{job.errorMessage}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="border-t border-slate-800/80 pt-3 text-xs text-slate-400">
                  No local FFmpeg render or audio analysis jobs queued yet.
                </p>
              )}
            </div>

            {/* Recent YouTube Upload History */}
            <div className="border-t border-slate-800/80 pt-4">
              <div className="flex items-center justify-between pb-3">
                <h2 className="text-base font-semibold text-slate-100">Upload History</h2>
                <Button variant="ghost" size="sm" onClick={() => onNavigate('uploads')}>
                  Manage
                  <UploadCloud className="h-3.5 w-3.5" />
                </Button>
              </div>
              {summary && summary.recentUploads.length > 0 ? (
                <div className="divide-y divide-slate-800/70">
                  {summary.recentUploads.slice(0, 4).map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-slate-200">{u.title}</p>
                        <p className="text-slate-400">
                          {u.isShort ? 'YouTube Short' : 'Standard Video'} · {u.visibility} · {formatRelativeTime(u.createdAt)}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 font-medium capitalize',
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
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No YouTube upload drafts created yet.</p>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
