"""
StreamGrab - Main Application Entrypoint
Provides top-level `app` instance for Vercel, Render, Gunicorn, and local runtime.
"""
import os
import sys

# Ensure root directory is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from server import app

# Aliases for various WSGI runners (Vercel, Gunicorn, uWSGI)
application = app
handler = app

if __name__ == '__main__':
    from server import BIND_HOST, BIND_PORT, IS_PRODUCTION
    if IS_PRODUCTION:
        try:
            from waitress import serve
            serve(app, host=BIND_HOST, port=BIND_PORT)
        except ImportError:
            app.run(host=BIND_HOST, port=BIND_PORT, debug=False)
    else:
        app.run(host='127.0.0.1', port=BIND_PORT, debug=False)
