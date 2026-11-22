import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Save } from 'lucide-react';
import type { AppSettings, HypeEventRecord } from '../types/hypecut';
import { api } from '../lib/api';
import { cn, getHypeColorClass } from '../lib/utils';
import { Button, EmptyState, Input, Panel } from '../components/ui/primitives';

export function HypeAnalyticsView({
  includeDemo,
  onNotify,
  onSettingsUpdated,
}: {
  includeDemo: boolean;
  onNotify: (msg: string, tone?: 'info' | 'error') => void;
  onSettingsUpdated: (s: AppSettings) => void;
}) {
  const [events, setEvents] = useState<HypeEventRecord[]>([]);
  const [reactionBreakdown, setReactionBreakdown] = useState<{ reaction: string; count: number }[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | 'triggered' | 'extreme'>('all');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .getHypeAnalytics(includeDemo)
      .then((res) => {
        if (!active) return;
        setEvents(res.events);
        setReactionBreakdown(res.reactionBreakdown);
        setSettings(res.settings);
      })
      .catch((err) => onNotify(err instanceof Error ? err.message : 'Failed to load analytics', 'error'));
    return () => {
      active = false;
    };
  }, [includeDemo, onNotify]);

  const handleSaveTuning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await api.updateSettings({
        hypeThreshold: settings.hypeThreshold,
        cooldownSeconds: settings.cooldownSeconds,
        rollingWindowSeconds: settings.rollingWindowSeconds,
        baselineWindowSeconds: settings.baselineWindowSeconds,
      });
      setSettings(updated);
      onSettingsUpdated(updated);
      onNotify('Hype detection engine parameters saved and applied live.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save parameters.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const filteredEvents = events.filter((e) => {
    if (levelFilter === 'triggered' && !e.triggeredClip) return false;
    if (levelFilter === 'extreme' && e.score < 85) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        e.channelName.toLowerCase().includes(q) ||
        e.level.toLowerCase().includes(q) ||
        e.topReactions.join(' ').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const chartData = [...events].reverse().map((e) => ({
    time: new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    score: e.score,
    velocityPct: Math.max(0, e.velocityPct),
    mpm: e.mpm,
  }));

  return (
    <div className="space-y-6">
      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Panel className="p-5 lg:col-span-8">
          <div className="pb-4">
            <h2 className="text-base font-semibold text-slate-100">Hype Score & Chat Velocity Trend</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Rolling-window hype score (0–100) compared against percentage velocity spike over baseline
            </p>
          </div>
          {chartData.length > 0 ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" vertical={false} />
                  <XAxis dataKey="time" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="left" domain={[0, 100]} stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0E131D',
                      border: '1px solid rgba(148,163,184,0.2)',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                  <ReferenceLine
                    yAxisId="left"
                    y={settings?.hypeThreshold ?? 72}
                    stroke="#F59E0B"
                    strokeDasharray="4 4"
                  />
                  <Line yAxisId="left" type="monotone" dataKey="score" name="Hype Score" stroke="#3B82F6" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="velocityPct" name="Velocity +%" stroke="#10B981" strokeWidth={1.75} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="No hype events recorded"
              description="Monitor a live channel or run the Demo Simulator to populate analytics."
            />
          )}
        </Panel>

        <Panel className="p-5 lg:col-span-4">
          <div className="pb-4">
            <h2 className="text-base font-semibold text-slate-100">Top Trigger Reactions</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Most frequent repeated tokens across detected hype spikes
            </p>
          </div>
          {reactionBreakdown.length > 0 ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reactionBreakdown} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" horizontal={false} />
                  <XAxis type="number" stroke="#64748B" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis dataKey="reaction" type="category" stroke="#CBD5E1" fontSize={11} width={68} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0E131D',
                      border: '1px solid rgba(148,163,184,0.2)',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" name="Spike Occurrences" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-slate-400">No repeated reaction data available yet.</p>
          )}
        </Panel>
      </div>

      {/* Algorithm Tuning Form */}
      {settings ? (
        <Panel className="p-5">
          <form onSubmit={handleSaveTuning} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-100">Hype Engine Threshold & Rolling Window</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  100% local JavaScript algorithm — no external AI calls required. Cooldown and baseline comparison stop normally busy chat from spamming clips.
                </p>
              </div>
              <Button type="submit" size="sm" disabled={saving}>
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save Algorithm Rules'}
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Trigger Threshold (0–100)</label>
                <Input
                  type="number"
                  min={20}
                  max={99}
                  value={settings.hypeThreshold}
                  onChange={(e) => setSettings({ ...settings, hypeThreshold: Number(e.target.value) })}
                />
                <p className="text-[11px] text-slate-500">0–29 Normal · 50–69 High · 85+ Extreme</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Cooldown Between Clips (sec)</label>
                <Input
                  type="number"
                  min={5}
                  max={600}
                  value={settings.cooldownSeconds}
                  onChange={(e) => setSettings({ ...settings, cooldownSeconds: Number(e.target.value) })}
                />
                <p className="text-[11px] text-slate-500">Prevents duplicate consecutive clips</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Active Rolling Window (sec)</label>
                <Input
                  type="number"
                  min={5}
                  max={120}
                  value={settings.rollingWindowSeconds}
                  onChange={(e) => setSettings({ ...settings, rollingWindowSeconds: Number(e.target.value) })}
                />
                <p className="text-[11px] text-slate-500">Measures immediate reaction bursts</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Baseline Comparison Window (sec)</label>
                <Input
                  type="number"
                  min={30}
                  max={600}
                  value={settings.baselineWindowSeconds}
                  onChange={(e) => setSettings({ ...settings, baselineWindowSeconds: Number(e.target.value) })}
                />
                <p className="text-[11px] text-slate-500">Establishes normal chat pace</p>
              </div>
            </div>
          </form>
        </Panel>
      ) : null}

      {/* Hype Event History Table */}
      <Panel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Hype Event History</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Timestamped hype detections persisted in local SQLite
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter channel or reaction..."
              className="w-56"
            />
            <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#0B0F17] p-0.5">
              {(
                [
                  ['all', 'All'],
                  ['triggered', 'Clip Triggered'],
                  ['extreme', 'Extreme (85+)'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setLevelFilter(key)}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer',
                    levelFilter === key ? 'bg-[#1D2638] text-slate-100' : 'text-slate-400 hover:text-slate-200'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto border-t border-slate-800/80">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800/80 text-slate-400">
                <th className="py-2.5 pr-4 font-medium">Timestamp</th>
                <th className="py-2.5 pr-4 font-medium">Channel</th>
                <th className="py-2.5 pr-4 text-right font-medium">Score</th>
                <th className="py-2.5 pr-4 text-right font-medium">Msg / Min</th>
                <th className="py-2.5 pr-4 text-right font-medium">Velocity</th>
                <th className="py-2.5 pr-4 text-right font-medium">Unique Users</th>
                <th className="py-2.5 pr-4 font-medium">Top Reactions</th>
                <th className="py-2.5 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredEvents.slice(0, 30).map((evt) => (
                <tr key={evt.id} className="hover:bg-[#151B27]/60">
                  <td className="py-2.5 pr-4 font-mono text-slate-300 tabular-nums whitespace-nowrap">
                    {new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-200">{evt.channelName}</td>
                  <td className={cn('py-2.5 pr-4 text-right font-mono font-semibold tabular-nums', getHypeColorClass(evt.score))}>
                    {evt.score}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-slate-200 tabular-nums">{evt.mpm}</td>
                  <td className="py-2.5 pr-4 text-right font-mono text-slate-200 tabular-nums">
                    {evt.velocityPct >= 0 ? `+${evt.velocityPct}%` : `${evt.velocityPct}%`}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono text-slate-200 tabular-nums">{evt.uniqueUsers}</td>
                  <td className="py-2.5 pr-4 font-mono text-slate-400">
                    {evt.topReactions.slice(0, 3).join(' · ') || '—'}
                  </td>
                  <td className="py-2.5 whitespace-nowrap">
                    <span className={evt.triggeredClip ? 'text-emerald-400' : 'text-slate-500'}>
                      {evt.triggeredClip ? 'Highlight Saved' : 'Logged'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredEvents.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">No hype events match your current filters.</p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
