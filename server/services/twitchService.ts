import crypto from 'node:crypto';
import WebSocket from 'ws';
import type { ChatMessageItem, HypeSnapshot } from '../../src/types/hypecut.ts';
import {
  createDefaultCaptionConfig,
  createDefaultEditConfig,
  db,
  getOAuthTokens,
  getSettings,
  saveOAuthConnection,
} from '../db.ts';
import { appendLog } from '../storage.ts';
import { HypeDetectionEngine } from './hypeEngine.ts';
import { generateHighlightMetadata } from './ollamaService.ts';

const TWITCH_SCOPES = [
  'user:read:chat',
  'clips:edit',
  'channel:read:stream_key',
];

const pendingOAuthStates = new Map<string, number>();

export interface LiveMonitorState {
  isMonitoring: boolean;
  mode: 'idle' | 'twitch_public_irc' | 'twitch_eventsub' | 'demo_simulation';
  streamId: string | null;
  channelLogin: string;
  channelName: string;
  gameName: string;
  streamTitle: string;
  isLive: boolean;
  viewerCount: number;
  startedAt: string | null;
  totalMessages: number;
  clipsTriggered: number;
  connectionStatus: string;
  lastError: string | null;
  snapshot: HypeSnapshot;
  recentMessages: ChatMessageItem[];
}

type MonitorListener = (event: {
  type: 'state' | 'chat' | 'hype' | 'clip_triggered';
  payload: unknown;
}) => void;

const DEMO_USERS = [
  'vortex_gg',
  'kairo_live',
  'pixeldrift',
  'mira_fps',
  'zenith99',
  'tactical_jay',
  'nyx_plays',
  'cobalt_k',
  'solaris_tv',
  'echo_frag',
  'riven_main',
  'blitz_op',
  'nova_fan42',
  'sable_xd',
  'hyperion_eu',
  'draco_mid',
  'flux_gg',
  'orion_gg',
];

const DEMO_NORMAL_MESSAGES = [
  'good rotation to mid',
  'nice crossfire setup',
  'what sensitivity are you running today?',
  'audio sounds super clean today',
  'watch the flank on B site',
  'solid economy round',
  'GG nice try last round',
  'is this ranked finals?',
  'great callout',
  'W stream tonight',
];

const DEMO_HYPE_MESSAGES = [
  'NO WAY HE ACTUALLY HIT THAT!!',
  'OMG OMG OMG CLUTCH!!',
  'CLIP IT CLIP IT!! POG',
  'WHAT DID I JUST WATCH LFG!!',
  'INSANE 1V4 CLUTCH WWWW',
  'NO WAY!! KEKW POGGERS',
  'LFG!! THAT WAS INSANE!!',
  'CLIP THAT RIGHT NOW OMG',
  'W W W W W CLUTCH GOD',
  'NO WAY BRO WHAT A FLICK!!',
  'POGCHAMP INSANE PLAY!!',
  'LOL THEY HAD NO CHANCE LFG',
];

export class TwitchMonitorManager {
  private engine: HypeDetectionEngine;
  private listeners = new Set<MonitorListener>();
  private demoInterval: NodeJS.Timeout | null = null;
  private tickInterval: NodeJS.Timeout | null = null;
  private eventSubWs: WebSocket | null = null;
  private spikeRemainingTicks = 0;

  private state: LiveMonitorState;

  constructor() {
    const settings = getSettings();
    this.engine = new HypeDetectionEngine({
      rollingWindowSeconds: settings.rollingWindowSeconds,
      baselineWindowSeconds: settings.baselineWindowSeconds,
      hypeThreshold: settings.hypeThreshold,
      cooldownSeconds: settings.cooldownSeconds,
    });

    this.state = {
      isMonitoring: false,
      mode: 'idle',
      streamId: null,
      channelLogin: 'novastrike_demo',
      channelName: 'NovaStrike (Demo Channel)',
      gameName: 'Tactical Arena Championship',
      streamTitle: 'Idle — Click Start Monitoring or Demo Simulation',
      isLive: false,
      viewerCount: 0,
      startedAt: null,
      totalMessages: 0,
      clipsTriggered: 0,
      connectionStatus: 'Idle',
      lastError: null,
      snapshot: this.engine.computeSnapshot(),
      recentMessages: [],
    };
  }

  subscribe(listener: MonitorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(type: 'state' | 'chat' | 'hype' | 'clip_triggered', payload: unknown): void {
    for (const listener of this.listeners) {
      try {
        listener({ type, payload });
      } catch {
        // Ignore dead listener
      }
    }
  }

  syncSettings(): void {
    const s = getSettings();
    this.engine.updateConfig({
      rollingWindowSeconds: s.rollingWindowSeconds,
      baselineWindowSeconds: s.baselineWindowSeconds,
      hypeThreshold: s.hypeThreshold,
      cooldownSeconds: s.cooldownSeconds,
    });
  }

  getState(): LiveMonitorState {
    return {
      ...this.state,
      snapshot: this.engine.computeSnapshot(),
    };
  }

  buildTwitchAuthUrl(baseUrl: string): { url: string; redirectUri: string } {
    const clientId = process.env.TWITCH_CLIENT_ID;
    if (!clientId || !process.env.TWITCH_CLIENT_SECRET) {
      throw new Error('TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are not configured in environment variables.');
    }
    const redirectUri = `${baseUrl.replace(/\/$/, '')}/auth/twitch/callback`;
    const state = crypto.randomBytes(24).toString('hex');
    pendingOAuthStates.set(state, Date.now() + 10 * 60 * 1000);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: TWITCH_SCOPES.join(' '),
      state,
      force_verify: 'true',
    });

    return {
      url: `https://id.twitch.tv/oauth2/authorize?${params.toString()}`,
      redirectUri,
    };
  }

  async handleTwitchCallback(code: string, state: string, baseUrl: string): Promise<void> {
    const expiry = pendingOAuthStates.get(state);
    if (!expiry || expiry < Date.now()) {
      throw new Error('Invalid or expired OAuth state parameter.');
    }
    pendingOAuthStates.delete(state);

    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('Twitch OAuth credentials are missing on the server.');
    }

    const redirectUri = `${baseUrl.replace(/\/$/, '')}/auth/twitch/callback`;
    const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Twitch token exchange failed (${tokenRes.status}): ${text}`);
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string[];
    };

    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Client-Id': clientId,
      },
    });

    if (!userRes.ok) {
      throw new Error(`Failed to fetch Twitch profile (${userRes.status})`);
    }

    const userData = (await userRes.json()) as {
      data?: Array<{
        id: string;
        login: string;
        display_name: string;
        profile_image_url?: string;
      }>;
    };
    const user = userData.data?.[0];
    if (!user) throw new Error('No Twitch user returned by Helix API.');

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    saveOAuthConnection({
      provider: 'twitch',
      accountId: user.id,
      username: user.login,
      displayName: user.display_name,
      channelTitle: user.display_name,
      avatarUrl: user.profile_image_url || null,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || null,
      scopes: tokenData.scope ?? TWITCH_SCOPES,
      expiresAt,
    });

    appendLog('INFO', 'twitch', `Connected Twitch account: ${user.login}`);
  }

  async refreshTwitchTokenIfNeeded(): Promise<{ accessToken: string; accountId: string } | null> {
    const tokens = getOAuthTokens('twitch');
    if (!tokens || !tokens.accountId) return null;

    const expiresMs = tokens.expiresAt ? new Date(tokens.expiresAt).getTime() : Infinity;
    if (expiresMs - Date.now() > 120_000) {
      return { accessToken: tokens.accessToken, accountId: tokens.accountId };
    }

    if (!tokens.refreshToken || !process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
      return { accessToken: tokens.accessToken, accountId: tokens.accountId };
    }

    const res = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
      }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string[];
    };

    saveOAuthConnection({
      provider: 'twitch',
      accountId: tokens.accountId,
      username: tokens.username || '',
      displayName: tokens.channelTitle || tokens.username || '',
      channelTitle: tokens.channelTitle || tokens.username || '',
      avatarUrl: null,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokens.refreshToken,
      scopes: data.scope ?? TWITCH_SCOPES,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
    });

    return { accessToken: data.access_token, accountId: tokens.accountId };
  }

  async startRealTwitchMonitoring(channelLoginInput: string): Promise<LiveMonitorState> {
    const cleanLogin = channelLoginInput.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!cleanLogin) {
      throw new Error('Please enter a valid Twitch channel username.');
    }

    const clientId = process.env.TWITCH_CLIENT_ID;
    const auth = await this.refreshTwitchTokenIfNeeded();
    if (!clientId || !auth) {
      throw new Error(
        'Twitch account is not connected. Connect via Twitch OAuth in Twitch Connections, or use Demo Stream Simulator to test the Hype Engine locally.'
      );
    }

    this.stopMonitoring();
    this.syncSettings();
    this.engine.reset();

    // Resolve broadcaster ID via Helix API
    const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(cleanLogin)}`, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Client-Id': clientId,
      },
    });
    if (!userRes.ok) {
      throw new Error(`Twitch Helix user lookup failed (HTTP ${userRes.status}).`);
    }
    const userJson = (await userRes.json()) as {
      data?: Array<{ id: string; login: string; display_name: string }>;
    };
    const broadcaster = userJson.data?.[0];
    if (!broadcaster) {
      throw new Error(`Twitch channel "${cleanLogin}" was not found.`);
    }

    // Fetch live stream status via Helix API
    const streamRes = await fetch(
      `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(broadcaster.id)}`,
      {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Client-Id': clientId,
        },
      }
    );
    const streamJson = streamRes.ok
      ? ((await streamRes.json()) as {
          data?: Array<{ title: string; game_name: string; viewer_count: number; started_at: string }>;
        })
      : { data: [] };
    const liveInfo = streamJson.data?.[0];

    const streamId = `twitch-${broadcaster.login}-${Date.now()}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO monitored_streams (
        id, channel_login, channel_name, game_name, stream_title, is_live, is_demo,
        started_at, ended_at, peak_hype, avg_hype, total_messages, clips_generated, viewer_count
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, 0, 0, 0, 0, ?)
    `).run(
      streamId,
      broadcaster.login,
      broadcaster.display_name,
      liveInfo?.game_name || 'Just Chatting / Offline',
      liveInfo?.title || `${broadcaster.display_name} — EventSub Chat Monitor`,
      liveInfo ? 1 : 0,
      nowIso,
      liveInfo?.viewer_count ?? 0
    );

    this.state = {
      isMonitoring: true,
      mode: 'twitch_eventsub',
      streamId,
      channelLogin: broadcaster.login,
      channelName: broadcaster.display_name,
      gameName: liveInfo?.game_name || 'Offline',
      streamTitle: liveInfo?.title || 'Stream currently offline — listening for live chat via EventSub',
      isLive: Boolean(liveInfo),
      viewerCount: liveInfo?.viewer_count ?? 0,
      startedAt: nowIso,
      totalMessages: 0,
      clipsTriggered: 0,
      connectionStatus: 'Connecting to Twitch EventSub WebSocket...',
      lastError: null,
      snapshot: this.engine.computeSnapshot(),
      recentMessages: [],
    };

    this.connectEventSub(broadcaster.id, auth.accountId, auth.accessToken, clientId);
    this.startPeriodicTick();
    this.emit('state', this.getState());
    return this.getState();
  }

  private connectEventSub(broadcasterId: string, userId: string, accessToken: string, clientId: string): void {
    const ws = new WebSocket('wss://eventsub.wss.twitch.tv/ws');
    this.eventSubWs = ws;

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          metadata?: { message_type?: string };
          payload?: {
            session?: { id?: string };
            event?: {
              chatter_user_name?: string;
              message?: { text?: string; fragments?: Array<{ type?: string }> };
            };
          };
        };

        const type = msg.metadata?.message_type;
        if (type === 'session_welcome' && msg.payload?.session?.id) {
          const sessionId = msg.payload.session.id;
          const subRes = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Client-Id': clientId,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              type: 'channel.chat.message',
              version: '1',
              condition: {
                broadcaster_user_id: broadcasterId,
                user_id: userId,
              },
              transport: {
                method: 'websocket',
                session_id: sessionId,
              },
            }),
          });

          if (!subRes.ok) {
            const errTxt = await subRes.text();
            this.state.lastError = `EventSub chat subscription failed (${subRes.status}): ${errTxt}`;
            this.state.connectionStatus = 'Subscription error';
            this.emit('state', this.getState());
            return;
          }

          this.state.connectionStatus = 'Connected via Twitch EventSub WebSocket';
          this.emit('state', this.getState());
        } else if (type === 'notification' && msg.payload?.event) {
          const evt = msg.payload.event;
          const text = evt.message?.text || '';
          const emoteCount = (evt.message?.fragments ?? []).filter((f) => f.type === 'emote').length;
          if (text) {
            this.handleIncomingChat(evt.chatter_user_name || 'viewer', text, emoteCount, false);
          }
        }
      } catch (err) {
        appendLog('ERROR', 'eventsub', err instanceof Error ? err.message : 'EventSub parse error');
      }
    });

    ws.on('error', (err) => {
      this.state.lastError = `EventSub WebSocket error: ${err.message}`;
      this.state.connectionStatus = 'WebSocket error';
      this.emit('state', this.getState());
    });

    ws.on('close', () => {
      if (this.state.mode === 'twitch_eventsub' && this.state.isMonitoring) {
        this.state.connectionStatus = 'EventSub disconnected';
        this.emit('state', this.getState());
      }
    });
  }

  async createOfficialTwitchClip(broadcasterId: string): Promise<{ id: string; editUrl: string }> {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const auth = await this.refreshTwitchTokenIfNeeded();
    if (!clientId || !auth) {
      throw new Error('Twitch OAuth connection required to create official Twitch Clips.');
    }

    const res = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${encodeURIComponent(broadcasterId)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Client-Id': clientId,
        },
      }
    );

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Twitch Clips API failed (HTTP ${res.status}): ${txt}`);
    }

    const data = (await res.json()) as { data?: Array<{ id: string; edit_url: string }> };
    const clip = data.data?.[0];
    if (!clip) throw new Error('Twitch Clips API did not return a clip ID.');
    return { id: clip.id, editUrl: clip.edit_url };
  }

  startPublicTwitchChatMonitoring(channelLoginInput: string): LiveMonitorState {
    const cleanLogin = channelLoginInput
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?twitch\.tv\//, '')
      .replace(/^#/, '')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 25);

    if (!cleanLogin || !/^[a-z0-9_]{1,25}$/.test(cleanLogin)) {
      throw new Error('Enter a valid Twitch channel username (letters, numbers, underscores only).');
    }

    this.stopMonitoring();
    this.syncSettings();
    this.engine.reset();

    const streamId = `twitch-irc-${cleanLogin}-${Date.now()}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO monitored_streams (
        id, channel_login, channel_name, game_name, stream_title, is_live, is_demo,
        started_at, ended_at, peak_hype, avg_hype, total_messages, clips_generated, viewer_count
      ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, NULL, 0, 0, 0, 0, 0)
    `).run(
      streamId,
      cleanLogin,
      cleanLogin,
      'Twitch Live Chat',
      `#${cleanLogin} — Real-Time Public Twitch Chat`,
      nowIso
    );

    this.state = {
      isMonitoring: true,
      mode: 'twitch_public_irc',
      streamId,
      channelLogin: cleanLogin,
      channelName: cleanLogin,
      gameName: 'Twitch Live Chat',
      streamTitle: `Connected to #${cleanLogin} (Official Read-Only Twitch Chat — Zero Keys Needed)`,
      isLive: true,
      viewerCount: 0,
      startedAt: nowIso,
      totalMessages: 0,
      clipsTriggered: 0,
      connectionStatus: `Connecting to Twitch chat #${cleanLogin}...`,
      lastError: null,
      snapshot: this.engine.computeSnapshot(),
      recentMessages: [],
    };

    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    this.eventSubWs = ws;

    ws.on('open', () => {
      const anonNick = `justinfan${10000 + Math.floor(Math.random() * 89999)}`;
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE');
      ws.send(`NICK ${anonNick}`);
      ws.send(`JOIN #${cleanLogin}`);
      this.state.connectionStatus = `Live Twitch Chat Connected (#${cleanLogin})`;
      this.emit('state', this.getState());
    });

    ws.on('message', (raw) => {
      const payload = raw.toString('utf8');
      const lines = payload.split('\r\n').filter(Boolean);
      for (const line of lines) {
        if (line.startsWith('PING')) {
          ws.send(line.replace('PING', 'PONG'));
          continue;
        }
        if (!line.includes(' PRIVMSG #')) continue;

        let displayName = 'viewer';
        let emoteCount = 0;

        if (line.startsWith('@')) {
          const spaceIdx = line.indexOf(' ');
          const tagPart = spaceIdx > 1 ? line.slice(1, spaceIdx) : '';
          for (const kv of tagPart.split(';')) {
            const [k, v] = kv.split('=');
            if (k === 'display-name' && v) displayName = v;
            if (k === 'emotes' && v) {
              // Format: emoteId:start-end,start-end/emoteId2:start-end
              for (const entry of v.split('/')) {
                const posPart = entry.split(':')[1];
                if (posPart) emoteCount += posPart.split(',').length;
              }
            }
          }
        }

        const privMarker = ` PRIVMSG #${cleanLogin} :`;
        const msgIdx = line.indexOf(privMarker);
        if (msgIdx !== -1) {
          const text = line.slice(msgIdx + privMarker.length).trim();
          if (text) {
            this.handleIncomingChat(displayName, text, emoteCount, false);
          }
        }
      }
    });

    ws.on('error', (err) => {
      this.state.lastError = `Twitch chat WebSocket error: ${err.message}`;
      this.state.connectionStatus = 'Chat WebSocket error';
      this.emit('state', this.getState());
    });

    ws.on('close', () => {
      if (this.state.mode === 'twitch_public_irc' && this.state.isMonitoring) {
        this.state.connectionStatus = 'Twitch chat disconnected';
        this.emit('state', this.getState());
      }
    });

    this.startPeriodicTick();
    this.emit('state', this.getState());
    return this.getState();
  }

  startDemoSimulation(channelName = 'NovaStrike (Demo Channel)'): LiveMonitorState {
    this.stopMonitoring();
    this.syncSettings();
    this.engine.reset();

    const streamId = `demo-live-${Date.now()}`;
    const nowIso = new Date().toISOString();

    db.prepare(`
      INSERT INTO monitored_streams (
        id, channel_login, channel_name, game_name, stream_title, is_live, is_demo,
        started_at, ended_at, peak_hype, avg_hype, total_messages, clips_generated, viewer_count
      ) VALUES (?, ?, ?, ?, ?, 1, 1, ?, NULL, 0, 0, 0, 0, 4280)
    `).run(
      streamId,
      channelName.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24) || 'demo_channel',
      channelName,
      'Tactical Arena Championship',
      '[DEMO SIMULATION] Testing Real-Time Hype Detection Engine',
      nowIso
    );

    this.state = {
      isMonitoring: true,
      mode: 'demo_simulation',
      streamId,
      channelLogin: 'novastrike_demo',
      channelName,
      gameName: 'Tactical Arena Championship',
      streamTitle: '[DEMO SIMULATION] Real Hype Engine Running On Simulated Chat',
      isLive: true,
      viewerCount: 4280,
      startedAt: nowIso,
      totalMessages: 0,
      clipsTriggered: 0,
      connectionStatus: 'Demo Simulator Active (Not Live Twitch Data)',
      lastError: null,
      snapshot: this.engine.computeSnapshot(),
      recentMessages: [],
    };

    // Emit realistic baseline traffic + occasional bursts
    this.demoInterval = setInterval(() => {
      if (!this.state.isMonitoring) return;
      const inSpike = this.spikeRemainingTicks > 0;
      if (inSpike) this.spikeRemainingTicks -= 1;

      const burstCount = inSpike ? 6 + Math.floor(Math.random() * 6) : 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < burstCount; i++) {
        const user = DEMO_USERS[Math.floor(Math.random() * DEMO_USERS.length)];
        const pool = inSpike ? DEMO_HYPE_MESSAGES : DEMO_NORMAL_MESSAGES;
        const text = pool[Math.floor(Math.random() * pool.length)];
        this.handleIncomingChat(user, text, inSpike ? 2 : 0, true);
      }
    }, 650);

    this.startPeriodicTick();
    this.emit('state', this.getState());
    return this.getState();
  }

  triggerDemoSpike(): void {
    if (!this.state.isMonitoring || this.state.mode !== 'demo_simulation') return;
    this.spikeRemainingTicks = 11;
  }

  stopMonitoring(): LiveMonitorState {
    if (this.demoInterval) {
      clearInterval(this.demoInterval);
      this.demoInterval = null;
    }
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.eventSubWs) {
      try {
        this.eventSubWs.close();
      } catch {
        // Ignore
      }
      this.eventSubWs = null;
    }

    if (this.state.streamId) {
      db.prepare('UPDATE monitored_streams SET is_live = 0, ended_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        this.state.streamId
      );
    }

    this.state = {
      ...this.state,
      isMonitoring: false,
      mode: 'idle',
      isLive: false,
      connectionStatus: 'Idle',
    };
    this.emit('state', this.getState());
    return this.getState();
  }

  private startPeriodicTick(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      if (!this.state.isMonitoring) return;
      const snapshot = this.engine.computeSnapshot();
      this.state.snapshot = snapshot;
      this.emit('hype', snapshot);
    }, 1000);
  }

  private handleIncomingChat(username: string, message: string, emoteCount: number, isDemo: boolean): void {
    if (!this.state.streamId) return;
    const { chatItem, snapshot, shouldTriggerClip } = this.engine.ingest({
      streamId: this.state.streamId,
      username,
      message,
      twitchEmoteCount: emoteCount,
      isDemo,
    });

    this.state.totalMessages += 1;
    this.state.snapshot = snapshot;
    this.state.recentMessages = [chatItem, ...this.state.recentMessages].slice(0, 80);

    db.prepare(
      `UPDATE monitored_streams
       SET total_messages = total_messages + 1,
           peak_hype = MAX(peak_hype, ?)
       WHERE id = ?`
    ).run(snapshot.score, this.state.streamId);

    this.emit('chat', { chatItem, snapshot, totalMessages: this.state.totalMessages });

    if (shouldTriggerClip) {
      this.recordHypeEventAndCandidate(snapshot, isDemo).catch((err) => {
        appendLog('ERROR', 'hype-trigger', err instanceof Error ? err.message : 'Failed to create clip candidate');
      });
    }
  }

  async recordManualHighlightCandidate(): Promise<string> {
    const snap = this.engine.computeSnapshot();
    return this.recordHypeEventAndCandidate(
      { ...snap, score: Math.max(snap.score, 75), level: snap.score >= 85 ? 'Extreme' : 'Very High' },
      this.state.mode !== 'twitch_eventsub'
    );
  }

  private async recordHypeEventAndCandidate(snapshot: HypeSnapshot, isDemo: boolean): Promise<string> {
    const settings = getSettings();
    const streamId = this.state.streamId || 'manual-session';
    const hypeEventId = `hype-${crypto.randomBytes(5).toString('hex')}`;
    const clipId = `clip-${crypto.randomBytes(5).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const topTokens = snapshot.topReactions.map((r) => r.token);

    db.prepare(`
      INSERT INTO hype_events (
        id, stream_id, channel_name, score, level, mpm, mps, velocity_pct,
        unique_users, emote_rate, repeated_reactions, top_reactions, triggered_clip, is_demo, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      hypeEventId,
      streamId,
      this.state.channelName,
      snapshot.score,
      snapshot.level,
      snapshot.messagesPerMinute,
      snapshot.messagesPerSecond,
      snapshot.velocityPercent,
      snapshot.uniqueUsers,
      snapshot.emoteRatio,
      snapshot.repeatedReactions,
      JSON.stringify(topTokens),
      isDemo ? 1 : 0,
      nowIso
    );

    if (!settings.autoGenerateClips) {
      return hypeEventId;
    }

    const preset = settings.defaultPreset;
    const durationSec =
      preset === 'quick_short'
        ? settings.quickShortDuration
        : preset === 'highlight'
          ? settings.highlightDuration
          : settings.extendedDuration;
    const aspectRatio = preset === 'extended' ? '16:9' : '9:16';

    const meta = await generateHighlightMetadata({
      ollamaBaseUrl: settings.ollamaBaseUrl,
      ollamaModel: settings.ollamaModel,
      channelName: this.state.channelName,
      gameName: this.state.gameName,
      hypeScore: snapshot.score,
      durationSec,
      preset,
      topReactions: topTokens,
      chatSamples: this.state.recentMessages.slice(0, 8).map((m) => m.message),
    });

    const thumbs = [
      '/src/assets/images/clip_thumb_clutch_1795360387509.jpg',
      '/src/assets/images/stream_preview_fps_1795360386447.jpg',
      '/src/assets/images/clip_thumb_boss_1795360450573.jpg',
      '/src/assets/images/clip_thumb_reaction_1795360426691.jpg',
    ];
    const thumb = thumbs[Math.floor(Math.random() * thumbs.length)];

    db.prepare(`
      INSERT INTO clips (
        id, stream_id, hype_event_id, channel_name, title, description, hashtags_json,
        thumbnail_text, summary, metadata_source, preset, aspect_ratio, duration_sec,
        start_sec, end_sec, hype_score, status, source_type, source_path, output_path,
        thumbnail_path, has_verified_media, audio_review_status, audio_flags_json,
        caption_config_json, edit_config_json, youtube_status, is_demo, stream_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'ready', ?, NULL, NULL, ?, 0, 'pending', '[]', ?, ?, 'not_uploaded', ?, ?, ?, ?)
    `).run(
      clipId,
      streamId,
      hypeEventId,
      this.state.channelName,
      meta.title,
      meta.description,
      JSON.stringify(meta.hashtags),
      meta.thumbnailText,
      meta.summary,
      meta.source,
      preset,
      aspectRatio,
      durationSec,
      durationSec,
      snapshot.score,
      isDemo ? 'demo_sample' : 'twitch_clip',
      thumb,
      JSON.stringify(createDefaultCaptionConfig(this.state.recentMessages[0]?.message || 'NO WAY THAT JUST HAPPENED!')),
      JSON.stringify(createDefaultEditConfig(aspectRatio)),
      isDemo ? 1 : 0,
      nowIso,
      nowIso,
      nowIso
    );

    this.state.clipsTriggered += 1;
    if (this.state.streamId) {
      db.prepare('UPDATE monitored_streams SET clips_generated = clips_generated + 1 WHERE id = ?').run(
        this.state.streamId
      );
    }

    this.emit('clip_triggered', {
      clipId,
      title: meta.title,
      hypeScore: snapshot.score,
      isDemo,
    });

    return clipId;
  }
}

export const twitchMonitor = new TwitchMonitorManager();
