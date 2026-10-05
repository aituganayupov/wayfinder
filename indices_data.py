"""
Мировые фондовые индексы через Yahoo Finance (сервер-сайд, чтобы обойти CORS).
Индексы Мосбиржи (IMOEX, RTSI) сайт берёт напрямую из официального API
Московской биржи (iss.moex.com) — Yahoo их не транслирует.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from stocks_data import USER_AGENT

INDEX_LIST = [
    {"symbol": "^GSPC", "name": "S&P 500"},
    {"symbol": "^IXIC", "name": "NASDAQ Composite"},
    {"symbol": "^DJI", "name": "Dow Jones"},
    {"symbol": "^VIX", "name": "VIX"},
    {"symbol": "^GDAXI", "name": "DAX"},
    {"symbol": "^FTSE", "name": "FTSE 100"},
    {"symbol": "^FCHI", "name": "CAC 40"},
    {"symbol": "^STOXX50E", "name": "Euro Stoxx 50"},
    {"symbol": "^N225", "name": "Nikkei 225"},
    {"symbol": "^HSI", "name": "Hang Seng"},
    {"symbol": "000001.SS", "name": "Shanghai Composite"},
]


def fetch_index(index):
    symbol = urllib.parse.quote(index["symbol"])
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1h"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=10) as resp:
        result = json.loads(resp.read().decode("utf-8"))["chart"]["result"][0]

    meta = result["meta"]
    price = meta.get("regularMarketPrice")
    if price is None:
        raise ValueError("no data")

    prev_close = meta.get("previousClose") or meta.get("chartPreviousClose") or price
    closes = result.get("indicators", {}).get("quote", [{}])[0].get("close") or []
    regular = meta.get("currentTradingPeriod", {}).get("regular", {})
    now = time.time()

    return {
        "symbol": index["symbol"],
        "name": index["name"],
        "price": price,
        "change": ((price - prev_close) / prev_close) * 100 if prev_close else 0,
        "changeAbs": price - prev_close,
        "currency": meta.get("currency"),
        "dayHigh": meta.get("regularMarketDayHigh"),
        "dayLow": meta.get("regularMarketDayLow"),
        "yearHigh": meta.get("fiftyTwoWeekHigh"),
        "yearLow": meta.get("fiftyTwoWeekLow"),
        "isOpen": regular.get("start", 0) <= now < regular.get("end", 0),
        "marketTime": meta.get("regularMarketTime"),
        "spark": [c for c in closes if c is not None],
    }


def _fetch(index):
    try:
        return fetch_index(index), None
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, KeyError, TimeoutError) as exc:
        return None, {"symbol": index["symbol"], "error": str(exc)}


def collect_all_indices():
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_fetch, INDEX_LIST))

    return {
        "items": [item for item, _ in results if item],
        "errors": [err for _, err in results if err],
    }
