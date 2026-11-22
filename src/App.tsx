import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Film,
  LayoutDashboard,
  Menu,
  Radio,
  Scissors,
  Settings,
  Tv,
  UploadCloud,
  X,
  Youtube,
} from 'lucide-react';
import type {
  AppSettings,
  ChatMessageItem,
  ClipRecord,
  DashboardSummary,
  HypeSnapshot,
  NavSection,
  OAuthConnectionSummary,
} from './types/hypecut';
import type { LiveMonitorState } from '../server/services/twitchService';
import { api } from './lib/api';
import { cn } from './lib/utils';
import { Button } from './components/ui/primitives';
import { DashboardView } from './views/DashboardView';
import { LiveMonitorView } from './views/LiveMonitorView';
import { HypeAnalyticsView } from './views/HypeAnalyticsView';
import { GeneratedClipsView } from './views/GeneratedClipsView';
import { VideoEditorView } from './views/VideoEditorView';
import { UploadManagerView } from './views/UploadManagerView';
import { ConnectionsView } from './views/ConnectionsView';
import { SettingsView } from './views/SettingsView';

interface NavItem {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'live-monitor', label: 'Live Monitor', icon: Radio },
  { id: 'hype-analytics', label: 'Hype Analytics', icon: BarChart3 },
  { id: 'clips', label: 'Generated Clips', icon: Film },
  { id: 'editor', label: 'Video Editor', icon: Scissors },
  { id: 'uploads', label: 'Upload Manager', icon: UploadCloud },
  { id: 'youtube', label: 'YouTube Channels', icon: Youtube },
  { id: 'twitch', label: 'Twitch Connections', icon: Tv },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [section, setSection] = useState<NavSection>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [includeDemo, setIncludeDemo] = useState(true);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [liveState, setLiveState] = useState<LiveMonitorState | null>(null);
  const [twitchConn, setTwitchConn] = useState<OAuthConnectionSummary | null>(null);
  const [youtubeConn, setYoutubeConn] = useState<OAuthConnectionSummary | null>(null);
  const [appBaseUrl, setAppBaseUrl] = useState('http://localhost:3000');
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);

  const [activeJobProgress, setActiveJobProgress] = useState<{
    clipId: string;
    status: string;
    progress: number;
    errorMessage: string | null;
  } | null>(null);

  const [toast, setToast] = useState<{ id: number; message: string; tone: 'info' | 'error' } | null>(null);

  const notify = useCallback((message: string, tone: 'info' | 'error' = 'info') => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const refreshDashboard = useCallback(
    async (demoFlag = includeDemo) => {
      try {
        const data = await api.getDashboard(demoFlag);
        setSummary(data);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Failed to load dashboard', 'error');
      } finally {
        setLoadingDashboard(false);
      }
    },
    [includeDemo, notify]
  );

  const refreshOAuth = useCallback(async () => {
    try {
      const res = await api.getOAuthStatus();
      setTwitchConn(res.twitch);
      setYoutubeConn(res.youtube);
      setAppBaseUrl(res.appBaseUrl);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    void refreshOAuth();
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        setIncludeDemo(s.demoModeEnabled);
      })
      .catch(() => {});
    api
      .getMonitorState()
      .then((st) => setLiveState(st))
      .catch(() => {});
  }, [refreshOAuth]);

  useEffect(() => {
    void refreshDashboard(includeDemo);
  }, [includeDemo, section, refreshDashboard]);

  // Real-time Server-Sent Events subscription for live chat, hype updates, and FFmpeg worker jobs
  useEffect(() => {
    const es = new EventSource('/api/monitor/events');

    es.addEventListener('state', (evt) => {
      try {
        const next = JSON.parse((evt as MessageEvent).data) as LiveMonitorState;
        setLiveState(next);
      } catch {
        // Ignore
      }
    });

    es.addEventListener('hype', (evt) => {
      try {
        const snap = JSON.parse((evt as MessageEvent).data) as HypeSnapshot;
        setLiveState((prev) => (prev ? { ...prev, snapshot: snap } : prev));
      } catch {
        // Ignore
      }
    });

    es.addEventListener('chat', (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent).data) as {
          chatItem: ChatMessageItem;
          snapshot: HypeSnapshot;
          totalMessages: number;
        };
        setLiveState((prev) =>
          prev
            ? {
                ...prev,
                snapshot: payload.snapshot,
                totalMessages: payload.totalMessages,
                recentMessages: [payload.chatItem, ...prev.recentMessages].slice(0, 80),
              }
            : prev
        );
      } catch {
        // Ignore
      }
    });

    es.addEventListener('clip_triggered', (evt) => {
      try {
        const payload = JSON.parse((evt as MessageEvent).data) as {
          clipId: string;
          title: string;
          hypeScore: number;
        };
        notify(`Highlight triggered (${payload.hypeScore}/100): ${payload.title}`);
        void refreshDashboard(includeDemo);
      } catch {
        // Ignore
      }
    });

    es.addEventListener('job_update', (evt) => {
      try {
        const job = JSON.parse((evt as MessageEvent).data) as {
          clipId: string;
          jobType: string;
          status: string;
          progress: number;
          errorMessage: string | null;
        };
        setActiveJobProgress({
          clipId: job.clipId,
          status: job.status,
          progress: job.progress,
          errorMessage: job.errorMessage,
        });
        if (job.status === 'completed') {
          notify(
            job.jobType === 'render'
              ? 'Local FFmpeg MP4 render verified and saved.'
              : 'Local audio analysis complete.'
          );
          void refreshDashboard(includeDemo);
        } else if (job.status === 'failed' && job.errorMessage) {
          notify(job.errorMessage, 'error');
        }
      } catch {
        // Ignore
      }
    });

    return () => {
      es.close();
    };
  }, [includeDemo, notify, refreshDashboard]);

  const handleOpenEditor = useCallback((clip: ClipRecord) => {
    setSelectedClipId(clip.id);
    setSection('editor');
  }, []);

  const currentNav = NAV_ITEMS.find((i) => i.id === section) ?? NAV_ITEMS[0];

  const handleNavClick = (id: NavSection) => {
    setSection(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="flex min-h-screen bg-[#090C12] text-slate-100">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={cn(
          'hidden shrink-0 flex-col border-r border-slate-800/90 bg-[#0B0F17] transition-[width] duration-200 lg:flex',
          sidebarCollapsed ? 'w-[68px]' : 'w-[248px]'
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-800/90 px-4">
          {!sidebarCollapsed ? (
            <span className="font-display text-base font-bold tracking-tight text-white whitespace-nowrap">
              HypeCut AI
            </span>
          ) : (
            <Activity className="mx-auto h-5 w-5 text-blue-500" />
          )}
          {!sidebarCollapsed ? (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Collapse sidebar"
              className="rounded p-1 text-slate-400 hover:bg-[#161C28] hover:text-slate-100 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <nav className="flex-1 space-y-0.5 p-2.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 whitespace-nowrap cursor-pointer',
                  active
                    ? 'bg-blue-600/15 text-blue-400'
                    : 'text-slate-400 hover:bg-[#141A26] hover:text-slate-100',
                  sidebarCollapsed && 'justify-center px-0'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed ? <span className="truncate">{item.label}</span> : null}
              </button>
            );
          })}
        </nav>

        {sidebarCollapsed ? (
          <div className="border-t border-slate-800/90 p-2.5">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expand sidebar"
              className="flex w-full items-center justify-center rounded-md py-2 text-slate-400 hover:bg-[#161C28] hover:text-slate-100 cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="border-t border-slate-800/90 px-4 py-3 text-xs text-slate-500">
            Local Self-Hosted Edition
          </div>
        )}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-black/70" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative z-10 flex w-64 flex-col border-r border-slate-800 bg-[#0B0F17]">
            <div className="flex h-14 items-center justify-between border-b border-slate-800 px-4">
              <span className="font-display text-base font-bold text-white">HypeCut AI</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation"
                className="rounded p-1.5 text-slate-400 hover:bg-[#161C28] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavClick(item.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium',
                      active
                        ? 'bg-blue-600/15 text-blue-400'
                        : 'text-slate-300 hover:bg-[#141A26] hover:text-white'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      ) : null}

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Clean Contextual Top Bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-slate-800/90 bg-[#090C12]/95 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-md p-1.5 text-slate-400 hover:bg-[#161C28] hover:text-white lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm whitespace-nowrap">
              <span className="hidden text-slate-500 sm:inline">HypeCut AI</span>
              <span className="hidden text-slate-700 sm:inline">/</span>
              <h1 className="font-display text-sm font-semibold text-slate-100 sm:text-base">
                {currentNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {liveState?.isMonitoring ? (
              <button
                type="button"
                onClick={() => setSection('live-monitor')}
                className="hidden items-center gap-2 text-xs font-medium text-slate-200 hover:text-white sm:inline-flex cursor-pointer"
              >
                <span className="h-2 w-2 rounded-full bg-red-500" />
                <span className="font-mono tabular-nums">Hype {liveState.snapshot.score}/100</span>
              </button>
            ) : null}
            {section !== 'live-monitor' ? (
              <Button size="sm" onClick={() => setSection('live-monitor')}>
                <Radio className="h-3.5 w-3.5" />
                Live Monitor
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setSection('clips')}>
                <Film className="h-3.5 w-3.5" />
                Clips Library
              </Button>
            )}
          </div>
        </header>

        {/* Active Page Viewport */}
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 sm:p-6">
          {section === 'dashboard' ? (
            <DashboardView
              summary={summary}
              liveState={liveState}
              hypeThreshold={settings?.hypeThreshold ?? 72}
              loading={loadingDashboard}
              onNavigate={setSection}
              onOpenEditor={handleOpenEditor}
              includeDemo={includeDemo}
              onToggleDemoFilter={(next) => setIncludeDemo(next)}
            />
          ) : null}

          {section === 'live-monitor' ? (
            <LiveMonitorView
              liveState={liveState}
              twitchConnection={twitchConn}
              hypeThreshold={settings?.hypeThreshold ?? 72}
              onStateChange={setLiveState}
              onNotify={notify}
              onOpenClipCreated={(clipId) => {
                setSelectedClipId(clipId);
                void refreshDashboard(includeDemo);
              }}
            />
          ) : null}

          {section === 'hype-analytics' ? (
            <HypeAnalyticsView
              includeDemo={includeDemo}
              onNotify={notify}
              onSettingsUpdated={setSettings}
            />
          ) : null}

          {section === 'clips' ? (
            <GeneratedClipsView
              includeDemo={includeDemo}
              onOpenEditor={handleOpenEditor}
              onNavigateUploads={() => setSection('uploads')}
              onNotify={notify}
            />
          ) : null}

          {section === 'editor' ? (
            <VideoEditorView
              selectedClipId={selectedClipId}
              includeDemo={includeDemo}
              onSelectClipId={setSelectedClipId}
              onNavigateClips={() => setSection('clips')}
              onNavigateUploads={() => setSection('uploads')}
              onNotify={notify}
              activeJobProgress={activeJobProgress}
            />
          ) : null}

          {section === 'uploads' ? (
            <UploadManagerView
              includeDemo={includeDemo}
              onNavigateYouTube={() => setSection('youtube')}
              onNavigateClips={() => setSection('clips')}
              onNotify={notify}
            />
          ) : null}

          {section === 'youtube' ? (
            <ConnectionsView
              provider="youtube"
              connection={youtubeConn}
              appBaseUrl={appBaseUrl}
              onRefreshOAuth={refreshOAuth}
              onNotify={notify}
            />
          ) : null}

          {section === 'twitch' ? (
            <ConnectionsView
              provider="twitch"
              connection={twitchConn}
              appBaseUrl={appBaseUrl}
              onRefreshOAuth={refreshOAuth}
              onNotify={notify}
            />
          ) : null}

          {section === 'settings' ? (
            <SettingsView
              onNotify={notify}
              onSettingsUpdated={setSettings}
              onDataMutated={() => void refreshDashboard(includeDemo)}
            />
          ) : null}
        </main>
      </div>

      {/* Non-blocking Toast Banner */}
      {toast ? (
        <div
          role="status"
          className={cn(
            'fixed right-5 bottom-5 z-50 flex max-w-md items-center gap-3 rounded-lg border px-4 py-3 text-xs font-medium shadow-xl',
            toast.tone === 'error'
              ? 'border-red-500/40 bg-[#1B1014] text-red-200'
              : 'border-slate-700 bg-[#131924] text-slate-100'
          )}
        >
          <span className="flex-1 leading-relaxed">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
