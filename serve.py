"""Runs pyrite on your own computer: python serve.py [port]

Same as `python -m http.server`, with two changes so the browser never shows stale files:
  * every response says "re-check me each time" (Cache-Control: no-cache), and
  * index.html is served with each stylesheet/script link stamped with that file's last-modified
    time (style.css?v=1761350000), so an edited file is always a brand-new address to the browser.
"""
import http.server
import os
import re
import sys

LINK = re.compile(rb'(href|src)="((?:style|gate)\.css|(?:config|games|app)\.js)"')


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/index.html"):
            page = os.path.join(self.directory, "index.html")
            try:
                with open(page, "rb") as f:
                    html = f.read()
            except OSError:
                return super().do_GET()

            def stamp(m):
                try:
                    version = int(os.path.getmtime(os.path.join(self.directory, m.group(2).decode())))
                except OSError:
                    return m.group(0)
                return b'%s="%s?v=%d"' % (m.group(1), m.group(2), version)

            body = LINK.sub(stamp, html)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
print(f"serving on http://localhost:{port}")
http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
