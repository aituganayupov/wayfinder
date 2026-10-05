"""
Лента новостей рынка: RSS деловых СМИ (Финам, Прайм, Интерфакс, РБК, ТАСС,
Коммерсантъ, Банки.ру, ForkLog) + новости по тикерам из Yahoo Finance,
а также котировки активов, которые не отдают CORS прямо в браузер.
Привязку новостей к активам делает сайт по ключевым словам.
"""

import email.utils
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from commodities_data import fetch_commodity_quote
from stocks_data import USER_AGENT

RSS_FEEDS = [
    {"name": "Финам", "url": "https://www.finam.ru/analysis/conews/rsspoint/"},
    {"name": "Финам", "url": "https://www.finam.ru/analysis/nslent/rsspoint/"},
    {"name": "Прайм", "url": "https://1prime.ru/export/rss2/finance/index.xml"},
    {"name": "Прайм", "url": "https://1prime.ru/export/rss2/business/index.xml"},
    {"name": "Интерфакс", "url": "https://www.interfax.ru/rss.asp"},
    {"name": "РБК", "url": "https://rssexport.rbc.ru/rbcnews/news/30/full.rss"},
    {"name": "ТАСС", "url": "https://tass.ru/rss/v2.xml"},
    {"name": "Коммерсантъ", "url": "https://www.kommersant.ru/RSS/section-economics.xml"},
    {"name": "Банки.ру", "url": "https://www.banki.ru/xml/news.rss"},
    {"name": "ForkLog", "url": "https://forklog.com/feed"},
]

# Англоязычные новости Yahoo Finance по конкретным тикерам
YAHOO_NEWS_SYMBOLS = ["AAPL", "NVDA", "TSLA", "MSFT", "BTC-USD", "ETH-USD", "SOL-USD"]

# Котировки, которые браузер не может получить напрямую (CORS)
QUOTE_SYMBOLS = ["AAPL", "NVDA", "TSLA", "MSFT", "BZ=F", "GC=F", "RUB=X"]

KEEP_SECONDS = 4 * 86400
MAX_ITEMS = 1200


def _get(url, attempts=2):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                return resp.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts - 1:
                raise
            time.sleep(1)


def _text(raw):
    raw = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", raw or "", flags=re.S)
    raw = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    return re.sub(r"\s+", " ", html.unescape(raw)).strip()


def _tag(item, name):
    match = re.search(rf"<{name}[^>]*>(.*?)</{name}>", item, re.S)
    return match.group(1) if match else ""


def _safe_link(link):
    link = _text(link)
    return link if link.startswith(("http://", "https://")) else ""


def fetch_feed(feed):
    items = []
    for raw in re.findall(r"<item[ >](.*?)</item>", _get(feed["url"]), re.S):
        title = _text(_tag(raw, "title"))
        link = _safe_link(_tag(raw, "link"))
        try:
            published = email.utils.parsedate_to_datetime(_text(_tag(raw, "pubDate"))).timestamp()
        except (TypeError, ValueError):
            continue
        if not title or not link:
            continue
        items.append({
            "title": title,
            "summary": _text(_tag(raw, "description"))[:280],
            "link": link,
            "source": feed["name"],
            "published": int(published),
            "lang": "ru",
        })
    return items


def fetch_yahoo_news(symbol):
    url = "https://query2.finance.yahoo.com/v1/finance/search?" + urllib.parse.urlencode(
        {"q": symbol, "quotesCount": 0, "newsCount": 8}
    )
    data = json.loads(_get(url))
    items = []
    for news in data.get("news", []):
        link = _safe_link(news.get("link", ""))
        if not link or not news.get("title"):
            continue
        items.append({
            "title": _text(news["title"]),
            "summary": "",
            "link": link,
            "source": news.get("publisher") or "Yahoo Finance",
            "published": int(news.get("providerPublishTime") or 0),
            "lang": "en",
            "symbol": symbol,
        })
    return items


def _safe(fn, arg):
    try:
        return fn(arg), None
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, KeyError, TimeoutError) as exc:
        return [], str(exc)


def _quote(symbol):
    try:
        return fetch_commodity_quote({"symbol": symbol, "name": symbol})
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, KeyError, TimeoutError):
        return None


def collect_news(previous_items=None):
    with ThreadPoolExecutor(max_workers=10) as pool:
        feed_results = list(pool.map(lambda f: _safe(fetch_feed, f), RSS_FEEDS))
        yahoo_results = list(pool.map(lambda s: _safe(fetch_yahoo_news, s), YAHOO_NEWS_SYMBOLS))
        quotes = list(pool.map(_quote, QUOTE_SYMBOLS))

    errors = [
        {"source": feed["name"], "error": err}
        for feed, (_, err) in zip(RSS_FEEDS, feed_results) if err
    ]

    merged = {}
    now = time.time()
    for item in (previous_items or []) + [i for items, _ in feed_results + yahoo_results for i in items]:
        if now - item["published"] > KEEP_SECONDS:
            continue
        key = item["link"]
        if key not in merged or item.get("symbol"):
            merged[key] = item

    items = sorted(merged.values(), key=lambda i: i["published"], reverse=True)[:MAX_ITEMS]
    return {
        "items": items,
        "quotes": {q["symbol"]: q for q in quotes if q},
        "errors": errors,
    }


_cache = {"time": 0, "data": None}


def get_news_cached(max_age=300):
    """Новости копятся в памяти сервера: каждая загрузка дополняет ленту, а не заменяет её."""
    if _cache["data"] is None or time.time() - _cache["time"] > max_age:
        previous = _cache["data"]["items"] if _cache["data"] else _load_offline_items()
        _cache["data"] = collect_news(previous)
        _cache["time"] = time.time()
    return _cache["data"]


def _load_offline_items():
    from pathlib import Path

    path = Path(__file__).parent / "news-data.js"
    if not path.exists():
        return []
    try:
        text = path.read_text(encoding="utf-8")
        return json.loads(text[text.index("=") + 1:].rstrip().rstrip(";")).get("items", [])
    except (ValueError, OSError):
        return []
