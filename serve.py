"""Runs pyrite on your own computer: python serve.py [port]

Same as `python -m http.server`, but it tells the browser to re-check every file each time, so a normal
refresh always shows your latest changes (no stale stylesheet or script after an edit)."""
import http.server
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
print(f"serving on http://localhost:{port}")
http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
