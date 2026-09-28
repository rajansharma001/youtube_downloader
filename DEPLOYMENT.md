# StreamGrab Production Deployment Guide

StreamGrab is a production-hardened YouTube Media Downloader & Offline Player web application. It runs with a high-performance WSGI server (**Waitress** on Windows/cross-platform, or **Gunicorn** on Linux), rate limiting, path traversal protection, security headers, PWA support, and background download workers.

---

## Quick Start (Local Production Mode)

### Windows / macOS / Linux

1. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Ensure FFmpeg is installed and available in PATH**:
   - **Windows**: Download from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) or `winget install Gyan.FFmpeg`
   - **Ubuntu/Debian**: `sudo apt update && sudo apt install -y ffmpeg`
   - **macOS**: `brew install ffmpeg`

3. **Start the production server**:
   ```bash
   python server.py
   ```
   The application will automatically bind via **Waitress WSGI** on `http://0.0.0.0:5000`.

---

## 1-Click Docker Deployment

StreamGrab includes a production `Dockerfile` and `docker-compose.yml`.

### Using Docker Compose:
```bash
docker compose up -d --build
```

### Using Plain Docker:
```bash
docker build -t streamgrab .
docker run -d -p 5000:5000 --name streamgrab streamgrab
```

Check health:
```bash
curl http://localhost:5000/api/health
```

---

## Online VPS Deployment (Ubuntu / Debian + Nginx + Certbot HTTPS)

### Step 1: Install System Packages
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-pip python3-venv ffmpeg nginx certbot python3-certbot-nginx
```

### Step 2: Clone or Copy Project
```bash
sudo mkdir -p /var/www/streamgrab
sudo chown -R $USER:$USER /var/www/streamgrab
cd /var/www/streamgrab
# Copy all project files here
```

### Step 3: Setup Virtual Environment
```bash
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 4: Configure Environment Variables
Create `/var/www/streamgrab/.env`:
```ini
STREAMGRAB_ENV=production
STREAMGRAB_HOST=127.0.0.1
STREAMGRAB_PORT=5000
STREAMGRAB_SECRET_KEY=generate_with_python_secrets
STREAMGRAB_STORAGE_DIR=/tmp/streamgrab_media_cache
```

### Step 5: Setup Systemd Service
Create `/etc/systemd/system/streamgrab.service`:
```ini
[Unit]
Description=StreamGrab YouTube Downloader Service
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/streamgrab
EnvironmentFile=/var/www/streamgrab/.env
ExecStart=/var/www/streamgrab/venv/bin/python server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable streamgrab
sudo systemctl start streamgrab
sudo systemctl status streamgrab
```

### Step 6: Configure Nginx Reverse Proxy
Create `/etc/nginx/sites-available/streamgrab`:
```nginx
server {
    server_name yourdomain.com www.yourdomain.com;

    client_max_body_size 2M;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket and streaming media support
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

Enable site and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/streamgrab /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 7: Enable Free SSL with Let's Encrypt
```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

---

## Security Architecture Summary

| Security Feature | Implementation |
|---|---|
| **WSGI Server** | Waitress (6 worker threads, timeout protection, connection limits) |
| **Reverse Proxy** | `ProxyFix` middleware enabled for real IP tracking behind Nginx / Cloudflare |
| **Rate Limiting** | `Flask-Limiter` with strict per-IP thresholds on search (15/min), download (10/min), and cookies (5/min) |
| **Path Traversal Protection** | Safe basename extraction, strict `DOWNLOADS_DIR` containment, extension whitelisting (`.mp3`, `.mp4`, `.webm`, `.m4a`) |
| **XSS Prevention** | Strict Content Security Policy (CSP), HTML entity encoding (`escapeHtml`) on all user/API data |
| **Clickjacking** | `X-Frame-Options: SAMEORIGIN` |
| **MIME Sniffing** | `X-Content-Type-Options: nosniff` |
| **HTTPS Enforcement** | `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` |
| **Privacy & Leaks** | Server header masked as `StreamGrab`, OS file paths concealed from API responses |
| **Memory & Storage** | In-memory job repository capped at 500 records; automated background thread cleans temp cache files older than 2 hours |
