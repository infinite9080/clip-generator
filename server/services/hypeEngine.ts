import crypto from 'node:crypto';
import type { ChatMessageItem, HypeLevel, HypeSnapshot } from '../../src/types/hypecut.ts';

const REACTION_PATTERNS: Array<{ token: string; regex: RegExp; weight: number }> = [
  { token: 'OMG', regex: /\bomg+\b/i, weight: 1.4 },
  { token: 'NO WAY', regex: /\bno\s*way+\b/i, weight: 1.7 },
  { token: 'LOL', regex: /\b(lol+|lmao+|lmfao+)\b/i, weight: 1.1 },
  { token: 'W', regex: /(^|\s)w{1,4}($|\s|!)/i, weight: 1.2 },
  { token: 'LFG', regex: /\blfg+\b/i, weight: 1.6 },
  { token: 'INSANE', regex: /\binsane+\b/i, weight: 1.5 },
  { token: 'CLUTCH', regex: /\bclutch\b/i, weight: 1.6 },
  { token: 'CLIP IT', regex: /\bclip\s*(it|that)\b/i, weight: 1.9 },
  { token: 'POG', regex: /\b(pog+|poggers|pogchamp)\b/i, weight: 1.4 },
  { token: 'KEKW', regex: /\b(kekw|lulw|omegalul)\b/i, weight: 1.2 },
  { token: 'WHAT', regex: /\b(what+|bro\s*what|huh+)\b/i, weight: 1.2 },
  { token: 'GG', regex: /\bgg+s?\b/i, weight: 0.9 },
];

const EMOTE_TOKENS = new Set([
  'POG',
  'POGGERS',
  'POGCHAMP',
  'KEKW',
  'LULW',
  'OMEGALUL',
  'EZ',
  'CLAP',
  'MONKAS',
  'PEPEJAM',
  'HYPE',
  'W',
  'L',
  'PAUSECHAMP',
  'ICANT',
  'GIGACHAD',
  'FIRE',
  'SKULL',
]);

interface WindowMessage {
  timestampMs: number;
  username: string;
  emoteCount: number;
  matchedReactions: string[];
  reactionWeight: number;
  hasAllCapsBurst: boolean;
}

export interface HypeEngineConfig {
  rollingWindowSeconds: number;
  baselineWindowSeconds: number;
  hypeThreshold: number;
  cooldownSeconds: number;
}

export function analyzeChatMessage(rawMessage: string, twitchEmoteCount = 0): {
  emoteCount: number;
  matchedReactions: string[];
  reactionWeight: number;
  hasAllCapsBurst: boolean;
} {
  const words = rawMessage.trim().split(/\s+/).filter(Boolean);
  let inferredEmotes = twitchEmoteCount;

  for (const w of words) {
    const clean = w.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (EMOTE_TOKENS.has(clean)) {
      inferredEmotes += 1;
    }
  }

  const matchedReactions: string[] = [];
  let reactionWeight = 0;
  for (const p of REACTION_PATTERNS) {
    if (p.regex.test(rawMessage)) {
      matchedReactions.push(p.token);
      reactionWeight += p.weight;
    }
  }

  const letters = rawMessage.replace(/[^a-zA-Z]/g, '');
  const upperLetters = rawMessage.replace(/[^A-Z]/g, '');
  const hasAllCapsBurst = letters.length >= 6 && upperLetters.length / letters.length >= 0.72;

  return {
    emoteCount: inferredEmotes,
    matchedReactions,
    reactionWeight,
    hasAllCapsBurst,
  };
}

export function classifyHypeLevel(score: number): HypeLevel {
  if (score >= 85) return 'Extreme';
  if (score >= 70) return 'Very High';
  if (score >= 50) return 'High';
  if (score >= 30) return 'Moderate';
  return 'Normal';
}

export class HypeDetectionEngine {
  private messages: WindowMessage[] = [];
  private lastTriggerMs = 0;
  private lastTriggerFingerprint = '';
  private config: HypeEngineConfig;

  constructor(config: HypeEngineConfig) {
    this.config = { ...config };
  }

  updateConfig(config: Partial<HypeEngineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  reset(): void {
    this.messages = [];
    this.lastTriggerMs = 0;
    this.lastTriggerFingerprint = '';
  }

  ingest(input: {
    streamId: string;
    username: string;
    message: string;
    twitchEmoteCount?: number;
    isDemo: boolean;
    timestampMs?: number;
  }): { chatItem: ChatMessageItem; snapshot: HypeSnapshot; shouldTriggerClip: boolean } {
    const nowMs = input.timestampMs ?? Date.now();
    const analysis = analyzeChatMessage(input.message, input.twitchEmoteCount ?? 0);

    this.messages.push({
      timestampMs: nowMs,
      username: input.username.toLowerCase(),
      emoteCount: analysis.emoteCount,
      matchedReactions: analysis.matchedReactions,
      reactionWeight: analysis.reactionWeight,
      hasAllCapsBurst: analysis.hasAllCapsBurst,
    });

    this.prune(nowMs);
    const snapshot = this.computeSnapshot(nowMs);

    const topSignature = snapshot.topReactions
      .slice(0, 2)
      .map((r) => r.token)
      .join('+');

    const cooldownElapsed = nowMs - this.lastTriggerMs >= this.config.cooldownSeconds * 1000;
    const isDuplicateBurst =
      topSignature.length > 0 &&
      topSignature === this.lastTriggerFingerprint &&
      nowMs - this.lastTriggerMs < this.config.cooldownSeconds * 1400;

    let shouldTriggerClip = false;
    if (snapshot.score >= this.config.hypeThreshold && cooldownElapsed && !isDuplicateBurst) {
      shouldTriggerClip = true;
      this.lastTriggerMs = nowMs;
      this.lastTriggerFingerprint = topSignature;
    }

    const chatItem: ChatMessageItem = {
      id: `msg-${crypto.randomBytes(6).toString('hex')}`,
      streamId: input.streamId,
      username: input.username,
      message: input.message,
      emoteCount: analysis.emoteCount,
      isReaction: analysis.matchedReactions.length > 0 || analysis.hasAllCapsBurst,
      matchedReactions: analysis.matchedReactions,
      isDemo: input.isDemo,
      timestamp: new Date(nowMs).toISOString(),
    };

    return { chatItem, snapshot, shouldTriggerClip };
  }

  computeSnapshot(nowMs = Date.now()): HypeSnapshot {
    this.prune(nowMs);
    const rollingMs = Math.max(5, this.config.rollingWindowSeconds) * 1000;
    const baselineMs = Math.max(30, this.config.baselineWindowSeconds) * 1000;

    const recent = this.messages.filter((m) => nowMs - m.timestampMs <= rollingMs);
    const older = this.messages.filter(
      (m) => nowMs - m.timestampMs > rollingMs && nowMs - m.timestampMs <= rollingMs + baselineMs
    );

    const rollingSec = rollingMs / 1000;
    const baselineSec = baselineMs / 1000;

    const mps = recent.length / rollingSec;
    const mpm = Math.round(mps * 60);

    // Baseline MPM prevents normal busy chats from constantly triggering clips
    const rawBaselineMpm = older.length > 0 ? (older.length / baselineSec) * 60 : Math.max(24, mpm * 0.45);
    const baselineMpm = Math.max(18, Math.round(rawBaselineMpm));

    const velocityRatio = baselineMpm > 0 ? mpm / baselineMpm : 1;
    const velocityPercent = Math.round((velocityRatio - 1) * 100);

    const uniqueUserSet = new Set(recent.map((m) => m.username));
    const uniqueUsers = uniqueUserSet.size;

    const totalEmotes = recent.reduce((acc, m) => acc + m.emoteCount, 0);
    const emoteRatio = recent.length > 0 ? totalEmotes / recent.length : 0;

    const reactionCounts = new Map<string, number>();
    let totalReactionWeight = 0;
    let capsBursts = 0;

    for (const m of recent) {
      totalReactionWeight += m.reactionWeight;
      if (m.hasAllCapsBurst) capsBursts += 1;
      for (const token of m.matchedReactions) {
        reactionCounts.set(token, (reactionCounts.get(token) ?? 0) + 1);
      }
    }

    const topReactions = Array.from(reactionCounts.entries())
      .map(([token, count]) => ({ token, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const repeatedDensity =
      recent.length > 0
        ? (topReactions.slice(0, 3).reduce((acc, r) => acc + r.count, 0) + capsBursts * 0.5) / recent.length
        : 0;

    // 5-factor weighted scoring (0-100):
    // 1. Spike velocity vs rolling baseline (up to 34 pts)
    const velocityScore = Math.min(34, Math.max(0, (velocityRatio - 0.85) * 16));
    // 2. Absolute message intensity log-scaled (up to 22 pts)
    const intensityScore = Math.min(22, Math.log10(1 + mpm) * 7.8);
    // 3. Unique reacting users breadth (up to 16 pts)
    const uniqueScore = Math.min(16, Math.sqrt(uniqueUsers) * 2.1);
    // 4. Emote frequency density (up to 12 pts)
    const emoteScore = Math.min(12, emoteRatio * 11);
    // 5. Repeated reaction clusters & excitement vocabulary (up to 16 pts)
    const reactionScore = Math.min(
      16,
      repeatedDensity * 14 + Math.min(6, (totalReactionWeight / Math.max(1, recent.length)) * 4)
    );

    const score =
      recent.length === 0
        ? 0
        : Math.max(0, Math.min(100, Math.round(velocityScore + intensityScore + uniqueScore + emoteScore + reactionScore)));

    const emoteActivity: HypeSnapshot['emoteActivity'] =
      emoteRatio >= 0.85 ? 'Very high' : emoteRatio >= 0.5 ? 'High' : emoteRatio >= 0.2 ? 'Moderate' : 'Low';

    const repeatedReactions: HypeSnapshot['repeatedReactions'] =
      repeatedDensity >= 0.72 ? 'Extreme' : repeatedDensity >= 0.45 ? 'High' : repeatedDensity >= 0.2 ? 'Moderate' : 'Low';

    const cooldownRemainingMs = Math.max(0, this.config.cooldownSeconds * 1000 - (nowMs - this.lastTriggerMs));

    return {
      score,
      level: classifyHypeLevel(score),
      messagesPerSecond: Number(mps.toFixed(1)),
      messagesPerMinute: mpm,
      baselineMpm,
      velocityPercent,
      uniqueUsers,
      emoteActivity,
      emoteRatio: Number(emoteRatio.toFixed(2)),
      repeatedReactions,
      topReactions,
      inCooldown: cooldownRemainingMs > 0 && this.lastTriggerMs > 0,
      cooldownRemainingSec: Math.ceil(cooldownRemainingMs / 1000),
      timestamp: new Date(nowMs).toISOString(),
    };
  }

  private prune(nowMs: number): void {
    const maxAgeMs = (this.config.rollingWindowSeconds + this.config.baselineWindowSeconds + 15) * 1000;
    const cutoff = nowMs - maxAgeMs;
    if (this.messages.length > 0 && this.messages[0].timestampMs < cutoff) {
      this.messages = this.messages.filter((m) => m.timestampMs >= cutoff);
    }
  }
}
