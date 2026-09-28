import sys
import os

# Add root directory to sys.path so server and sibling modules can be imported
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

# Import the configured Flask WSGI application instance
from server import app

# Vercel Serverless Function entry point
# Vercel automatically discovers and invokes `app`
if __name__ == '__main__':
    app.run()
