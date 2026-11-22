import React, { useEffect, useState } from 'react';
import { Flame, Play, Radio, Scissors, Square } from 'lucide-react';
import type { LiveMonitorState } from '../../server/services/twitchService';
import type { OAuthConnectionSummary } from '../types/hypecut';
import { api } from '../lib/api';
import { cn, formatDuration } from '../lib/utils';
import { HypeMeter } from '../components/HypeMeter';
import { Button, Input, MediaThumbnail, Panel } from '../components/ui/primitives';

export function LiveMonitorView({
  liveState,
  twitchConnection,
  hypeThreshold,
  onStateChange,
  onNotify,
  onOpenClipCreated,
}: {
  liveState: LiveMonitorState | null;
  twitchConnection: OAuthConnectionSummary | null;
  hypeThreshold: number;
  onStateChange: (next: LiveMonitorState) => void;
  onNotify: (msg: string, tone?: 'info' | 'error') => void;
  onOpenClipCreated: (clipId: string) => void;
}) {
  const [channelInput, setChannelInput] = useState(
    twitchConnection?.username || (liveState?.mode === 'twitch_public_irc' ? liveState.channelLogin : '') || 'shroud'
  );
  const [mode, setMode] = useState<'twitch_public' | 'demo' | 'twitch'>(
    twitchConnection?.connected ? 'twitch' : 'twitch_public'
  );
  const [busy, setBusy] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!liveState?.isMonitoring || !liveState.startedAt) {
      setElapsedSec(0);
      return;
    }
    const update = () => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - new Date(liveState.startedAt!).getTime()) / 1000)));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [liveState?.isMonitoring, liveState?.startedAt]);

  const handleStart = async () => {
    setBusy(true);
    try {
      const next = await api.startMonitor(mode, channelInput.trim());
      onStateChange(next);
      onNotify(
        mode === 'twitch'
          ? `Connected to Twitch EventSub for #${next.channelLogin}`
          : mode === 'twitch_public'
            ? `Connected to real live Twitch chat for #${next.channelLogin} (no API keys required).`
            : 'Demo stream simulator started — real JS Hype Engine active.'
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to start monitoring.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      const next = await api.stopMonitor();
      onStateChange(next);
      onNotify('Stream monitoring stopped.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to stop monitoring.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSpike = async () => {
    try {
      await api.triggerDemoSpike();
      onNotify('Injected high-velocity chat burst into Demo Simulator.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to trigger spike.', 'error');
    }
  };

  const handleManualCapture = async () => {
    setBusy(true);
    try {
      const res = await api.captureManualClip();
      onNotify('Highlight candidate saved to Generated Clips.');
      onOpenClipCreated(res.clipId);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Capture failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const snapshot = liveState?.snapshot ?? {
    score: 0,
    level: 'Normal' as const,
    messagesPerSecond: 0,
    messagesPerMinute: 0,
    baselineMpm: 20,
    velocityPercent: 0,
    uniqueUsers: 0,
    emoteActivity: 'Low' as const,
    emoteRatio: 0,
    repeatedReactions: 'Low' as const,
    topReactions: [],
    inCooldown: false,
    cooldownRemainingSec: 0,
    timestamp: new Date().toISOString(),
  };

  return (
    <div className="space-y-6">
      {/* Control Toolbar */}
      <Panel className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-1 flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Monitoring Source</label>
              <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-800 bg-[#0B0F17] p-0.5">
                <button
                  type="button"
                  onClick={() => setMode('twitch_public')}
                  className={cn(
                    'rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer',
                    mode === 'twitch_public' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'
                  )}
                >
                  Live Twitch Chat (No Keys)
                </button>
                <button
                  type="button"
                  onClick={() => setMode('demo')}
                  className={cn(
                    'rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer',
                    mode === 'demo' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'
                  )}
                >
                  Demo Simulator
                </button>
                <button
                  type="button"
                  onClick={() => setMode('twitch')}
                  className={cn(
                    'rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer',
                    mode === 'twitch' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'
                  )}
                >
                  Twitch EventSub (OAuth)
                </button>
              </div>
            </div>

            <div className="min-w-[220px] flex-1 space-y-1.5">
              <label htmlFor="channel-input" className="text-xs font-medium text-slate-400">
                {mode === 'demo' ? 'Simulated Channel Name' : 'Twitch Channel Name (or twitch.tv/name)'}
              </label>
              <Input
                id="channel-input"
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value)}
                placeholder={mode === 'demo' ? 'NovaStrike (Demo Channel)' : 'e.g. shroud, tarik, or your channel'}
                disabled={liveState?.isMonitoring}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!liveState?.isMonitoring ? (
              <Button onClick={handleStart} disabled={busy}>
                <Play className="h-4 w-4" />
                Start Monitoring
              </Button>
            ) : (
              <>
                {liveState.mode === 'demo_simulation' ? (
                  <Button variant="secondary" onClick={handleSpike}>
                    <Flame className="h-4 w-4 text-amber-400" />
                    Simulate Hype Spike
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={handleManualCapture} disabled={busy}>
                  <Scissors className="h-4 w-4" />
                  Save Moment Now
                </Button>
                <Button variant="destructive" onClick={handleStop} disabled={busy}>
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              </>
            )}
          </div>
        </div>

        {mode === 'twitch' && !twitchConnection?.connected ? (
          <p className="mt-3 text-xs text-amber-400">
            Twitch OAuth is not connected yet. Connect your Twitch account under Twitch Connections before starting real EventSub monitoring, or switch to Demo Simulator.
          </p>
        ) : null}
        {liveState?.lastError ? (
          <p className="mt-3 text-xs text-red-400">{liveState.lastError}</p>
        ) : null}
      </Panel>

      {/* Main 3-Panel Broadcast Workspace */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left/Center: Stream Video Monitor + Rolling Buffer Status */}
        <div className="space-y-6 xl:col-span-5">
          <Panel className="overflow-hidden">
            <div className="relative">
              <MediaThumbnail
                src="/src/assets/images/stream_preview_fps_1795360386447.jpg"
                alt="Monitored livestream canvas"
                fallbackLabel="Livestream Monitor"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-300">
                  <span className="flex items-center gap-1.5 font-medium text-white">
                    {liveState?.isMonitoring ? (
                      <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                    ) : null}
                    {liveState?.isMonitoring
                      ? liveState.mode === 'demo_simulation'
                        ? 'DEMO STREAM SIMULATION'
                        : liveState.mode === 'twitch_public_irc'
                          ? 'LIVE TWITCH CHAT (ZERO KEYS)'
                          : liveState.isLive
                            ? 'LIVE ON TWITCH'
                            : 'OFFLINE (CHAT LISTENING)'
                      : 'MONITOR STANDBY'}
                  </span>
                  <span className="font-mono tabular-nums">
                    Session {formatDuration(elapsedSec)}
                  </span>
                </div>
                <p className="mt-1 truncate text-base font-semibold text-white">
                  {liveState?.channelName || channelInput}
                </p>
                <p className="truncate text-xs text-slate-300">
                  {liveState?.streamTitle || 'Start monitoring to track live chat velocity and detect highlights.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 divide-x divide-slate-800/80 border-t border-slate-800/80 text-center">
              <div className="p-3">
                <p className="text-[11px] text-slate-400">Session Messages</p>
                <p className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums">
                  {(liveState?.totalMessages ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="p-3">
                <p className="text-[11px] text-slate-400">Auto Highlights</p>
                <p className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums">
                  {liveState?.clipsTriggered ?? 0}
                </p>
              </div>
              <div className="p-3">
                <p className="text-[11px] text-slate-400">Connection</p>
                <p className="mt-1 truncate px-1 text-xs font-medium text-slate-200">
                  {liveState?.isMonitoring
                    ? liveState.mode === 'twitch_eventsub'
                      ? 'EventSub WS'
                      : liveState.mode === 'twitch_public_irc'
                        ? 'Twitch IRC WS'
                        : 'Local Sim'
                    : 'Idle'}
                </p>
              </div>
            </div>
          </Panel>

          <Panel className="p-4">
            <h3 className="text-sm font-semibold text-slate-100">Video Capture & Rolling Buffer Note</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
              Twitch chat monitoring works immediately with zero API keys using Twitch's official read-only chat WebSocket. For 2–3 minute Highlights and 5-minute Extended Highlights, record your own authorized stream locally (e.g. OBS) and import recordings under Generated Clips.
            </p>
          </Panel>
        </div>

        {/* Middle: Live Hype Meter */}
        <Panel className="p-5 xl:col-span-3">
          <HypeMeter
            snapshot={snapshot}
            threshold={hypeThreshold}
            isDemo={liveState?.mode === 'demo_simulation' || !liveState?.isMonitoring}
          />
        </Panel>

        {/* Right: Real-Time Chat Stream */}
        <Panel className="flex h-[540px] flex-col xl:col-span-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 px-4 py-3">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-100">Live Chat Stream</h3>
            </div>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {snapshot.messagesPerSecond} msg/s
            </span>
          </div>

          <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
            {liveState && liveState.recentMessages.length > 0 ? (
              liveState.recentMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'rounded px-2.5 py-1.5 text-xs leading-relaxed',
                    msg.isReaction ? 'bg-blue-500/10 text-slate-100' : 'text-slate-300'
                  )}
                >
                  <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>{' '}
                  <span className="font-semibold text-blue-300">{msg.username}:</span>{' '}
                  <span>{msg.message}</span>
                  {msg.matchedReactions.length > 0 ? (
                    <span className="ml-2 font-mono text-[10px] text-amber-400">
                      [{msg.matchedReactions.join(', ')}]
                    </span>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-xs text-slate-400">
                <p>No live chat messages received yet.</p>
                <p className="mt-1 text-slate-500">
                  Start the Demo Simulator (and click Simulate Hype Spike) or connect Twitch EventSub.
                </p>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
