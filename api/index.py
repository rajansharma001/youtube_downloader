import sys
import os

# Add root directory to sys.path so server and sibling modules can be imported
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

try:
    from server import app
except Exception as e:
    import traceback
    from flask import Flask, jsonify
    app = Flask(__name__)
    err_trace = traceback.format_exc()
    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def catch_all(path):
        return jsonify({
            "error": "Failed to initialize StreamGrab server on Vercel",
            "message": str(e),
            "traceback": err_trace
        }), 500

if __name__ == '__main__':
    app.run()
