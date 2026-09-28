"""
StreamGrab - Main Application Entrypoint for Vercel, Waitress, and Production
"""
import os
import sys
import traceback

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

try:
    from server import app
    application = app
    handler = app
except Exception as e:
    tb = traceback.format_exc()
    sys.stderr.write(f"FATAL ERROR INITIALIZING SERVER:\n{tb}\n")
    from flask import Flask, jsonify
    app = Flask(__name__)
    application = app
    handler = app

    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def vercel_diag(path):
        return jsonify({
            "error": "StreamGrab initialization error on Vercel",
            "exception_type": type(e).__name__,
            "exception_message": str(e),
            "traceback": tb.splitlines()
        }), 500

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
