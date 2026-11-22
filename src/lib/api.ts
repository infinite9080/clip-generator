import type {
  AppSettings,
  ClipRecord,
  DashboardSummary,
  HypeEventRecord,
  OAuthConnectionSummary,
  SystemHealthStatus,
  UploadJobRecord,
  VideoJobRecord,
} from '../types/hypecut';
import type { LiveMonitorState } from '../../server/services/twitchService';

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  getDashboard: (includeDemo = true) =>
    apiJson<DashboardSummary>(`/api/dashboard?includeDemo=${includeDemo ? 'true' : 'false'}`),

  getSettings: () => apiJson<AppSettings>('/api/settings'),
  updateSettings: (patch: Partial<AppSettings>) =>
    apiJson<AppSettings>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  getSystemHealth: () => apiJson<SystemHealthStatus>('/api/system/health'),
  cleanupTemp: () => apiJson<{ deletedFiles: number; freedBytes: number }>('/api/system/cleanup-temp', { method: 'POST' }),
  seedDemoData: () => apiJson<{ ok: boolean }>('/api/system/demo-data/seed', { method: 'POST' }),
  clearDemoData: () => apiJson<{ ok: boolean }>('/api/system/demo-data/clear', { method: 'POST' }),

  getOAuthStatus: () =>
    apiJson<{
      twitch: OAuthConnectionSummary;
      youtube: OAuthConnectionSummary;
      appBaseUrl: string;
    }>('/api/oauth/status'),
  getTwitchOAuthUrl: () => apiJson<{ url: string; redirectUri: string }>('/api/oauth/twitch/url'),
  disconnectTwitch: () => apiJson<{ ok: boolean }>('/api/oauth/twitch', { method: 'DELETE' }),
  getYouTubeOAuthUrl: () => apiJson<{ url: string; redirectUri: string }>('/api/oauth/youtube/url'),
  disconnectYouTube: () => apiJson<{ ok: boolean }>('/api/oauth/youtube', { method: 'DELETE' }),

  getMonitorState: () => apiJson<LiveMonitorState>('/api/monitor/state'),
  startMonitor: (mode: 'twitch_public' | 'twitch' | 'demo', channel: string) =>
    apiJson<LiveMonitorState>('/api/monitor/start', {
      method: 'POST',
      body: JSON.stringify({ mode, channel }),
    }),
  stopMonitor: () => apiJson<LiveMonitorState>('/api/monitor/stop', { method: 'POST' }),
  triggerDemoSpike: () => apiJson<{ ok: boolean }>('/api/monitor/demo-spike', { method: 'POST' }),
  captureManualClip: () => apiJson<{ ok: boolean; clipId: string }>('/api/monitor/capture-now', { method: 'POST' }),

  getHypeAnalytics: (includeDemo = true) =>
    apiJson<{
      events: HypeEventRecord[];
      reactionBreakdown: { reaction: string; count: number }[];
      settings: AppSettings;
    }>(`/api/analytics/hype?includeDemo=${includeDemo ? 'true' : 'false'}`),

  getClips: (includeDemo = true) =>
    apiJson<{ clips: ClipRecord[]; jobs: VideoJobRecord[] }>(
      `/api/clips?includeDemo=${includeDemo ? 'true' : 'false'}`
    ),
  getClip: (id: string) => apiJson<ClipRecord>(`/api/clips/${encodeURIComponent(id)}`),
  updateClip: (id: string, patch: Partial<ClipRecord>) =>
    apiJson<ClipRecord>(`/api/clips/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteClip: (id: string) => apiJson<{ ok: boolean }>(`/api/clips/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  regenerateClipMetadata: (id: string) =>
    apiJson<{ clip: ClipRecord; metadata: { source: string; modelUsed: string | null } }>(
      `/api/clips/${encodeURIComponent(id)}/regenerate-metadata`,
      { method: 'POST' }
    ),
  renderClip: (id: string) =>
    apiJson<{ ok: boolean; jobId: string }>(`/api/clips/${encodeURIComponent(id)}/render`, { method: 'POST' }),
  scanClipAudio: (id: string) =>
    apiJson<{ ok: boolean; jobId: string }>(`/api/clips/${encodeURIComponent(id)}/scan-audio`, { method: 'POST' }),

  uploadLocalRecording: async (formData: FormData): Promise<ClipRecord> => {
    const res = await fetch('/api/recordings/upload', { method: 'POST', body: formData });
    const data = (await res.json().catch(() => ({}))) as ClipRecord & { error?: string };
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data;
  },
  generateLocalTestVideo: () =>
    apiJson<ClipRecord>('/api/recordings/generate-test', { method: 'POST' }),

  getUploads: (includeDemo = true) =>
    apiJson<{ uploads: UploadJobRecord[]; youtubeConnection: OAuthConnectionSummary }>(
      `/api/uploads?includeDemo=${includeDemo ? 'true' : 'false'}`
    ),
  createUploadJob: (payload: {
    clipId: string;
    title: string;
    description: string;
    tags: string[];
    visibility: 'private' | 'unlisted' | 'public';
    scheduledAt?: string | null;
    approvedByUser?: boolean;
  }) => apiJson<{ id: string; ok: boolean }>('/api/uploads', { method: 'POST', body: JSON.stringify(payload) }),
  updateUploadJob: (
    id: string,
    patch: Partial<{
      title: string;
      description: string;
      tags: string[];
      visibility: 'private' | 'unlisted' | 'public';
      scheduledAt: string | null;
    }>
  ) =>
    apiJson<{ ok: boolean }>(`/api/uploads/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  publishUploadJob: (id: string, confirmPublic = false) =>
    apiJson<{ ok: boolean }>(`/api/uploads/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ confirmPublic }),
    }),
  deleteUploadJob: (id: string) =>
    apiJson<{ ok: boolean }>(`/api/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
