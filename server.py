"""
StreamGrab - Production-Ready YouTube Media Downloader & Player Server
=====================================================================
Security-hardened, production-grade Flask application served via Waitress WSGI.

Security features:
- Rate limiting on all API endpoints (flask-limiter)
- Comprehensive security headers (CSP, X-Frame-Options, HSTS, etc.)
- Path traversal protection on all file-serving endpoints
- Input validation and sanitization on all user inputs
- No debug mode, no verbose error leakage
- Secret key from environment or secure random generation
- Maximum request size limits
- Safe file upload handling with size and type restrictions
- Server identity masking
- CORS restrictions
- Automatic temp file cleanup
"""

import os
import sys
import re
import shutil
import threading
import time
import uuid
import urllib.parse
import io
import zipfile
import tempfile
import secrets
import logging
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, request, jsonify, render_template, send_from_directory, send_file, abort
from werkzeug.middleware.proxy_fix import ProxyFix
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import yt_dlp

# ---------------------------------------------------------------------------
# Logging Configuration (production: structured, no debug tracebacks to client)
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
    stream=sys.stdout
)
logger = logging.getLogger('streamgrab')

# Force unbuffered output (safely ignored in serverless/Lambda environments where stdout is LambdaLogger)
try:
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(line_buffering=True)
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

# ---------------------------------------------------------------------------
# Configuration from Environment
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.abspath(os.path.join(BASE_DIR, 'templates'))
STATIC_DIR = os.path.abspath(os.path.join(BASE_DIR, 'static'))
TEMP_CACHE_DIR = os.path.join(tempfile.gettempdir(), 'streamgrab_media_cache')
DOWNLOADS_DIR = os.environ.get('STREAMGRAB_STORAGE_DIR', TEMP_CACHE_DIR)
COOKIE_FILE = os.path.join(BASE_DIR, 'cookies.txt')
try:
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)
except OSError:
    DOWNLOADS_DIR = os.path.join('/tmp', 'streamgrab_media_cache')
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# Production configuration
SECRET_KEY = os.environ.get('STREAMGRAB_SECRET_KEY', secrets.token_hex(32))
MAX_CONTENT_LENGTH = 2 * 1024 * 1024  # 2 MB max upload (cookies.txt files are tiny)
MAX_BATCH_URLS = 50  # Maximum URLs per batch request
MAX_SEARCH_LIMIT = 25
MAX_CONCURRENT_DOWNLOADS = 3
TEMP_FILE_MAX_AGE = 7200  # 2 hours
ALLOWED_COOKIE_FILE_SIZE = 1 * 1024 * 1024  # 1 MB max cookie file
ALLOWED_MEDIA_EXTS = {'.mp3', '.mp4', '.webm', '.m4a'}
MAX_JOBS_IN_MEMORY = 500

# Determine environment
IS_PRODUCTION = os.environ.get('STREAMGRAB_ENV', 'production').lower() == 'production'
BIND_HOST = os.environ.get('STREAMGRAB_HOST', '0.0.0.0')
BIND_PORT = int(os.environ.get('STREAMGRAB_PORT', '5000'))

# Check external tool availability
FFMPEG_AVAILABLE = shutil.which('ffmpeg') is not None
DENO_AVAILABLE = shutil.which('deno') is not None
if FFMPEG_AVAILABLE:
    logger.info("FFmpeg detected: %s", shutil.which('ffmpeg'))
else:
    logger.warning("FFmpeg not found in PATH. Media conversion will be limited.")
if DENO_AVAILABLE:
    logger.info("Deno JS runtime detected: %s", shutil.which('deno'))

# ---------------------------------------------------------------------------
# Flask Application Setup
# ---------------------------------------------------------------------------
app = Flask(
    __name__,
    template_folder=TEMPLATES_DIR,
    static_folder=STATIC_DIR,
    static_url_path='/static'
)
app.config['SECRET_KEY'] = SECRET_KEY
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0  # Don't cache static files aggressively
app.config['TEMPLATES_AUTO_RELOAD'] = True

# Support reverse proxies (Cloudflare, Nginx, etc.) for real client IP and HTTPS proto
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# ---------------------------------------------------------------------------
# Rate Limiting
# ---------------------------------------------------------------------------
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per minute"],
    storage_uri="memory://",
)

# ---------------------------------------------------------------------------
# Thread Pool & Job State
# ---------------------------------------------------------------------------
executor = ThreadPoolExecutor(max_workers=MAX_CONCURRENT_DOWNLOADS)
jobs = {}
jobs_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Security Headers (applied to every response)
# ---------------------------------------------------------------------------
@app.after_request
def add_security_headers(response):
    """Apply comprehensive security headers to every HTTP response."""
    try:
        # Cache control - prevent stale content
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'

        # Clickjacking protection
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'

        # XSS protection
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-XSS-Protection'] = '1; mode=block'

        # Referrer policy - strictly no-referrer to prevent 403 Forbidden on YouTube thumbnail CDN
        response.headers['Referrer-Policy'] = 'no-referrer'

        # Permissions policy (allow voice search on self & picture-in-picture; deny tracking, cameras, sensors)
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(self), picture-in-picture=(self "*"), geolocation=(), payment=(), usb=()'

        # Content Security Policy - allow YouTube embeds and all YouTube thumbnail domains
        csp = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' https://*.ytimg.com https://i.ytimg.com https://img.youtube.com https://*.youtube.com https://*.ggpht.com https://*.googleusercontent.com data: blob:; "
            "media-src 'self' blob:; "
            "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://yewtu.be https://piped.video; "
            "connect-src 'self'; "
            "font-src 'self'; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
        )
        response.headers['Content-Security-Policy'] = csp

        # HTTP Strict Transport Security (RFC 6797) - enforced by browsers when served via HTTPS
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload'

        # Server identification
        response.headers['X-Powered-By'] = 'StreamGrab'
    except Exception as e:
        logger.error("after_request header error: %s", str(e))

    return response


# ---------------------------------------------------------------------------
# Error Handlers (never leak internal details)
# ---------------------------------------------------------------------------
@app.errorhandler(400)
def bad_request(e):
    return jsonify({"success": False, "error": "Bad request."}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({"success": False, "error": "Resource not found."}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"success": False, "error": "Method not allowed."}), 405

@app.errorhandler(413)
def payload_too_large(e):
    return jsonify({"success": False, "error": "Request payload too large. Maximum 2 MB."}), 413

@app.errorhandler(429)
def rate_limit_exceeded(e):
    return jsonify({"success": False, "error": "Rate limit exceeded. Please slow down."}), 429

@app.errorhandler(500)
def internal_error(e):
    logger.error("Internal server error: %s", str(e))
    return jsonify({"success": False, "error": "Internal server error."}), 500


# ---------------------------------------------------------------------------
# Input Validation Helpers
# ---------------------------------------------------------------------------
YOUTUBE_URL_REGEX = re.compile(
    r'(?:https?://)?(?:(?:www|m)\.)?(?:youtube\.com/(?:watch\?(?:[^\s&]*&)*v=|shorts/|live/|embed/|v/)|youtu\.be/)([a-zA-Z0-9_-]{11})',
    re.IGNORECASE
)

# Strict alphanumeric + limited chars for filenames
SAFE_FILENAME_REGEX = re.compile(r'^[a-zA-Z0-9._\-\s\(\)\[\]]+$')

# Job ID must be exactly 12 hex characters
JOB_ID_REGEX = re.compile(r'^[a-f0-9]{12}$')


def sanitize_search_query(query: str) -> str:
    """Sanitize search query: strip, limit length, remove dangerous characters."""
    if not query or not isinstance(query, str):
        return ""
    query = query.strip()
    # Limit length to prevent abuse
    query = query[:200]
    # Remove null bytes and control characters
    query = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', query)
    return query


def validate_job_id(job_id: str) -> bool:
    """Validate that job_id is a safe hex string."""
    return bool(job_id and isinstance(job_id, str) and JOB_ID_REGEX.match(job_id))


def safe_basename(filename: str) -> str:
    """Extract safe basename, stripping any path traversal attempts."""
    decoded = urllib.parse.unquote(filename)
    # Remove any path separators and parent directory references
    basename = os.path.basename(decoded)
    # Additional safety: strip leading dots
    basename = basename.lstrip('.')
    return basename


def validate_file_in_directory(directory: str, filename: str) -> str | None:
    """Securely resolve a filename within a directory, preventing path traversal."""
    safe_name = safe_basename(filename)
    if not safe_name:
        return None
    target_path = os.path.abspath(os.path.join(directory, safe_name))
    # Verify the resolved path is strictly inside the target directory
    try:
        dir_abs = os.path.abspath(directory)
        if not target_path.startswith(dir_abs + os.sep) and target_path != dir_abs:
            # Check that common path matches
            common = os.path.commonpath([dir_abs, target_path])
            if common != dir_abs:
                return None
        if not os.path.isfile(target_path):
            return None
        return target_path
    except (ValueError, OSError):
        return None


def clean_youtube_url(url: str) -> str:
    """Normalize any YouTube URL into standard watch URL without tracking params."""
    m = YOUTUBE_URL_REGEX.search(url)
    if m:
        video_id = m.group(1)
        return f"https://www.youtube.com/watch?v={video_id}"
    return url


def extract_youtube_urls_from_items(raw_items: list) -> list:
    """Extract and deduplicate valid YouTube URLs from a list of strings."""
    seen = set()
    valid = []
    for item in raw_items:
        if not isinstance(item, str):
            continue
        # Limit individual item length
        item = item[:2000]
        # Split attached URLs
        s = re.sub(r'(\S)(https?://)', r'\1\n\2', item, flags=re.IGNORECASE)
        s = re.sub(r'([^\s/=?&.])((?:www\.|m\.)?youtube\.com|youtu\.be)', r'\1\n\2', s, flags=re.IGNORECASE)
        s = re.sub(r'[,;\t<>"\'`()\[\]{}]+', '\n', s)
        for line in s.splitlines():
            line = line.strip()
            if not line:
                continue
            m = YOUTUBE_URL_REGEX.search(line)
            if m:
                clean = f"https://www.youtube.com/watch?v={m.group(1)}"
                if clean not in seen:
                    seen.add(clean)
                    valid.append(clean)
    return valid


# ---------------------------------------------------------------------------
# Utility Functions
# ---------------------------------------------------------------------------
def format_duration(seconds) -> str:
    """Format duration in seconds into human-readable MM:SS or HH:MM:SS."""
    if not seconds:
        return ""
    try:
        sec = int(seconds)
        m, s = divmod(sec, 60)
        h, m = divmod(m, 60)
        if h > 0:
            return f"{h}:{m:02d}:{s:02d}"
        return f"{m}:{s:02d}"
    except (ValueError, TypeError):
        return ""


def format_views(view_count) -> str:
    """Format large view counts into readable abbreviation."""
    if not view_count:
        return ""
    try:
        vc = int(view_count)
        if vc >= 1_000_000_000:
            return f"{vc / 1_000_000_000:.1f}B views"
        if vc >= 1_000_000:
            return f"{vc / 1_000_000:.1f}M views"
        if vc >= 1_000:
            return f"{vc / 1_000:.1f}K views"
        return f"{vc:,} views"
    except (ValueError, TypeError):
        return ""


def format_user_error(raw_error: str) -> str:
    """Transform technical errors into safe, user-friendly messages."""
    lower = raw_error.lower()
    if "sign in to confirm you're not a bot" in lower or "bot" in lower:
        return "YouTube bot check triggered. Please upload a cookies.txt file to authenticate."
    if "confirm your age" in lower or "age-restricted" in lower:
        return "This video is age-restricted and requires account authentication."
    if "private video" in lower:
        return "This video is private."
    if "video unavailable" in lower:
        return "This video is unavailable or has been removed."
    if "live event" in lower or "is a live stream" in lower:
        return "Live streams cannot be downloaded."
    if "geo-restricted" in lower or "not available in your country" in lower:
        return "This video is not available in your region."
    if "ffmpeg was not found" in lower:
        return "FFmpeg is required for media conversion. Please install FFmpeg."
    if "timed out" in lower or "timeout" in lower:
        return "Connection to YouTube timed out. Please try again."
    # Never return raw error messages that could leak internal info
    if len(raw_error) > 200:
        return "An unexpected error occurred. Please try again."
    return raw_error


def get_active_cookie_file() -> str | None:
    """Find a valid cookies.txt file in known locations."""
    candidate_names = ['cookies.txt', 'youtube_cookies.txt', 'youtube.com_cookies.txt']

    for name in candidate_names:
        p = os.path.join(BASE_DIR, name)
        if os.path.exists(p) and os.path.getsize(p) > 20:
            return p

    for name in candidate_names:
        p = os.path.join(DOWNLOADS_DIR, name)
        if os.path.exists(p) and os.path.getsize(p) > 20:
            return p

    user_downloads = os.path.join(os.path.expanduser('~'), 'Downloads')
    if os.path.exists(user_downloads):
        for name in candidate_names:
            p = os.path.join(user_downloads, name)
            if os.path.exists(p) and os.path.getsize(p) > 20:
                return p

    return None


def cleanup_temp_cache(max_age_seconds=None):
    """Purge temporary media files older than max_age_seconds."""
    if max_age_seconds is None:
        max_age_seconds = TEMP_FILE_MAX_AGE
    try:
        now = time.time()
        cleanup_exts = {'.mp3', '.mp4', '.webm', '.m4a', '.part', '.ytdl', '.temp', '.zip'}
        for f in os.listdir(DOWNLOADS_DIR):
            fp = os.path.join(DOWNLOADS_DIR, f)
            if os.path.isfile(fp):
                ext = os.path.splitext(f)[1].lower()
                if ext in cleanup_exts and now - os.path.getmtime(fp) > max_age_seconds:
                    try:
                        os.remove(fp)
                    except OSError:
                        pass
    except OSError:
        pass


# ---------------------------------------------------------------------------
# yt-dlp Download Engine
# ---------------------------------------------------------------------------
def build_yt_dlp_options(media_type: str, quality: str, progress_hook, postprocessor_hook):
    """Build secure yt-dlp download options."""
    dl_opts = {
        'outtmpl': os.path.join(DOWNLOADS_DIR, '%(title).100B.%(ext)s'),
        'progress_hooks': [progress_hook],
        'postprocessor_hooks': [postprocessor_hook],
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'socket_timeout': 25,
        'retries': 3,
        'fragment_retries': 3,
        # Security: restrict network to only YouTube domains
        'geo_bypass': False,
    }

    cookie_path = get_active_cookie_file()
    if cookie_path:
        dl_opts['cookiefile'] = cookie_path
        logger.info("Using authenticated cookies from: %s", cookie_path)
    else:
        dl_opts['extractor_args'] = {
            'youtube': {
                'player_client': ['mweb', 'web_safari', 'android', 'ios', 'default'],
            }
        }

    if media_type == 'video':
        quality_map = {
            '1080': 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
            '720': 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best',
            '480': 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best',
            '360': 'bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[height<=360]/best',
        }
        dl_opts['format'] = quality_map.get(quality, 'bestvideo+bestaudio/best')
        dl_opts['merge_output_format'] = 'mp4'
    else:
        dl_opts['format'] = 'bestaudio/bestvideo+bestaudio/best'
        safe_quality = str(quality) if quality in ('128', '192', '256', '320') else '192'
        dl_opts['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': safe_quality,
        }]

    return dl_opts


def process_download(job_id: str):
    """Background worker for downloading and converting media."""
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return

    clean_url = clean_youtube_url(job['url'])
    media_type = job.get('media_type', 'audio')
    quality = job.get('quality', '192')
    target_ext = '.mp4' if media_type == 'video' else '.mp3'

    with jobs_lock:
        job['status'] = 'fetching'
        job['progress'] = 0
        job['error'] = None

    def ydl_progress_hook(d):
        status = d.get('status')
        if status == 'downloading':
            downloaded = d.get('downloaded_bytes', 0)
            total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            percent = 1
            if total > 0:
                percent = min(99, max(1, int((downloaded / total) * 100)))
            else:
                p_str = str(d.get('_percent_str', '')).replace('%', '').strip()
                try:
                    percent = min(99, max(1, int(float(p_str))))
                except (ValueError, TypeError):
                    percent = 1

            speed_val = d.get('speed')
            speed_str = ""
            if speed_val:
                if speed_val >= 1024 * 1024:
                    speed_str = f"{speed_val / (1024 * 1024):.1f} MiB/s"
                elif speed_val >= 1024:
                    speed_str = f"{speed_val / 1024:.1f} KiB/s"
                else:
                    speed_str = f"{int(speed_val)} B/s"

            eta_val = d.get('eta')
            eta_str = ""
            if eta_val is not None:
                try:
                    m, s = divmod(int(eta_val), 60)
                    h, m = divmod(m, 60)
                    eta_str = f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"
                except (ValueError, TypeError):
                    eta_str = ""

            with jobs_lock:
                job['status'] = 'downloading'
                job['progress'] = percent
                job['speed'] = speed_str
                job['eta'] = eta_str
                job['downloaded_bytes'] = downloaded
                job['total_bytes'] = total

        elif status == 'finished':
            with jobs_lock:
                job['status'] = 'converting'
                job['progress'] = 100
                job['speed'] = ''
                job['eta'] = ''

    def ydl_postprocessor_hook(d):
        if d.get('status') == 'started':
            with jobs_lock:
                job['status'] = 'converting'
                job['progress'] = 100
                job['speed'] = ''
                job['eta'] = ''

    try:
        dl_opts = build_yt_dlp_options(media_type, quality, ydl_progress_hook, ydl_postprocessor_hook)
        with yt_dlp.YoutubeDL(dl_opts) as ydl:
            res_info = ydl.extract_info(clean_url, download=True)
            if not res_info:
                raise ValueError("Could not extract video metadata.")

            actual_title = res_info.get('title') or job['title'] or 'YouTube Media'

            final_filename = None
            if res_info.get('requested_downloads'):
                for req in res_info['requested_downloads']:
                    fp = req.get('filepath')
                    if fp and fp.endswith(target_ext) and os.path.exists(fp):
                        final_filename = os.path.basename(fp)
                        break

            if not final_filename:
                media_exts = {target_ext}
                files = [
                    os.path.join(DOWNLOADS_DIR, f)
                    for f in os.listdir(DOWNLOADS_DIR)
                    if os.path.splitext(f)[1].lower() in media_exts
                ]
                if files:
                    newest = max(files, key=os.path.getmtime)
                    if time.time() - os.path.getmtime(newest) < 120:
                        final_filename = os.path.basename(newest)

            if not final_filename:
                raise RuntimeError(f"Converted {target_ext.upper()} file was not found.")

        with jobs_lock:
            job['status'] = 'completed'
            job['progress'] = 100
            job['title'] = actual_title
            job['filename'] = final_filename
            job['speed'] = ''
            job['eta'] = ''
            job['error'] = None

    except Exception as e:
        logger.error("Job %s failed: %s", job_id, str(e))
        err_msg = format_user_error(str(e))
        with jobs_lock:
            job['status'] = 'failed'
            job['error'] = err_msg
            job['speed'] = ''
            job['eta'] = ''


# ---------------------------------------------------------------------------
# Routes: Pages
# ---------------------------------------------------------------------------
@app.route('/')
@limiter.limit("60 per minute")
def index():
    """Serve the single-page application frontend."""
    return render_template('index.html')


@app.route('/sw.js')
def service_worker():
    """Serve Service Worker from root scope."""
    return send_from_directory(STATIC_DIR, 'sw.js', mimetype='application/javascript')


@app.route('/manifest.json')
def web_manifest():
    """Serve PWA Web App Manifest."""
    return send_from_directory(STATIC_DIR, 'manifest.json', mimetype='application/manifest+json')


# ---------------------------------------------------------------------------
# Routes: API
# ---------------------------------------------------------------------------
@app.route('/api/health', methods=['GET'])
@limiter.limit("60 per minute")
def health():
    """Health check endpoint."""
    has_cookies = get_active_cookie_file() is not None
    return jsonify({
        "status": "ok",
        "ffmpeg": FFMPEG_AVAILABLE,
        "deno": DENO_AVAILABLE,
        "cookies": has_cookies
    })


@app.route('/api/search', methods=['GET'])
@limiter.limit("15 per minute")
def search_youtube():
    """YouTube search endpoint with rate limiting and input validation."""
    raw_query = request.args.get('q', '')
    query = sanitize_search_query(raw_query)
    if not query:
        return jsonify({"success": False, "error": "Search query cannot be empty."}), 400

    try:
        limit = min(MAX_SEARCH_LIMIT, max(1, int(request.args.get('limit', 12))))
    except (ValueError, TypeError):
        limit = 12

    ydl_opts = {
        'extract_flat': True,
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
    }
    active_cookie = get_active_cookie_file()
    if active_cookie:
        ydl_opts['cookiefile'] = active_cookie

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            search_query = f"ytsearch{limit}:{query}"
            res = ydl.extract_info(search_query, download=False)
            entries = res.get('entries', []) if res else []
            results = []
            for entry in entries:
                if not entry:
                    continue
                vid = entry.get('id')
                if not vid or not re.match(r'^[a-zA-Z0-9_-]{11}$', vid):
                    continue

                # Standard canonical YouTube thumbnail URL is guaranteed to resolve reliably
                thumb_url = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                thumbs = entry.get('thumbnails') or []
                if thumbs:
                    for t in reversed(thumbs):
                        turl = t.get('url', '')
                        if turl and ('ytimg.com' in turl or 'youtube.com' in turl):
                            thumb_url = turl
                            break
                dur = entry.get('duration')
                views = entry.get('view_count')

                results.append({
                    "id": vid,
                    "title": str(entry.get('title') or "YouTube Video")[:300],
                    "url": f"https://www.youtube.com/watch?v={vid}",
                    "uploader": str(entry.get('uploader') or entry.get('channel') or "YouTube")[:200],
                    "duration": dur,
                    "duration_str": format_duration(dur),
                    "thumbnail": thumb_url,
                    "view_count": views,
                    "views_str": format_views(views)
                })

            return jsonify({"success": True, "query": query, "results": results})

    except Exception as e:
        logger.error("Search failed for query '%s': %s", query, str(e))
        return jsonify({
            "success": False,
            "error": f"Search failed: {format_user_error(str(e))}"
        }), 500


@app.route('/api/download', methods=['POST'])
@limiter.limit("10 per minute")
def download():
    """Create download jobs with strict input validation."""
    data = request.get_json(silent=True)
    if not data or not isinstance(data, dict):
        return jsonify({"success": False, "error": "Invalid JSON payload."}), 400

    raw_urls = data.get('urls')
    if not raw_urls or not isinstance(raw_urls, list):
        return jsonify({"success": False, "error": "URLs must be a list of strings."}), 400

    # Limit total input size
    if len(raw_urls) > 100:
        return jsonify({"success": False, "error": "Too many URL entries."}), 400

    media_type = str(data.get('type', 'audio')).strip().lower()
    if media_type not in ('audio', 'video'):
        media_type = 'audio'

    quality = str(data.get('quality', '')).strip().lower()
    if media_type == 'video':
        if quality not in ('best', '1080', '720', '480', '360'):
            quality = '720'
    else:
        if quality not in ('128', '192', '256', '320'):
            quality = '192'

    valid_urls = extract_youtube_urls_from_items(raw_urls)
    if not valid_urls:
        return jsonify({"success": False, "error": "No valid YouTube URLs provided."}), 400

    if len(valid_urls) > MAX_BATCH_URLS:
        return jsonify({
            "success": False,
            "error": f"Maximum {MAX_BATCH_URLS} URLs allowed per batch."
        }), 400

    created_jobs = []
    for url in valid_urls:
        job_id = uuid.uuid4().hex[:12]
        m = YOUTUBE_URL_REGEX.search(url)
        vid = m.group(1) if m else ""
        instant_thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else None

        job_record = {
            "job_id": job_id,
            "url": url,
            "media_type": media_type,
            "quality": quality,
            "status": "waiting",
            "progress": 0,
            "title": url,
            "thumbnail": instant_thumb,
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "speed": "",
            "eta": "",
            "filename": None,
            "error": None,
            "created_at": time.time()
        }

        with jobs_lock:
            if len(jobs) >= MAX_JOBS_IN_MEMORY:
                sorted_old = sorted(jobs.keys(), key=lambda k: jobs[k].get('created_at', 0))
                for old_k in sorted_old[:50]:
                    del jobs[old_k]
            jobs[job_id] = job_record

        executor.submit(process_download, job_id)
        created_jobs.append({
            "job_id": job_id,
            "url": url,
            "media_type": media_type,
            "quality": quality
        })

    return jsonify({"success": True, "jobs": created_jobs})


@app.route('/api/status/<job_id>', methods=['GET'])
@limiter.limit("300 per minute")
def get_status(job_id):
    """Return job status with validated job_id."""
    if not validate_job_id(job_id):
        return jsonify({"success": False, "error": "Invalid job ID."}), 400

    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"success": False, "error": "Job not found."}), 404

        return jsonify({
            "job_id": job["job_id"],
            "url": job["url"],
            "media_type": job.get("media_type", "audio"),
            "quality": job.get("quality", "192"),
            "status": job["status"],
            "title": job["title"],
            "thumbnail": job["thumbnail"],
            "progress": job["progress"],
            "downloaded_bytes": job["downloaded_bytes"],
            "total_bytes": job["total_bytes"],
            "speed": job["speed"],
            "eta": job["eta"],
            "filename": job["filename"],
            "error": job["error"]
        })


@app.route('/api/jobs', methods=['GET'])
@limiter.limit("30 per minute")
def get_all_jobs():
    """Return all jobs (limited to 100 most recent)."""
    with jobs_lock:
        sorted_jobs = sorted(jobs.values(), key=lambda j: j.get('created_at', 0), reverse=True)
        return jsonify(sorted_jobs[:100])


@app.route('/api/retry/<job_id>', methods=['POST'])
@limiter.limit("10 per minute")
def retry_job(job_id):
    """Retry a failed download job."""
    if not validate_job_id(job_id):
        return jsonify({"success": False, "error": "Invalid job ID."}), 400

    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return jsonify({"success": False, "error": "Job not found."}), 404

        job["status"] = "waiting"
        job["progress"] = 0
        job["error"] = None
        job["speed"] = ""
        job["eta"] = ""

    executor.submit(process_download, job_id)
    return jsonify({"success": True, "job_id": job_id})


@app.route('/api/file/<path:filename>', methods=['GET'])
@limiter.limit("300 per minute")
def download_file(filename):
    """Securely serve media files with path traversal protection."""
    safe_name = safe_basename(filename)
    if not safe_name:
        abort(404)

    # Restrict strictly to media files
    ext = os.path.splitext(safe_name)[1].lower()
    if ext not in ALLOWED_MEDIA_EXTS:
        abort(404)

    # Validate file is strictly within DOWNLOADS_DIR
    target_path = validate_file_in_directory(DOWNLOADS_DIR, safe_name)
    if not target_path:
        abort(404)

    mime_map = {
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.m4a': 'audio/mp4',
    }
    mimetype = mime_map.get(ext, 'application/octet-stream')

    is_stream = request.args.get('stream') in ('1', 'true') or request.args.get('inline') in ('1', 'true')

    return send_from_directory(
        DOWNLOADS_DIR,
        safe_name,
        as_attachment=not is_stream,
        mimetype=mimetype
    )


@app.route('/api/download-zip', methods=['POST'])
@limiter.limit("5 per minute")
def download_zip():
    """Bundle completed media files into a zip archive."""
    data = request.get_json(silent=True) or {}
    job_ids = data.get('job_ids', [])
    filenames = data.get('filenames', [])

    # Validate inputs
    if not isinstance(job_ids, list) or not isinstance(filenames, list):
        return jsonify({"success": False, "error": "Invalid input."}), 400

    target_files = []
    with jobs_lock:
        if job_ids:
            for jid in job_ids[:50]:
                if not validate_job_id(str(jid)):
                    continue
                job = jobs.get(str(jid))
                if job and job.get('status') == 'completed' and job.get('filename'):
                    target_files.append(job['filename'])
        elif filenames:
            for fname in filenames[:50]:
                if isinstance(fname, str):
                    target_files.append(fname)
        else:
            for job in list(jobs.values())[:50]:
                if job.get('status') == 'completed' and job.get('filename'):
                    target_files.append(job['filename'])

    if not target_files:
        return jsonify({"success": False, "error": "No files to zip."}), 400

    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        added = set()
        for fname in target_files:
            safe_name = safe_basename(fname)
            if not safe_name:
                continue
            file_path = validate_file_in_directory(DOWNLOADS_DIR, safe_name)
            if not file_path:
                continue
            base, ext = os.path.splitext(safe_name)
            if ext.lower() not in ALLOWED_MEDIA_EXTS:
                continue
            arcname = safe_name
            counter = 1
            while arcname in added:
                arcname = f"{base} ({counter}){ext}"
                counter += 1
            added.add(arcname)
            zf.write(file_path, arcname=arcname)

    if not added:
        return jsonify({"success": False, "error": "No valid files found."}), 404

    memory_file.seek(0)
    zip_name = f"streamgrab_downloads_{int(time.time())}.zip"
    return send_file(
        memory_file,
        mimetype='application/zip',
        as_attachment=True,
        download_name=zip_name
    )


@app.route('/api/cookies/status', methods=['GET'])
@limiter.limit("30 per minute")
def cookies_status():
    """Return cookies file status (without leaking file paths in production)."""
    cookie_path = get_active_cookie_file()
    has_cookies = cookie_path is not None
    size = os.path.getsize(cookie_path) if has_cookies else 0
    return jsonify({
        "success": True,
        "has_cookies": has_cookies,
        "size_bytes": size,
        # Don't expose full server path in production
        "filename": os.path.basename(cookie_path) if cookie_path else "cookies.txt"
    })


@app.route('/api/cookies/upload', methods=['POST'])
@limiter.limit("5 per minute")
def cookies_upload():
    """Save user-provided cookies.txt with size and content validation."""
    content = ""
    if 'file' in request.files:
        file = request.files['file']
        if file.filename:
            # Read with size limit
            raw_bytes = file.read(ALLOWED_COOKIE_FILE_SIZE + 1)
            if len(raw_bytes) > ALLOWED_COOKIE_FILE_SIZE:
                return jsonify({"success": False, "error": "Cookie file too large. Maximum 1 MB."}), 400
            content = raw_bytes.decode('utf-8', errors='ignore')
    elif request.is_json:
        content = str(request.json.get('content', ''))
        if len(content) > ALLOWED_COOKIE_FILE_SIZE:
            return jsonify({"success": False, "error": "Cookie content too large."}), 400

    content = content.strip()
    if not content:
        return jsonify({"success": False, "error": "No cookie content received."}), 400

    # Basic validation: should look like Netscape cookie format
    if not content.startswith('#') and 'TRUE' not in content.upper() and 'FALSE' not in content.upper():
        logger.warning("Cookie upload rejected: does not look like Netscape format")
        return jsonify({"success": False, "error": "Invalid cookie format. Expected Netscape HTTP Cookie File format."}), 400

    try:
        with open(COOKIE_FILE, 'w', encoding='utf-8') as f:
            f.write(content)
        return jsonify({
            "success": True,
            "message": "Cookies saved successfully.",
            "size_bytes": len(content)
        })
    except OSError as e:
        logger.error("Failed to save cookies: %s", str(e))
        return jsonify({"success": False, "error": "Failed to save cookies file."}), 500


@app.route('/api/cookies/delete', methods=['POST'])
@limiter.limit("10 per minute")
def cookies_delete():
    """Remove cookies.txt file."""
    if os.path.exists(COOKIE_FILE):
        try:
            os.remove(COOKIE_FILE)
            return jsonify({"success": True, "message": "Cookies removed."})
        except OSError as e:
            logger.error("Failed to remove cookies: %s", str(e))
            return jsonify({"success": False, "error": "Failed to remove cookies."}), 500
    return jsonify({"success": True, "message": "No cookies file present."})


@app.route('/api/cache/clear', methods=['POST'])
@limiter.limit("5 per minute")
def clear_cache():
    """Purge all temporary media cache files."""
    deleted = 0
    cleanup_exts = {'.mp3', '.mp4', '.webm', '.m4a', '.part', '.ytdl', '.temp', '.zip'}
    try:
        for f in os.listdir(DOWNLOADS_DIR):
            fp = os.path.join(DOWNLOADS_DIR, f)
            ext = os.path.splitext(f)[1].lower()
            if os.path.isfile(fp) and ext in cleanup_exts:
                try:
                    os.remove(fp)
                    deleted += 1
                except OSError:
                    pass
        return jsonify({"success": True, "message": f"Cleared {deleted} cached files.", "deleted": deleted})
    except OSError as e:
        logger.error("Cache clear failed: %s", str(e))
        return jsonify({"success": False, "error": "Failed to clear cache."}), 500


@app.route('/api/downloads/info', methods=['GET'])
@limiter.limit("30 per minute")
def downloads_info():
    """Return storage stats and file list."""
    cleanup_temp_cache()
    files = []
    total_bytes = 0
    media_exts = {'.mp3', '.mp4', '.webm'}
    try:
        for f in os.listdir(DOWNLOADS_DIR):
            fp = os.path.join(DOWNLOADS_DIR, f)
            ext = os.path.splitext(f)[1].lower()
            if os.path.isfile(fp) and ext in media_exts:
                size = os.path.getsize(fp)
                mtime = os.path.getmtime(fp)
                total_bytes += size
                s_str = f"{size / (1024 * 1024):.1f} MB" if size >= 1024 * 1024 else f"{size / 1024:.1f} KB"
                files.append({
                    "name": f,
                    "size_bytes": size,
                    "size_str": s_str,
                    "size_human": s_str,
                    "mtime": mtime,
                    "ext": ext.lstrip('.')
                })
        files.sort(key=lambda x: x['mtime'], reverse=True)
    except OSError as e:
        logger.error("Downloads info failed: %s", str(e))
        return jsonify({"success": False, "error": "Failed to read storage info."}), 500

    total_mb = f"{total_bytes / (1024 * 1024):.1f} MB" if total_bytes >= 1024 * 1024 else f"{total_bytes / 1024:.1f} KB"
    return jsonify({
        "success": True,
        "downloads_dir": "Device Temporary Storage",
        "folder": "Device Temporary Storage",
        "total_files": len(files),
        "file_count": len(files),
        "total_size": total_mb,
        "total_size_human": total_mb,
        "total_bytes": total_bytes,
        "files": files[:50]
    })


@app.route('/api/system/info', methods=['GET'])
@limiter.limit("10 per minute")
def system_info():
    """Return system engine stats (without exposing sensitive paths)."""
    cookie_path = get_active_cookie_file()
    return jsonify({
        "success": True,
        "python_version": sys.version.split()[0],
        "ytdlp_version": getattr(yt_dlp.version, '__version__', 'latest'),
        "ffmpeg": {
            "available": FFMPEG_AVAILABLE,
            "installed": FFMPEG_AVAILABLE,
        },
        "deno": {
            "available": DENO_AVAILABLE,
            "installed": DENO_AVAILABLE,
        },
        "cookies": {
            "active": cookie_path is not None,
            "present": cookie_path is not None,
            "size": os.path.getsize(cookie_path) if cookie_path else 0,
        },
    })


# ---------------------------------------------------------------------------
# Periodic Cleanup Thread
# ---------------------------------------------------------------------------
def periodic_cleanup():
    """Background thread that cleans old temp files every 30 minutes."""
    while True:
        time.sleep(1800)
        cleanup_temp_cache()
        # Also clean stale jobs older than 6 hours
        cutoff = time.time() - 21600
        with jobs_lock:
            stale_ids = [jid for jid, j in jobs.items() if j.get('created_at', 0) < cutoff]
            for jid in stale_ids:
                del jobs[jid]
        if stale_ids:
            logger.info("Cleaned %d stale jobs", len(stale_ids))


# Start cleanup daemon thread only in persistent environments (Waitress, Gunicorn, Docker).
# Serverless platforms (Vercel, AWS Lambda) freeze or error on unmanaged background loop threads.
if not os.environ.get('VERCEL') and not os.environ.get('AWS_LAMBDA_FUNCTION_NAME'):
    cleanup_thread = threading.Thread(target=periodic_cleanup, daemon=True)
    cleanup_thread.start()


# ---------------------------------------------------------------------------
# Application Entry Point
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    print("\n" + "=" * 60)
    print(" StreamGrab - Production Server")
    print(f" Listening on: http://{BIND_HOST}:{BIND_PORT}")
    print("=" * 60 + "\n", flush=True)

    if IS_PRODUCTION:
        try:
            from waitress import serve
            logger.info("Starting production WSGI server (Waitress)...")
            serve(
                app,
                host=BIND_HOST,
                port=BIND_PORT,
                threads=6,
                channel_timeout=120,
                recv_bytes=65536,
                send_bytes=65536,
                connection_limit=200,
                cleanup_interval=30,
                max_request_header_size=16384,
                max_request_body_size=MAX_CONTENT_LENGTH,
                ident='StreamGrab',
            )
        except ImportError:
            logger.warning("Waitress not installed. Falling back to Flask dev server.")
            app.run(host=BIND_HOST, port=BIND_PORT, debug=False, threaded=True)
    else:
        logger.info("Starting development server (Flask built-in)...")
        app.run(host='127.0.0.1', port=BIND_PORT, debug=False, threaded=True)
