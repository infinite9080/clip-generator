import { appendLog } from '../storage.ts';

export interface OllamaHealth {
  available: boolean;
  baseUrl: string;
  configuredModel: string;
  installedModels: string[];
  error: string | null;
}

export interface GeneratedMetadata {
  title: string;
  description: string;
  hashtags: string[];
  thumbnailText: string;
  summary: string;
  source: 'ollama' | 'rule_based';
  modelUsed: string | null;
}

function validateSafeLocalOllamaUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid Ollama server URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Ollama URL must use http or https.');
  }

  const host = parsed.hostname.toLowerCase();
  const envAllowedHost = process.env.OLLAMA_BASE_URL
    ? (() => {
        try {
          return new URL(process.env.OLLAMA_BASE_URL).hostname.toLowerCase();
        } catch {
          return null;
        }
      })()
    : null;

  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  if (!isLoopback && (!envAllowedHost || host !== envAllowedHost)) {
    throw new Error('For security, Ollama server URL is restricted to localhost/127.0.0.1 or OLLAMA_BASE_URL.');
  }

  return parsed;
}

export async function checkOllamaHealth(baseUrl: string, configuredModel: string): Promise<OllamaHealth> {
  try {
    const safeUrl = validateSafeLocalOllamaUrl(baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${safeUrl.origin}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        available: false,
        baseUrl: safeUrl.origin,
        configuredModel,
        installedModels: [],
        error: `Ollama responded with HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const installedModels = (data.models ?? [])
      .map((m) => m.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);

    return {
      available: true,
      baseUrl: safeUrl.origin,
      configuredModel,
      installedModels,
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to reach local Ollama server';
    return {
      available: false,
      baseUrl,
      configuredModel,
      installedModels: [],
      error: msg.includes('abort') ? 'Ollama did not respond within 2.5s (not running locally)' : msg,
    };
  }
}

export async function generateHighlightMetadata(input: {
  ollamaBaseUrl: string;
  ollamaModel: string;
  channelName: string;
  gameName?: string;
  hypeScore: number;
  durationSec: number;
  preset: 'quick_short' | 'highlight' | 'extended';
  topReactions: string[];
  chatSamples?: string[];
}): Promise<GeneratedMetadata> {
  const isShort = input.durationSec <= 180 && input.preset !== 'extended';

  // Try local Ollama first (100% free, local)
  try {
    const safeUrl = validateSafeLocalOllamaUrl(input.ollamaBaseUrl);
    const prompt = [
      'You are a concise video metadata assistant for a Twitch streamer highlight tool.',
      'Return ONLY valid JSON with keys: title, description, hashtags (array of 4-6 strings starting with #), thumbnailText (2-4 uppercase words), summary (1 sentence).',
      'Rules: Be accurate, engaging, and avoid misleading clickbait.',
      `Channel: ${input.channelName}`,
      `Category: ${input.gameName || 'Live Stream Gameplay'}`,
      `Hype Score: ${input.hypeScore}/100`,
      `Format: ${isShort ? 'Vertical Short' : 'Standard YouTube Highlight'} (${input.durationSec}s)`,
      `Top Chat Reactions: ${input.topReactions.join(', ') || 'High activity'}`,
      `Sample Chat Messages: ${(input.chatSamples ?? []).slice(0, 6).join(' | ') || 'N/A'}`,
    ].join('\n');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(`${safeUrl.origin}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.ollamaModel,
        prompt,
        format: 'json',
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const payload = (await res.json()) as { response?: string };
      if (payload.response) {
        const parsed = JSON.parse(payload.response) as Partial<GeneratedMetadata>;
        if (parsed.title && parsed.description) {
          appendLog('INFO', 'ollama', `Generated metadata via local model ${input.ollamaModel}`);
          return {
            title: String(parsed.title).slice(0, 95),
            description: String(parsed.description).slice(0, 800),
            hashtags: Array.isArray(parsed.hashtags)
              ? parsed.hashtags.slice(0, 6).map((h) => (String(h).startsWith('#') ? String(h) : `#${String(h)}`))
              : buildRuleBasedMetadata(input).hashtags,
            thumbnailText: String(parsed.thumbnailText || 'HYPE MOMENT').slice(0, 28),
            summary: String(parsed.summary || parsed.description).slice(0, 240),
            source: 'ollama',
            modelUsed: input.ollamaModel,
          };
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ollama unavailable';
    appendLog('WARN', 'ollama', `Falling back to rule-based metadata generator: ${msg}`);
  }

  return buildRuleBasedMetadata(input);
}

export function buildRuleBasedMetadata(input: {
  channelName: string;
  gameName?: string;
  hypeScore: number;
  durationSec: number;
  preset: 'quick_short' | 'highlight' | 'extended';
  topReactions: string[];
}): GeneratedMetadata {
  const cleanChannel = input.channelName.replace(/\s*\(Demo Channel\)/i, '').trim() || 'Stream';
  const primaryReaction = input.topReactions[0] || 'HYPE';
  const isShort = input.durationSec <= 180 && input.preset !== 'extended';

  const variantSeed = Math.floor(Date.now() / 1000) % 4;
  const titleTemplates = isShort
    ? [
        `${cleanChannel} Triggers ${input.hypeScore}/100 Chat Spike (${primaryReaction} Moment)`,
        `Live Chat Erupts During ${cleanChannel}'s ${input.durationSec}s Highlight`,
        `${cleanChannel}: Unbelievable ${primaryReaction} Reaction Caught Live`,
        `Peak ${input.hypeScore} Hype Moment From ${cleanChannel}'s Stream`,
      ]
    : [
        `${cleanChannel} Extended Highlight — Full Sequence & Live Chat Reactions`,
        `Best ${Math.round(input.durationSec / 60)}-Minute Highlight From ${cleanChannel} (${input.hypeScore} Peak Hype)`,
        `${cleanChannel} Full Moment Breakdown & Back-to-Back Chat Surges`,
        `${cleanChannel} Stream Highlight Compilation — Top Live Reactions`,
      ];

  const title = titleTemplates[variantSeed];
  const gameLabel = input.gameName ? ` during ${input.gameName}` : '';
  const summary = `Captured automatically at ${input.hypeScore}/100 chat hype${gameLabel} with repeated ${input.topReactions.slice(0, 3).join(', ') || 'viewer'} reactions.`;
  const description = [
    summary,
    '',
    `Channel: ${cleanChannel}`,
    `Duration: ${input.durationSec}s (${isShort ? 'Vertical Short format' : 'Standard YouTube format'})`,
    `Generated locally with HypeCut AI (Rule-based metadata fallback — start local Ollama for LLM generation).`,
  ].join('\n');

  const baseTags = isShort
    ? ['#Shorts', '#TwitchHighlights', '#GamingClips', '#LiveReaction']
    : ['#TwitchHighlights', '#GamingHighlights', '#StreamMoments', '#Gameplay'];

  const reactionTag = primaryReaction.replace(/[^a-zA-Z0-9]/g, '');
  if (reactionTag.length >= 2) {
    baseTags.push(`#${reactionTag}`);
  }

  return {
    title,
    description,
    hashtags: Array.from(new Set(baseTags)).slice(0, 6),
    thumbnailText: `${primaryReaction} (${input.hypeScore})`.toUpperCase().slice(0, 24),
    summary,
    source: 'rule_based',
    modelUsed: null,
  };
}
