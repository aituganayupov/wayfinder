"""
Локальный сервер для сайта (необязателен для обычной работы).
Раздаёт статические файлы и добавляет API-эндпоинт /api/study-news
для живого обновления новостей без перезапуска update_news.py.
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from telegram_news import collect_all_news
from stocks_data import collect_all_stocks, search_and_quote_stocks, search_symbols
from charts_data import fetch_history, fetch_quotes
from commodities_data import collect_all_commodities
from indices_data import collect_all_indices
from rates_data import collect_all_rates
from events_data import get_events_cached
from news_data import get_news_cached

PORT = 5173
ROOT_DIR = Path(__file__).parent.resolve()


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path):
        if not path.is_file():
            self.send_error(404, "File not found")
            return
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
        }
        ctype = content_types.get(path.suffix, "application/octet-stream")
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/study-news"):
            raw_channels = parse_qs(urlparse(self.path).query).get("channels", [""])[0]
            channels = [c.strip().lstrip("@") for c in raw_channels.split(",") if c.strip()]
            try:
                data = collect_all_news(channels or None)
                self._send_json(data)
            except Exception as exc:  # noqa: BLE001
                self._send_json({"posts": [], "errors": [{"error": str(exc)}]}, status=500)
            return

        if self.path.startswith("/api/commodities"):
            try:
                self._send_json(collect_all_commodities())
            except Exception as exc:  # noqa: BLE001
                self._send_json({"items": [], "errors": [{"error": str(exc)}]}, status=500)
            return

        if self.path.startswith("/api/news"):
            try:
                self._send_json(get_news_cached())
            except Exception as exc:  # noqa: BLE001
                self._send_json({"items": [], "quotes": {}, "errors": [{"error": str(exc)}]}, status=500)
            return

        if self.path.startswith("/api/events"):
            try:
                self._send_json(get_events_cached())
            except Exception as exc:  # noqa: BLE001
                self._send_json({"events": [], "errors": [{"error": str(exc)}]}, status=500)
            return

        if self.path.startswith("/api/rates"):
            try:
                self._send_json(collect_all_rates())
            except Exception as exc:  # noqa: BLE001
                self._send_json({"errors": [{"error": str(exc)}]}, status=500)
            return

        if self.path.startswith("/api/indices"):
            try:
                self._send_json(collect_all_indices())
            except Exception as exc:  # noqa: BLE001
                self._send_json({"items": [], "errors": [{"error": str(exc)}]}, status=500)
            return

        if self.path.startswith("/api/quotes"):
            raw = parse_qs(urlparse(self.path).query).get("symbols", [""])[0]
            try:
                self._send_json({"quotes": fetch_quotes([s.strip() for s in raw.split(",")])})
            except Exception as exc:  # noqa: BLE001
                self._send_json({"quotes": {}, "errors": [{"error": str(exc)}]}, status=500)
            return

        if self.path.startswith("/api/history"):
            params = parse_qs(urlparse(self.path).query)
            arg = lambda name: params.get(name, [""])[0].strip()  # noqa: E731
            try:
                self._send_json(fetch_history(arg("kind"), arg("symbol"), arg("period")))
            except Exception as exc:  # noqa: BLE001
                self._send_json({"points": [], "errors": [{"error": str(exc)}]}, status=500)
            return

        if self.path.startswith("/api/symbols"):
            query = parse_qs(urlparse(self.path).query).get("q", [""])[0].strip()
            try:
                self._send_json({"symbols": search_symbols(query) if query else []})
            except Exception as exc:  # noqa: BLE001
                self._send_json({"symbols": [], "errors": [{"error": str(exc)}]}, status=500)
            return

        if self.path.startswith("/api/stocks/search"):
            query = parse_qs(urlparse(self.path).query).get("q", [""])[0].strip()
            if not query:
                self._send_json({"stocks": [], "errors": []})
                return
            try:
                data = search_and_quote_stocks(query)
                self._send_json(data)
            except Exception as exc:  # noqa: BLE001
                self._send_json({"stocks": [], "errors": [{"error": str(exc)}]}, status=500)
            return

        if self.path.startswith("/api/stocks"):
            try:
                data = collect_all_stocks()
                self._send_json(data)
            except Exception as exc:  # noqa: BLE001
                self._send_json({"stocks": [], "errors": [{"error": str(exc)}]}, status=500)
            return

        url_path = self.path.split("?")[0]
        if url_path == "/":
            url_path = "/index.html"
        file_path = (ROOT_DIR / url_path.lstrip("/")).resolve()

        if ROOT_DIR not in file_path.parents and file_path != ROOT_DIR:
            self.send_error(403, "Forbidden")
            return

        self._send_file(file_path)

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("", PORT), Handler)
    print(f"Сервер запущен: http://localhost:{PORT}")
    server.serve_forever()
