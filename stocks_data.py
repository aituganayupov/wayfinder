"""
Получение котировок акций через Yahoo Finance (сервер-сайд, чтобы обойти CORS).
investing.com закрыт от автоматических запросов (Cloudflare), поэтому используется
Yahoo Finance — тот же тип данных: цена и изменение за день.
"""

import json
import urllib.error
import urllib.parse
import urllib.request

STOCK_LIST = [
    {"symbol": "AAPL", "name": "Apple"},
    {"symbol": "MSFT", "name": "Microsoft"},
    {"symbol": "GOOGL", "name": "Alphabet (Google)"},
    {"symbol": "AMZN", "name": "Amazon"},
    {"symbol": "TSLA", "name": "Tesla"},
    {"symbol": "NVDA", "name": "NVIDIA"},
    {"symbol": "META", "name": "Meta Platforms"},
    {"symbol": "NFLX", "name": "Netflix"},
    {"symbol": "SBER.ME", "name": "Сбербанк"},
    {"symbol": "GAZP.ME", "name": "Газпром"},
    {"symbol": "LKOH.ME", "name": "Лукойл"},
    {"symbol": "GMKN.ME", "name": "Норникель"},
    {"symbol": "ROSN.ME", "name": "Роснефть"},
    {"symbol": "YDEX.ME", "name": "Яндекс"},
]

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"

# Yahoo Finance почти не индексирует российские акции в поиске (даже по кириллице
# запрос может вернуть ошибку), хотя сами котировки по тикеру доступны нормально.
# Поэтому для популярных российских компаний используем локальный словарь алиасов.
RUSSIAN_ALIASES = [
    {"symbol": "SBER.ME", "name": "Сбербанк", "aliases": ["сбер", "сбербанк", "sber"]},
    {"symbol": "GAZP.ME", "name": "Газпром", "aliases": ["газпром", "gazprom"]},
    {"symbol": "LKOH.ME", "name": "Лукойл", "aliases": ["лукойл", "lukoil"]},
    {"symbol": "GMKN.ME", "name": "Норникель", "aliases": ["норникель", "норильский никель"]},
    {"symbol": "ROSN.ME", "name": "Роснефть", "aliases": ["роснефть", "rosneft"]},
    {"symbol": "YDEX.ME", "name": "Яндекс", "aliases": ["яндекс", "yandex"]},
    {"symbol": "MGNT.ME", "name": "Магнит", "aliases": ["магнит"]},
    {"symbol": "MTSS.ME", "name": "МТС", "aliases": ["мтс"]},
    {"symbol": "NLMK.ME", "name": "НЛМК", "aliases": ["нлмк"]},
    {"symbol": "PLZL.ME", "name": "Полюс", "aliases": ["полюс"]},
    {"symbol": "TATN.ME", "name": "Татнефть", "aliases": ["татнефть"]},
    {"symbol": "MOEX.ME", "name": "Московская биржа", "aliases": ["мосбиржа", "московская биржа"]},
    {"symbol": "AFLT.ME", "name": "Аэрофлот", "aliases": ["аэрофлот"]},
    {"symbol": "VTBR.ME", "name": "ВТБ", "aliases": ["втб"]},
    {"symbol": "ROSN.ME", "name": "Роснефть", "aliases": ["роснефть"]},
    {"symbol": "CHMF.ME", "name": "Северсталь", "aliases": ["северсталь"]},
    {"symbol": "ALRS.ME", "name": "Алроса", "aliases": ["алроса"]},
    {"symbol": "SNGS.ME", "name": "Сургутнефтегаз", "aliases": ["сургутнефтегаз"]},
    {"symbol": "OZON.ME", "name": "Ozon", "aliases": ["озон", "ozon"]},
]


def _is_cyrillic(text):
    return any("а" <= ch.lower() <= "я" or ch.lower() == "ё" for ch in text)


def _search_russian_aliases(query, limit):
    q_lower = query.lower().strip()
    matches = []
    seen = set()
    for entry in RUSSIAN_ALIASES:
        if entry["symbol"] in seen:
            continue
        if any(alias in q_lower or q_lower in alias for alias in entry["aliases"]):
            matches.append({"symbol": entry["symbol"], "name": entry["name"]})
            seen.add(entry["symbol"])
    return matches[:limit]


def fetch_stock_quote(stock):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{stock['symbol']}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    meta = (data.get("chart") or {}).get("result", [{}])[0].get("meta")
    if not meta or meta.get("regularMarketPrice") is None:
        raise ValueError("no data")

    price = meta["regularMarketPrice"]
    prev_close = meta.get("previousClose") or meta.get("chartPreviousClose") or price
    change = ((price - prev_close) / prev_close) * 100 if prev_close else 0

    return {
        "symbol": stock["symbol"],
        "name": stock["name"],
        "price": price,
        "change": change,
        "currency": meta.get("currency", "USD"),
    }


def collect_all_stocks():
    stocks = []
    errors = []

    for stock in STOCK_LIST:
        try:
            stocks.append(fetch_stock_quote(stock))
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError) as exc:
            errors.append({"symbol": stock["symbol"], "error": str(exc)})

    return {"stocks": stocks, "errors": errors}


def search_symbols(query, limit=10):
    """Ищет тикеры по названию/коду компании — покрывает практически весь рынок."""
    # Сначала — локальный словарь популярных российских компаний (по-русски)
    alias_matches = _search_russian_aliases(query, limit)
    if alias_matches:
        return alias_matches

    # Yahoo Finance не индексирует кириллицу в поиске и может вернуть ошибку —
    # не дёргаем API впустую для запросов, которых там точно нет
    if _is_cyrillic(query):
        return []

    url = (
        "https://query2.finance.yahoo.com/v1/finance/search?"
        + urllib.parse.urlencode({"q": query, "quotesCount": limit, "newsCount": 0})
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    matches = []
    for q in data.get("quotes", []):
        if q.get("quoteType") != "EQUITY" or not q.get("symbol"):
            continue
        matches.append({
            "symbol": q["symbol"],
            "name": q.get("shortname") or q.get("longname") or q["symbol"],
        })
    return matches[:limit]


def search_and_quote_stocks(query, limit=8):
    matches = search_symbols(query, limit)
    stocks = []
    errors = []

    for stock in matches:
        try:
            stocks.append(fetch_stock_quote(stock))
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError) as exc:
            errors.append({"symbol": stock["symbol"], "error": str(exc)})

    return {"stocks": stocks, "errors": errors}
