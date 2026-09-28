# StreamGrab Production Dockerfile
FROM python:3.12-slim

# Prevent Python from writing .pyc and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STREAMGRAB_ENV=production \
    STREAMGRAB_HOST=0.0.0.0 \
    STREAMGRAB_PORT=5000

# Install FFmpeg, Node.js (for YouTube JS challenge solver in yt-dlp), and clean up apt caches
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg curl nodejs && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Expose StreamGrab port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5000/api/health || exit 1

# Start production server via Waitress WSGI
CMD ["python", "server.py"]
