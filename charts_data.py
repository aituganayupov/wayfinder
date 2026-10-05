"""
Котировки и история цен для «Избранного», портфеля и графиков — то, что браузер
не может получить сам из-за CORS: зарубежные акции, индексы, сырьё (Yahoo Finance)
и курсы валют к рублю (Yahoo Finance внутри дня, официальные курсы Банка России по дням).
Криптовалюты (Bybit) и российские акции (Мосбиржа) сайт загружает напрямую.
"""

import datetime
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from commodities_data import COMMODITY_LIST, brent_front_contract, brent_front_since, fetch_commodity_quote
from indices_data import INDEX_LIST
from stocks_data import USER_AGENT

# Что облачное автообновление готовит заранее для сайта без сервера (GitHub Pages).
# Списки совпадают с каталогом активов в app.js (WORLD_STOCKS, INDEX_GROUPS, COMMODITY_GROUPS, FIAT_POPULAR).
STATIC_WORLD_STOCKS = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "NFLX", "AMD", "INTC", "TSM", "ORCL", "PLTR",
    "COIN", "JPM", "V", "MA", "KO", "MCD", "DIS", "NKE", "BABA", "UBER", "BRK-B", "SPY", "QQQ",
]
STATIC_YAHOO = STATIC_WORLD_STOCKS + [i["symbol"] for i in INDEX_LIST] + [c["symbol"] for c in COMMODITY_LIST]
STATIC_FIAT = ["USD", "EUR", "CNY", "GBP", "JPY", "CHF", "KZT", "TRY", "AED", "BYN", "UZS", "AMD", "GEL", "KGS", "THB", "INR"]

# период → (range, interval) для Yahoo Finance
YAHOO_PERIODS = {
    "1d": ("1d", "5m"),
    "1w": ("5d", "30m"),
    "1m": ("1mo", "60m"),
    "1y": ("1y", "1d"),
    "5y": ("5y", "1wk"),
}
PERIOD_DAYS = {"1d": 2, "1w": 8, "1m": 31, "1y": 366, "5y": 1827}
CACHE_TTL = {"1d": 60, "1w": 300, "1m": 900, "1y": 3600, "5y": 3600}
QUOTE_TTL = 60

_quote_cache = {}
_history_cache = {}
_cbr_ids = {"time": 0, "ids": {}}

FETCH_ERRORS = (urllib.error.URLError, urllib.error.HTTPError, ValueError, KeyError, TimeoutError)


def _get(url, encoding="utf-8", attempts=2):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                return resp.read().decode(encoding, "replace")
        except (urllib.error.URLError, TimeoutError):
            if attempt == attempts - 1:
                raise
            time.sleep(0.5)


def _quote(symbol):
    cached = _quote_cache.get(symbol)
    if cached and time.time() - cached[0] < QUOTE_TTL:
        return cached[1]
    try:
        quote = fetch_commodity_quote({"symbol": symbol, "name": symbol})
    except FETCH_ERRORS:
        return None
    _quote_cache[symbol] = (time.time(), quote)
    return quote


def fetch_quotes(symbols):
    symbols = [s for s in dict.fromkeys(symbols) if s][:60]
    with ThreadPoolExecutor(max_workers=10) as pool:
        quotes = list(pool.map(_quote, symbols))
    return {q["symbol"]: q for q in quotes if q}


def _yahoo_points(symbol, period):
    rng, interval = YAHOO_PERIODS[period]
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?" + urllib.parse.urlencode(
        {"range": rng, "interval": interval}
    )
    result = json.loads(_get(url))["chart"]["result"][0]
    closes = result["indicators"]["quote"][0].get("close") or []
    points = [
        [int(t) * 1000, round(c, 6)]
        for t, c in zip(result.get("timestamp") or [], closes)
        if c is not None
    ]
    return points, result["meta"].get("currency", "USD")


def _brent_history(period):
    """
    Непрерывный ряд ближайшего контракта, как в СМИ: до смены контракта — BZ=F,
    после — текущий ближайший контракт (BZ=F переключается раньше, и в конце
    месяца его цена расходится с котировкой).
    """
    since = datetime.datetime.combine(brent_front_since(), datetime.time(), tzinfo=datetime.timezone.utc)
    since_ms = int(since.timestamp() * 1000)
    front, currency = _yahoo_points(brent_front_contract()[0], period)
    points = [p for p in front if p[0] >= since_ms]
    if (time.time() - PERIOD_DAYS[period] * 86400) * 1000 < since_ms:
        older, _ = _yahoo_points("BZ=F", period)
        points = [p for p in older if p[0] < since_ms] + points
    return {"points": points, "currency": currency}


def _yahoo_history(symbol, period):
    if symbol == "BZ=F":
        return _brent_history(period)
    points, currency = _yahoo_points(symbol, period)
    return {"points": points, "currency": currency}


def _cbr_currency_ids():
    if time.time() - _cbr_ids["time"] > 86400 or not _cbr_ids["ids"]:
        xml = _get("https://www.cbr.ru/scripts/XML_daily.asp", "cp1251")
        _cbr_ids["ids"] = dict(
            (code, vid) for vid, code in re.findall(r'<Valute ID="([^"]+)">.*?<CharCode>(\w+)</CharCode>', xml, re.S)
        )
        _cbr_ids["time"] = time.time()
    return _cbr_ids["ids"]


def _cbr_history(code, days):
    """Официальный курс Банка России (устанавливается раз в рабочий день)."""
    val_id = _cbr_currency_ids().get(code)
    if not val_id:
        raise ValueError("currency not quoted by CBR")
    today = datetime.date.today()
    start = today - datetime.timedelta(days=days)
    url = "https://www.cbr.ru/scripts/XML_dynamic.asp?" + urllib.parse.urlencode({
        "date_req1": start.strftime("%d/%m/%Y"),
        "date_req2": (today + datetime.timedelta(days=1)).strftime("%d/%m/%Y"),
        "VAL_NM_RQ": val_id,
    })
    xml = _get(url, "cp1251")
    points = []
    for date, nominal, value in re.findall(
        r'<Record Date="([\d.]+)"[^>]*><Nominal>(\d+)</Nominal><Value>([\d,]+)</Value>', xml
    ):
        day = datetime.datetime.strptime(date, "%d.%m.%Y").replace(tzinfo=datetime.timezone(datetime.timedelta(hours=3)))
        points.append([int(day.timestamp() * 1000), round(float(value.replace(",", ".")) / int(nominal), 6)])
    return {"points": points, "currency": "RUB", "source": "cbr"}


def _fiat_history(code, period):
    if period in ("1d", "1w"):
        try:
            data = _yahoo_history(f"{code}RUB=X", period)
            if len(data["points"]) >= 5:
                data["source"] = "yahoo"
                return data
        except FETCH_ERRORS:
            pass
    return _cbr_history(code, max(PERIOD_DAYS[period], 10))


def fetch_history(kind, symbol, period):
    if period not in YAHOO_PERIODS:
        raise ValueError("bad period")
    key = (kind, symbol, period)
    cached = _history_cache.get(key)
    if cached and time.time() - cached[0] < CACHE_TTL[period]:
        return cached[1]

    if kind == "fiat":
        if not re.fullmatch(r"[A-Z]{3}", symbol):
            raise ValueError("bad currency")
        data = _fiat_history(symbol, period)
    elif kind == "yahoo":
        if not re.fullmatch(r"[\w.^=\-]{1,20}", symbol):
            raise ValueError("bad symbol")
        data = _yahoo_history(symbol, period)
    else:
        raise ValueError("bad kind")

    _history_cache[key] = (time.time(), data)
    return data
