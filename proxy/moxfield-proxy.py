#!/usr/bin/env python3
"""
Moxfield import proxy for Commander Tracker.

Moxfield has no official public API and its Cloudflare protection blocks
requests from browsers, but lets Python's `requests` library through. This
answers GET /moxfield/decks/{id} with the deck JSON and CORS headers, the
same contract as Mulligan's proxy-server.py (either one works).

    pip install requests
    python3 proxy/moxfield-proxy.py        # listens on http://localhost:3001

Then set Settings -> Moxfield import proxy to http://localhost:3001 in the app
on the same computer. Phones need an https proxy; see cloudflare-worker.js.
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import re

import requests

MOXFIELD_API = "https://api.moxfield.com/v2/decks/all/"
HEADERS = {"Accept": "application/json", "User-Agent": "CommanderTracker/1.0 (playgroup life tracker)"}
PORT = 3001
DECK_ID_RE = re.compile(r"^/moxfield/decks/([A-Za-z0-9_-]+)/?$")


class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        match = DECK_ID_RE.match(self.path)
        if not match:
            self._respond(404, {"error": "Not found. Use /moxfield/decks/{id}"})
            return
        try:
            resp = requests.get(MOXFIELD_API + match.group(1), headers=HEADERS, timeout=15)
            self.send_response(resp.status_code)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(resp.content)
        except Exception as e:  # network errors, timeouts
            self._respond(502, {"error": str(e)})

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")

    def _respond(self, code, body):
        self.send_response(code)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())


if __name__ == "__main__":
    print(f"Moxfield proxy on http://localhost:{PORT}")
    HTTPServer(("0.0.0.0", PORT), ProxyHandler).serve_forever()
