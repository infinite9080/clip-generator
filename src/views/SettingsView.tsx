import React, { useEffect, useState } from 'react';
import { Database, FolderOpen, HardDrive, RefreshCw, Save, Trash2 } from 'lucide-react';
import type { AppSettings, SystemHealthStatus } from '../types/hypecut';
import { api } from '../lib/api';
import { formatBytes } from '../lib/utils';
import { Button, Input, Panel, Select, Switch } from '../components/ui/primitives';

export function SettingsView({
  onNotify,
  onSettingsUpdated,
  onDataMutated,
}: {
  onNotify: (msg: string, tone?: 'info' | 'error') => void;
  onSettingsUpdated: (s: AppSettings) => void;
  onDataMutated: () => void;
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [health, setHealth] = useState<SystemHealthStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const loadAll = React.useCallback(async () => {
    setChecking(true);
    try {
      const [s, h] = await Promise.all([api.getSettings(), api.getSystemHealth()]);
      setSettings(s);
      setHealth(h);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load settings', 'error');
    } finally {
      setChecking(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const updated = await api.updateSettings(settings);
      setSettings(updated);
      onSettingsUpdated(updated);
      const nextHealth = await api.getSystemHealth();
      setHealth(nextHealth);
      onNotify('All local settings saved to ./data/hypecut.db.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Unable to save settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCleanTemp = async () => {
    setCleaning(true);
    try {
      const res = await api.cleanupTemp();
      const nextHealth = await api.getSystemHealth();
      setHealth(nextHealth);
      onNotify(`Cleaned ${res.deletedFiles} temp file(s), freed ${formatBytes(res.freedBytes)}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Temp cleanup failed.', 'error');
    } finally {
      setCleaning(false);
    }
  };

  const handleSeedDemo = async () => {
    try {
      await api.seedDemoData();
      await loadAll();
      onDataMutated();
      onNotify('Demo sample streams, hype timeline, and clips restored.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to seed demo data.', 'error');
    }
  };

  const handleClearDemo = async () => {
    try {
      await api.clearDemoData();
      await loadAll();
      onDataMutated();
      onNotify('All demo sample records cleared from SQLite.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to clear demo data.', 'error');
    }
  };

  if (!settings) {
    return <div className="h-64 animate-pulse rounded-lg border border-slate-800 bg-[#111620]" />;
  }

  return (
    <form onSubmit={handleSave} className="max-w-5xl space-y-6">
      {/* Local Engine Health Diagnostics */}
      <Panel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Local PC Runtime Diagnostics (100% Free Stack)</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Verifies local FFmpeg binary, GPU NVENC availability, and local Ollama server without paid cloud services
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={loadAll} disabled={checking}>
            <RefreshCw className={checking ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            Re-check Local Tools
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-md border border-slate-800 bg-[#0B0F17] p-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-100">FFmpeg Video Engine</span>
              <span className={health?.ffmpeg.available ? 'font-medium text-emerald-400' : 'font-medium text-amber-400'}>
                {health?.ffmpeg.available ? 'Detected' : 'Not Detected'}
              </span>
            </div>
            <p className="mt-1.5 font-mono text-[11px] text-slate-400">
              {health?.ffmpeg.available
                ? health.ffmpeg.version
                : health?.ffmpeg.error || 'Install FFmpeg locally and set path below.'}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              NVIDIA NVENC GPU Encoder: {health?.ffmpeg.nvencSupported ? 'Available (RTX acceleration ready)' : 'CPU fallback (libx264)'}
            </p>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B0F17] p-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-100">Local Ollama AI Server</span>
              <span className={health?.ollama.available ? 'font-medium text-emerald-400' : 'font-medium text-slate-400'}>
                {health?.ollama.available ? 'Running Locally' : 'Offline (Rule-Based Fallback Active)'}
              </span>
            </div>
            <p className="mt-1.5 font-mono text-[11px] text-slate-400">
              {health?.ollama.available
                ? `Models installed: ${health.ollama.installedModels.join(', ') || 'None pulled yet (run ollama pull qwen2.5:7b)'}`
                : health?.ollama.error || 'Start Ollama locally on port 11434 for local LLM titles & summaries.'}
            </p>
          </div>
        </div>
      </Panel>

      {/* Ollama & FFmpeg Paths */}
      <Panel className="space-y-4 p-5">
        <h2 className="text-base font-semibold text-slate-100">Local AI & FFmpeg Configuration</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Ollama Server URL (Loopback Only)</label>
            <Input
              value={settings.ollamaBaseUrl}
              onChange={(e) => setSettings({ ...settings, ollamaBaseUrl: e.target.value })}
              placeholder="http://127.0.0.1:11434"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Local Ollama Model</label>
            {health && health.ollama.installedModels.length > 0 ? (
              <Select
                value={settings.ollamaModel}
                onChange={(e) => setSettings({ ...settings, ollamaModel: e.target.value })}
              >
                {Array.from(new Set([settings.ollamaModel, ...health.ollama.installedModels])).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                value={settings.ollamaModel}
                onChange={(e) => setSettings({ ...settings, ollamaModel: e.target.value })}
                placeholder="qwen2.5:7b"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">FFmpeg Binary Path</label>
            <Input
              value={settings.ffmpegPath}
              onChange={(e) => setSettings({ ...settings, ffmpegPath: e.target.value })}
              placeholder="ffmpeg or C:\ffmpeg\bin\ffmpeg.exe"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">FFprobe Binary Path</label>
            <Input
              value={settings.ffprobePath}
              onChange={(e) => setSettings({ ...settings, ffprobePath: e.target.value })}
              placeholder="ffprobe or C:\ffmpeg\bin\ffprobe.exe"
            />
          </div>
        </div>
      </Panel>

      {/* Clip Presets, Captions & Audio Defaults */}
      <Panel className="space-y-4 p-5">
        <h2 className="text-base font-semibold text-slate-100">Clip Presets, Buffers & Audio Pipeline</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Default Auto Preset</label>
            <Select
              value={settings.defaultPreset}
              onChange={(e) =>
                setSettings({ ...settings, defaultPreset: e.target.value as AppSettings['defaultPreset'] })
              }
            >
              <option value="quick_short">Quick Short (30s)</option>
              <option value="highlight">Highlight (2–3m)</option>
              <option value="extended">Extended (5m)</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Quick Short (sec)</label>
            <Input
              type="number"
              min={10}
              max={60}
              value={settings.quickShortDuration}
              onChange={(e) => setSettings({ ...settings, quickShortDuration: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Highlight (sec)</label>
            <Input
              type="number"
              min={60}
              max={180}
              value={settings.highlightDuration}
              onChange={(e) => setSettings({ ...settings, highlightDuration: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Extended (sec)</label>
            <Input
              type="number"
              min={181}
              max={600}
              value={settings.extendedDuration}
              onChange={(e) => setSettings({ ...settings, extendedDuration: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 border-t border-slate-800/80 pt-4 sm:grid-cols-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-slate-200">Auto-create highlight candidates</p>
              <p className="text-slate-400">Trigger when hype crosses threshold</p>
            </div>
            <Switch
              checked={settings.autoGenerateClips}
              onCheckedChange={(v) => setSettings({ ...settings, autoGenerateClips: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-slate-200">Auto audio loudness norm</p>
              <p className="text-slate-400">Target -14 LUFS broadcast level</p>
            </div>
            <Switch
              checked={settings.audioNormalize}
              onCheckedChange={(v) => setSettings({ ...settings, audioNormalize: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-slate-200">Auto scan for background music</p>
              <p className="text-slate-400">Flag uncertain segments for review</p>
            </div>
            <Switch
              checked={settings.autoFlagMusic}
              onCheckedChange={(v) => setSettings({ ...settings, autoFlagMusic: v })}
            />
          </div>
        </div>
      </Panel>

      {/* Local Storage & Demo Data Management */}
      <Panel className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Local Disk Storage & Demo Workspace</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              All files remain strictly on your local filesystem — zero cloud storage fees
            </p>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={handleCleanTemp} disabled={cleaning}>
            <Trash2 className="h-3.5 w-3.5" />
            {cleaning ? 'Cleaning...' : 'Clean ./storage/temp'}
          </Button>
        </div>

        {health ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded border border-slate-800 bg-[#0B0F17] p-3">
              <p className="flex items-center gap-1.5 text-slate-400">
                <Database className="h-3.5 w-3.5" />
                ./data/hypecut.db
              </p>
              <p className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums">
                {formatBytes(health.storage.databaseBytes)}
              </p>
            </div>
            <div className="rounded border border-slate-800 bg-[#0B0F17] p-3">
              <p className="flex items-center gap-1.5 text-slate-400">
                <FolderOpen className="h-3.5 w-3.5" />
                ./storage/recordings
              </p>
              <p className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums">
                {formatBytes(health.storage.recordingsBytes)} ({health.storage.recordingsCount})
              </p>
            </div>
            <div className="rounded border border-slate-800 bg-[#0B0F17] p-3">
              <p className="flex items-center gap-1.5 text-slate-400">
                <HardDrive className="h-3.5 w-3.5" />
                ./storage/clips
              </p>
              <p className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums">
                {formatBytes(health.storage.clipsBytes)} ({health.storage.clipsCount})
              </p>
            </div>
            <div className="rounded border border-slate-800 bg-[#0B0F17] p-3">
              <p className="flex items-center gap-1.5 text-slate-400">
                <Trash2 className="h-3.5 w-3.5" />
                ./storage/temp
              </p>
              <p className="mt-1 font-mono text-sm font-semibold text-slate-100 tabular-nums">
                {formatBytes(health.storage.tempBytes)} ({health.storage.tempCount})
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-4 text-xs">
          <p className="text-slate-400">
            Manage clearly labeled demo records separately from your real Twitch/local data.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={handleSeedDemo}>
              Restore Demo Samples
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleClearDemo}>
              Clear All Demo Data
            </Button>
          </div>
        </div>
      </Panel>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          <Save className="h-4 w-4" />
          {saving ? 'Saving Settings...' : 'Save All Settings'}
        </Button>
      </div>
    </form>
  );
}
