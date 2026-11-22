export type NavSection =
  | 'dashboard'
  | 'live-monitor'
  | 'hype-analytics'
  | 'clips'
  | 'editor'
  | 'uploads'
  | 'youtube'
  | 'twitch'
  | 'settings';

export type HypeLevel = 'Normal' | 'Moderate' | 'High' | 'Very High' | 'Extreme';

export type ClipPreset = 'quick_short' | 'highlight' | 'extended';

export type AspectRatio = '9:16' | '16:9';

export type ClipStatus = 'queued' | 'processing' | 'ready' | 'failed';

export type AudioReviewStatus = 'pending' | 'clean' | 'flagged' | 'approved';

export type YouTubeStatus = 'not_uploaded' | 'awaiting_approval' | 'queued' | 'uploading' | 'uploaded' | 'failed';

export type YouTubeVisibility = 'private' | 'unlisted' | 'public';

export type ClipSourceType = 'local_upload' | 'twitch_clip' | 'demo_sample';

export interface AppSettings {
  ollamaBaseUrl: string;
  ollamaModel: string;
  ffmpegPath: string;
  ffprobePath: string;
  outputDir: string;
  hypeThreshold: number;
  cooldownSeconds: number;
  rollingWindowSeconds: number;
  baselineWindowSeconds: number;
  preBufferSeconds: number;
  postBufferSeconds: number;
  defaultPreset: ClipPreset;
  quickShortDuration: number;
  highlightDuration: number;
  extendedDuration: number;
  autoGenerateClips: boolean;
  captionTemplate: 'impact' | 'clean-box' | 'karaoke-pop' | 'minimal';
  audioNormalize: boolean;
  autoFlagMusic: boolean;
  tempRetentionHours: number;
  demoModeEnabled: boolean;
}

export interface CaptionCue {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  highlightWords: string[];
}

export interface CaptionConfig {
  enabled: boolean;
  template: 'impact' | 'clean-box' | 'karaoke-pop' | 'minimal';
  fontFamily: 'Plus Jakarta Sans' | 'DM Sans' | 'JetBrains Mono' | 'Impact';
  fontSize: number;
  position: 'top' | 'center' | 'bottom';
  textColor: string;
  highlightColor: string;
  backgroundColor: string;
  animation: 'word-pop' | 'fade-up' | 'slide-in' | 'none';
  cues: CaptionCue[];
}

export interface AudioFlagSegment {
  id: string;
  startSec: number;
  endSec: number;
  confidence: number;
  label: string;
  action: 'unreviewed' | 'mute' | 'replace_licensed' | 'keep_authorized';
  notes: string;
}

export interface EditConfig {
  cropMode: 'smart_center' | 'split_facecam' | 'gameplay_focus' | 'full_landscape';
  facecamRegion: { x: number; y: number; width: number; height: number };
  gameplayZoom: number;
  dynamicZoomOnPeak: boolean;
  removeSilences: boolean;
  normalizeAudio: boolean;
  introEnabled: boolean;
  outroEnabled: boolean;
  voiceGainDb: number;
  gameAudioDb: number;
  licensedTrackName: string | null;
}

export interface OAuthConnectionSummary {
  provider: 'twitch' | 'youtube';
  connected: boolean;
  configuredInEnv: boolean;
  accountId: string | null;
  username: string | null;
  displayName: string | null;
  channelTitle: string | null;
  avatarUrl: string | null;
  scopes: string[];
  expiresAt: string | null;
  connectedAt: string | null;
  redirectUriPath: string;
}

export interface MonitoredStream {
  id: string;
  channelLogin: string;
  channelName: string;
  gameName: string;
  streamTitle: string;
  isLive: boolean;
  isDemo: boolean;
  startedAt: string;
  endedAt: string | null;
  peakHype: number;
  avgHype: number;
  totalMessages: number;
  clipsGenerated: number;
  viewerCount: number;
}

export interface ChatMessageItem {
  id: string;
  streamId: string;
  username: string;
  message: string;
  emoteCount: number;
  isReaction: boolean;
  matchedReactions: string[];
  isDemo: boolean;
  timestamp: string;
}

export interface HypeSnapshot {
  score: number;
  level: HypeLevel;
  messagesPerSecond: number;
  messagesPerMinute: number;
  baselineMpm: number;
  velocityPercent: number;
  uniqueUsers: number;
  emoteActivity: 'Low' | 'Moderate' | 'High' | 'Very high';
  emoteRatio: number;
  repeatedReactions: 'Low' | 'Moderate' | 'High' | 'Extreme';
  topReactions: { token: string; count: number }[];
  inCooldown: boolean;
  cooldownRemainingSec: number;
  timestamp: string;
}

export interface HypeEventRecord {
  id: string;
  streamId: string;
  channelName: string;
  score: number;
  level: HypeLevel;
  mpm: number;
  mps: number;
  velocityPct: number;
  uniqueUsers: number;
  emoteRate: number;
  repeatedReactions: string;
  topReactions: string[];
  triggeredClip: boolean;
  isDemo: boolean;
  timestamp: string;
}

export interface ClipRecord {
  id: string;
  streamId: string | null;
  hypeEventId: string | null;
  channelName: string;
  title: string;
  description: string;
  hashtags: string[];
  thumbnailText: string;
  summary: string;
  metadataSource: 'ollama' | 'rule_based' | 'manual';
  preset: ClipPreset;
  aspectRatio: AspectRatio;
  durationSec: number;
  startSec: number;
  endSec: number;
  hypeScore: number;
  status: ClipStatus;
  sourceType: ClipSourceType;
  sourcePath: string | null;
  outputPath: string | null;
  thumbnailPath: string | null;
  hasVerifiedMedia: boolean;
  audioReviewStatus: AudioReviewStatus;
  audioFlags: AudioFlagSegment[];
  captionConfig: CaptionConfig;
  editConfig: EditConfig;
  youtubeStatus: YouTubeStatus;
  isDemo: boolean;
  streamDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoJobRecord {
  id: string;
  clipId: string;
  clipTitle: string;
  jobType: 'render' | 'audio_scan' | 'thumbnail';
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  logs: string;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  completedAt: string | null;
}

export interface UploadJobRecord {
  id: string;
  clipId: string;
  clipTitle: string;
  clipPreset: ClipPreset;
  clipDurationSec: number;
  clipAspectRatio: AspectRatio;
  clipAudioReviewStatus: AudioReviewStatus;
  clipHasVerifiedMedia: boolean;
  youtubeChannelTitle: string | null;
  title: string;
  description: string;
  tags: string[];
  visibility: YouTubeVisibility;
  isShort: boolean;
  scheduledAt: string | null;
  status: 'awaiting_approval' | 'queued' | 'uploading' | 'uploaded' | 'failed';
  progress: number;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  errorMessage: string | null;
  approvedByUser: boolean;
  isDemo: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface DashboardSummary {
  stats: {
    totalStreamsMonitored: number;
    currentLiveStreams: number;
    totalChatMessages: number;
    averageHypeScore: number;
    totalClipsGenerated: number;
    videosAwaitingReview: number;
    videosUploadedToYouTube: number;
    activeProcessingJobs: number;
  };
  includesDemoData: boolean;
  realClipsCount: number;
  demoClipsCount: number;
  hypeTimeline: {
    time: string;
    score: number;
    mpm: number;
    velocityPct: number;
    isDemo: boolean;
  }[];
  recentStreams: MonitoredStream[];
  recentClips: ClipRecord[];
  activeJobs: VideoJobRecord[];
  recentUploads: UploadJobRecord[];
}

export interface SystemHealthStatus {
  ffmpeg: {
    available: boolean;
    version: string | null;
    nvencSupported: boolean;
    binaryPath: string;
    error: string | null;
  };
  ollama: {
    available: boolean;
    baseUrl: string;
    configuredModel: string;
    installedModels: string[];
    error: string | null;
  };
  storage: {
    databaseBytes: number;
    recordingsBytes: number;
    clipsBytes: number;
    thumbnailsBytes: number;
    tempBytes: number;
    recordingsCount: number;
    clipsCount: number;
    tempCount: number;
  };
}
