# StreamGrab 🎬⚡

> **High-Performance YouTube Media Downloader, PWA Offline Player & Streaming Deck**  
> 100% Free, Standalone & Open-Source. Zero Tracking &bull; Zero Permissions &bull; Device-First Storage.

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Backend-Flask%20%7C%20Waitress-000000?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![yt-dlp](https://img.shields.io/badge/Engine-yt--dlp-FF0000?style=flat-square&logo=youtube&logoColor=white)](https://github.com/yt-dlp/yt-dlp)
[![PWA](https://img.shields.io/badge/PWA-IndexedDB%20%2B%20Offline-5A0FC8?style=flat-square&logo=pwa&logoColor=white)](https://developer.mozilla.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

---

## 🌟 Overview

**StreamGrab** is a modern, lightweight, and privacy-focused media platform engineered to stream, batch-download, and organize YouTube videos and music with zero external friction. 

Built with **Python (Flask + Waitress)** on the backend and a **pure Vanilla JS PWA** on the frontend, StreamGrab requires **no user registration**, collects **no telemetry**, and stores your offline audio and video directly in your device's browser **IndexedDB storage**.

---

## 🚀 Key Features

### 1. Smart Watch Deck & Embedded Player
- **Distraction-Free Video Experience**: Custom player envelope with hidden native YouTube chrome (`controls=0`).
- **Interactive Resolution Switcher**: On-the-fly resolution switcher supporting `1080p`, `720p`, `480p`, `360p`, `240p`, and `Auto HD`.
- **Draggable Mini-Player**: Minimize videos to a floating corner mini-player and drag it anywhere across your viewport with boundary collision detection.
- **Always-on-Top OS Popout (Picture-in-Picture)**: Powered by the modern `window.documentPictureInPicture` API, float your video window on top of other applications (e.g. desktop apps, social media, code editors).

### 2. High-Performance Downloader
- **Collapsible Download Accordion**: Clean quality badge toggle keeping your watch deck clutter-free.
- **Audio & Video Formats**:
  - **MP3 Audio**: 128 kbps, 192 kbps, 256 kbps, and pristine 320 kbps bitrates.
  - **MP4 Video**: 360p, 480p, 720p HD, and 1080p Full HD with audio merging via FFmpeg.
- **Batch Processing**: Smart delimiter parsing for pasting multiple links, commas, or mixed text simultaneously.
- **Playlist & Multi-Link Queue**: Asynchronous multithreaded queue with real-time download speeds, percentage, and ETA.

### 3. PWA Offline Media & Music Player
- **Background & Lock Screen Playback**: Full `navigator.mediaSession` integration. Keep music and videos playing smoothly when your phone is locked or your browser is minimized.
- **Offline Storage**: Save media directly into client-side **IndexedDB**, completely independent of the server file system.
- **Turntable Vinyl Music Deck**: Retro vinyl disc animation with playlist controls, shuffle, repeat-one/repeat-all, and audio scrubber.
- **Custom 16:9 Video Player**: Clean, responsive video player with native Picture-in-Picture support and fullscreen toggle.
- **Local File Import**: Import any MP3 or MP4 from your device storage into your offline library.

### 4. Search & Feed Customization
- **Voice Search**: Real-time microphone dictation using the Web Speech API (`SpeechRecognition`).
- **Feed Preferences**: Customize your home feed in Settings (Trending, Japanese Lessons & Culture, Coding & Tech, Anime & Music, Gaming, or Custom Keywords).
- **One-Click Sharing**: Web Share API integration across all cards, watch decks, and offline playlists.

---

## 🛠️ System Architecture & Tech Stack

```text
┌─────────────────────────────────────────────────────────────┐
│                       Client (Browser)                      │
│   Vanilla JS (ES2022) • IndexedDB (Offline) • Service Worker│
│   Web Speech API • Document Picture-in-Picture • MediaSession│
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / JSON API
┌──────────────────────────────▼──────────────────────────────┐
│                    Waitress Production WSGI                 │
│                 Flask Application (server.py)               │
│                                                             │
│   ┌───────────────────┐               ┌─────────────────┐   │
│   │  API Controllers  │◄─────────────►│ Worker Thread   │   │
│   │  /search /download│               │ Queue Manager   │   │
│   └─────────┬─────────┘               └────────┬────────┘   │
│             │                                  │            │
│   ┌─────────▼──────────────────────────────────▼────────┐   │
│   │              yt-dlp + FFmpeg + Deno Engine          │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

- **Backend**: Python 3.10+, Flask 3.x, Waitress Production WSGI
- **Media Engine**: `yt-dlp`, FFmpeg 6+, Deno (JavaScript execution for YouTube signature extraction)
- **Frontend**: Vanilla ES6+ JavaScript, CSS3 Design Tokens, HTML5 PWA
- **Client Storage**: IndexedDB (Blobs and metadata stored locally on device)
- **Security**: Strict Content Security Policy (CSP), Permissions-Policy hardening, Path-traversal sanitization

---

## ⚡ Quick Start

### Prerequisites
1. **Python 3.10+** installed.
2. **FFmpeg** installed and accessible in your system `PATH`.
3. *(Optional)* **Deno** for modern YouTube signature solving:
   ```powershell
   winget install DenoLand.Deno
   ```

### 1. Clone Repository
```bash
git clone https://github.com/rajansharma001/youtube_downloader.git
cd youtube_downloader
```

### 2. Install Dependencies
```bash
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Run Application
```bash
python server.py
```
Open your browser and navigate to `http://localhost:5000`.

---

## 🐳 Docker Deployment

A lightweight, multi-stage Docker environment is preconfigured:

```bash
# Build and run with Docker Compose
docker compose up -d --build
```
The container automatically bundles FFmpeg and Deno with hardened non-root user permissions.

---

## ☁️ Render.com 1-Click Cloud Deployment

StreamGrab is preconfigured with a native [`render.yaml`](file:///e:/community%20project/youtube_downloader/render.yaml) blueprint for **Render.com**. Unlike serverless hosts (such as Vercel), Render runs as a persistent service with unlimited execution time, background download queues, and full FFmpeg transcode support:

1. Log into your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** &rarr; Select **Blueprint**.
3. Connect your GitHub repository (`https://github.com/rajansharma001/youtube_downloader`).
4. Render automatically configures the Docker Web Service and provisions your live application with a public HTTPS URL.

---

## 📡 API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/search?q={query}` | `GET` | Fetches search results and video metadata from YouTube. |
| `/api/download` | `POST` | Enqueues single or batch URLs for audio/video conversion. |
| `/api/status` | `GET` | Returns live progress, speed, ETA, and status of queue jobs. |
| `/api/cancel/{job_id}` | `POST` | Cancels an ongoing download job. |
| `/api/health` | `GET` | Health check verifying FFmpeg, Deno, and cookie status. |
| `/api/files` | `GET` | Lists completed media files saved on the host machine. |

---

## 👨‍💻 Author & Lead Engineer

| Developer | Details |
| :--- | :--- |
| **Name** | **Rajan Sharma** |
| **Role** | Full-Stack Software Engineer |
| **Location** | Kathmandu, Bagmati Prov, Nepal |
| **Portfolio** | [rajansharma.info.np](https://www.rajansharma.info.np/) |
| **GitHub** | [@rajansharma001](https://github.com/rajansharma001) |
| **Contact** | [email.rajan001@gmail.com](mailto:email.rajan001@gmail.com) |
| **Core Stack** | Next.js 16, React 19, TypeScript, Node.js, Express, Python, PostgreSQL, MongoDB, Tailwind CSS |
| **Background** | 14+ production systems shipped across LMS, POS, tourism, and geospatial data domains. |

---

## 🛡️ Privacy & Public Policy

- **Zero Sign-In**: No account creation or login required.
- **No Telemetry**: No third-party analytics, ads, or fingerprinting scripts.
- **Content Credit**: All media content is delivered directly from and credited to **[YouTube.com](https://www.youtube.com)** and its respective original creators.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
