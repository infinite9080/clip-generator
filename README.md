# HypeCut AI — Free & Local Twitch Highlight Studio

HypeCut AI is a self-hosted, open-source Twitch highlight workflow built to run locally on a Windows PC (or Linux/macOS) without paid cloud APIs, paid AI subscriptions, or paid cloud hosting.

## Core Architecture (100% Free Stack)

- **Frontend**: React, Vite, TypeScript, Tailwind CSS, Recharts
- **Backend**: Node.js, Express, Server-Sent Events (SSE), background worker queue
- **Database**: Local SQLite (`./data/hypecut.db`) via `better-sqlite3`
- **Hype Detection**: Local JavaScript rolling-window engine (0–100 score, baseline velocity, unique users, emotes, repeated reactions, cooldown suppression)
- **Local AI Metadata**: Local [Ollama](https://ollama.com/) server (default `qwen2.5:7b`) with automatic rule-based fallback when Ollama is offline
- **Video & Audio Processing**: Local FFmpeg & FFprobe (automatically uses NVIDIA `h264_nvenc` on RTX GPUs when available, otherwise `libx264`)
- **Integrations**: Official Twitch OAuth 2.0 + EventSub WebSocket, Official YouTube Data API v3 resumable uploads

## Local Storage Layout

Directories are created automatically on first run:

- `./data/hypecut.db` — SQLite database
- `./storage/recordings/` — Authorized local video recordings imported for editing
- `./storage/clips/` — Verified rendered MP4 outputs
- `./storage/thumbnails/` — Extracted video thumbnails
- `./storage/temp/` — Temporary subtitle/work files (cleanable in Settings)
- `./logs/hypecut.log` — Local runtime and worker logs

## Windows PC Setup Guide

### 1. Prerequisites

1. **Node.js 22 LTS**: Install from [nodejs.org](https://nodejs.org/).
2. **FFmpeg**: Install via Winget in PowerShell:
   ```powershell
   winget install Gyan.FFmpeg
   ```
   Restart your terminal and confirm `ffmpeg -version` works. If installed elsewhere, set the exact path in Settings or `.env`.
3. **Ollama (Optional, Recommended for Local AI Titles/Descriptions)**:
   Install from [ollama.com](https://ollama.com/), then pull a local model:
   ```powershell
   ollama pull qwen2.5:7b
   ```
   If Ollama is not running, HypeCut AI continues working using its deterministic rule-based metadata generator.

### 2. Install & Run Locally

```powershell
npm install
copy .env.example .env
npm run dev
```

Open `http://localhost:3000` in your browser.

For production build & execution:

```powershell
npm run build
npm start
```

### 3. Official Twitch OAuth & EventSub Setup (Free)

1. Open [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) and create a new application.
2. Add your OAuth Redirect URL:
   - Local Windows PC: `http://localhost:3000/auth/twitch/callback`
   - Hosted preview: `<YOUR_APP_URL>/auth/twitch/callback`
3. Copy your Client ID and Client Secret into `.env`:
   ```env
   TWITCH_CLIENT_ID="your_twitch_client_id"
   TWITCH_CLIENT_SECRET="your_twitch_client_secret"
   ```
4. Restart the server and connect under **Twitch Connections**.

> **Important Video Capture Note**: Twitch EventSub streams real-time chat events, not raw video. The official Twitch Clips API captures up to 90 seconds (5–60s published). For 2–3 minute Highlights and 5-minute Extended Highlights, record your own authorized stream locally (for example, OBS Replay Buffer or local MKV/MP4 recording) and import it via **Generated Clips -> Import Local Recording**.

### 4. Official YouTube Data API v3 Setup (Free Daily Quota)

1. Open [Google Cloud Console](https://console.cloud.google.com/), create a project, and enable **YouTube Data API v3**.
2. Configure an OAuth Consent Screen and create an **OAuth 2.0 Client ID (Web Application)**.
3. Add your Authorized Redirect URI:
   - Local Windows PC: `http://localhost:3000/auth/youtube/callback`
   - Hosted preview: `<YOUR_APP_URL>/auth/youtube/callback`
4. Add credentials to `.env`:
   ```env
   YOUTUBE_CLIENT_ID="your_google_client_id"
   YOUTUBE_CLIENT_SECRET="your_google_client_secret"
   ```
5. Restart the server and connect under **YouTube Channels**.

> **Publishing & Rights Policy**: Automated audio scanning flags likely background music for manual inspection, but does not guarantee copyright clearance. Unresolved audio warnings block YouTube upload, all uploads default to **Private**, vertical videos up to 3 minutes upload as Shorts, and 5-minute videos upload as standard YouTube videos.
