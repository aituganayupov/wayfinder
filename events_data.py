"""
Календарь финансовых событий:
- заседания Совета директоров Банка России по ключевой ставке (cbr.ru);
- даты отчётностей крупнейших компаний США (календарь Nasdaq);
- дивидендные отсечки крупнейших компаний США (календарь Nasdaq).
Публикации инфляции Росстатом сайт рассчитывает сам по их регулярному графику.
"""

import datetime
import html
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
NASDAQ_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
}
DAYS_AHEAD = 45
MIN_EARNINGS_CAP = 100e9
MIN_DIVIDEND_CAP = 50e9

# Крупные компании США, за дивидендами которых чаще всего следят
DIVIDEND_TICKERS = {
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "META", "AVGO", "JPM", "V", "MA",
    "KO", "PEP", "JNJ", "PG", "XOM", "CVX", "WMT", "HD", "ORCL", "INTC", "AMD",
    "DIS", "MCD", "BAC", "WFC", "MRK", "ABBV", "PFE", "CSCO", "IBM", "T", "VZ",
    "COST", "NKE", "UNH", "LLY", "QCOM", "TXN", "GS", "MS",
}

RU_MONTHS = {
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4, "мая": 5, "июня": 6,
    "июля": 7, "августа": 8, "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
}


def _get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", "replace")


def _clean(text):
    return html.unescape(re.sub(r"<[^>]+>|\s+", " ", text)).replace("\xa0", " ").strip()


def fetch_cbr_meetings():
    page = _get("https://www.cbr.ru/dkp/cal_mp/")
    today = datetime.date.today()
    events = []
    seen = set()

    for block in page.split('class="main-events_day"')[1:]:
        date_match = re.search(r'class="date[^"]*">(.*?)</div>', block, re.S)
        if not date_match:
            continue
        parts = _clean(date_match.group(1)).split()
        if len(parts) < 3 or parts[1] not in RU_MONTHS:
            continue
        date = datetime.date(int(parts[2]), RU_MONTHS[parts[1]], int(parts[0]))
        if not (today - datetime.timedelta(days=30) <= date <= today + datetime.timedelta(days=400)):
            continue

        for title_html in re.findall(r'class="title">\s*<span[^>]*>(.*?)</span>', block, re.S):
            title = _clean(title_html)
            key = (date, title)
            if key in seen:
                continue
            seen.add(key)
            is_meeting = title.startswith("Заседание")
            events.append({
                "date": date.isoformat(),
                "type": "cbr",
                "title": "Решение ЦБ по ключевой ставке" if is_meeting else title,
                "time": "13:30 МСК" if is_meeting else "",
                "details": "Пресс-релиз в 13:30, пресс-конференция в 15:00 МСК" if is_meeting else "",
                "important": is_meeting,
            })
    return events


def _weekdays_ahead(days):
    today = datetime.date.today()
    for offset in range(days):
        d = today + datetime.timedelta(days=offset)
        if d.weekday() < 5:
            yield d


def _nasdaq(path, date):
    data = json.loads(_get(f"https://api.nasdaq.com/api/calendar/{path}?date={date.isoformat()}", NASDAQ_HEADERS))
    return date, data.get("data") or {}


def _company(name, symbol):
    name = re.sub(r"\b(Class [A-C] )?(Common Stock|Ordinary Shares|American Depositary Shares)\b.*$", "", name or "")
    name = re.sub(r"\s*\((DE|The)\)", "", name.strip())
    name = re.sub(r",?\s+(Inc|Corporation|Corp|plc|Ltd|N\.V|S\.A)\.?$", "", name)
    name = re.sub(r",\s+Co\.?$", "", name).strip(" ,.")
    return f"{name} ({symbol})" if name else symbol


def _us_date(text):
    try:
        return datetime.datetime.strptime(text, "%m/%d/%Y").strftime("%d.%m.%Y")
    except (TypeError, ValueError):
        return "—"


def _money(text):
    try:
        return float(re.sub(r"[^\d.]", "", text or ""))
    except ValueError:
        return 0.0


def fetch_us_earnings():
    """Возвращает события отчётностей и набор тикеров крупных компаний (для фильтра дивидендов)."""
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda d: _nasdaq("earnings", d), _weekdays_ahead(DAYS_AHEAD)))

    events = []
    large_caps = set()
    for date, data in results:
        for row in data.get("rows") or []:
            cap = _money(row.get("marketCap"))
            if cap >= MIN_DIVIDEND_CAP:
                large_caps.add(row.get("symbol"))
            if cap < MIN_EARNINGS_CAP:
                continue
            when = {"time-pre-market": "до открытия биржи", "time-after-hours": "после закрытия биржи"}.get(row.get("time"), "")
            forecast = row.get("epsForecast")
            events.append({
                "date": date.isoformat(),
                "type": "earnings",
                "title": f"{_company(row.get('name'), row.get('symbol'))} — отчётность",
                "symbol": row.get("symbol"),
                "time": when,
                "details": f"Квартал {row.get('fiscalQuarterEnding', '')}" + (f" · прогноз EPS {forecast}" if forecast else ""),
                "important": cap >= 1e12,
            })
    return events, large_caps


def fetch_us_dividends(large_caps):
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda d: _nasdaq("dividends", d), _weekdays_ahead(DAYS_AHEAD)))

    tickers = DIVIDEND_TICKERS | large_caps
    events = []
    for date, data in results:
        for row in (data.get("calendar") or {}).get("rows") or []:
            if row.get("symbol") not in tickers:
                continue
            events.append({
                "date": date.isoformat(),
                "type": "dividend",
                "title": f"{_company(row.get('companyName'), row.get('symbol'))} — дивидендная отсечка",
                "symbol": row.get("symbol"),
                "time": "",
                "details": f"${row.get('dividend_Rate')} на акцию · выплата {_us_date(row.get('payment_Date'))}",
                "important": False,
            })
    return events


def collect_all_events():
    result = {"events": [], "errors": []}

    def run(source, fetcher, *args):
        try:
            return fetcher(*args)
        except Exception as exc:  # noqa: BLE001
            result["errors"].append({"source": source, "error": str(exc)})
            return None

    result["events"].extend(run("cbr", fetch_cbr_meetings) or [])
    earnings = run("earnings", fetch_us_earnings)
    large_caps = set()
    if earnings:
        result["events"].extend(earnings[0])
        large_caps = earnings[1]
    result["events"].extend(run("dividends", fetch_us_dividends, large_caps) or [])

    result["events"].sort(key=lambda e: e["date"])
    return result


_cache = {"time": 0, "data": None}


def get_events_cached(max_age=3600):
    """Nasdaq отдаёт календарь по одному дню за запрос — кэшируем на час, чтобы не делать ~60 запросов каждый раз."""
    if _cache["data"] is None or time.time() - _cache["time"] > max_age:
        _cache["data"] = collect_all_events()
        _cache["time"] = time.time()
    return _cache["data"]
