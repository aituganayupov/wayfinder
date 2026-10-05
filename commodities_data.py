"""
Биржевые котировки сырья (фьючерсы COMEX, NYMEX, ICE, CBOT) через Yahoo Finance.
Бесплатные данные бирж идут с задержкой ~10 минут; спотовые цены драгметаллов
в реальном времени сайт получает отдельно, прямо из браузера (gold-api.com).
"""

import datetime
import urllib.error
from concurrent.futures import ThreadPoolExecutor

from stocks_data import fetch_stock_quote

COMMODITY_LIST = [
    {"symbol": "GC=F", "name": "Золото"},
    {"symbol": "SI=F", "name": "Серебро"},
    {"symbol": "PL=F", "name": "Платина"},
    {"symbol": "PA=F", "name": "Палладий"},
    {"symbol": "HG=F", "name": "Медь"},
    {"symbol": "ALI=F", "name": "Алюминий"},
    {"symbol": "BZ=F", "name": "Нефть Brent"},
    {"symbol": "CL=F", "name": "Нефть WTI"},
    {"symbol": "NG=F", "name": "Газ Henry Hub"},
    {"symbol": "TTF=F", "name": "Газ TTF (Европа)"},
    {"symbol": "HO=F", "name": "Дизельное топливо"},
    {"symbol": "RB=F", "name": "Бензин"},
    {"symbol": "ZW=F", "name": "Пшеница"},
    {"symbol": "ZC=F", "name": "Кукуруза"},
    {"symbol": "ZS=F", "name": "Соя"},
    {"symbol": "KC=F", "name": "Кофе"},
    {"symbol": "SB=F", "name": "Сахар"},
    {"symbol": "CC=F", "name": "Какао"},
]


MONTH_CODES = "FGHJKMNQUVXZ"
RU_MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь",
             "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]


def _last_business_day(day):
    last = day.replace(day=28) + datetime.timedelta(days=4)
    last -= datetime.timedelta(days=last.day)
    while last.weekday() >= 5:
        last -= datetime.timedelta(days=1)
    return last


def _front_month(today):
    index = today.month - 1 + (2 if today <= _last_business_day(today) else 3)
    return index % 12 + 1, today.year + index // 12


def brent_front_contract(today=None):
    """
    Ближайший фьючерс ICE Brent. Контракт месяца M истекает в последний рабочий день
    месяца M-2, и именно его цену приводят СМИ. Непрерывный символ Yahoo (BZ=F)
    переключается на следующий контракт раньше, и в конце месяца цены расходятся.
    """
    month, year = _front_month(today or datetime.date.today())
    return f"BZ{MONTH_CODES[month - 1]}{year % 100:02d}.NYM", f"{RU_MONTHS[month - 1]} {year}"


def brent_front_since(today=None):
    """С какого дня текущий ближайший контракт стал ближайшим (предыдущий истёк накануне)."""
    month, year = _front_month(today or datetime.date.today())
    expiry_month_start = datetime.date(year - (1 if month <= 2 else 0), (month - 3) % 12 + 1, 1)
    previous_expiry = _last_business_day(expiry_month_start - datetime.timedelta(days=1))
    return previous_expiry + datetime.timedelta(days=1)


def fetch_commodity_quote(commodity):
    if commodity["symbol"] != "BZ=F":
        return fetch_stock_quote(commodity)
    symbol, contract = brent_front_contract()
    quote = fetch_stock_quote({"symbol": symbol, "name": commodity["name"]})
    quote["symbol"] = "BZ=F"
    quote["contract"] = contract
    return quote


def _fetch(commodity):
    try:
        return fetch_commodity_quote(commodity), None
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, TimeoutError) as exc:
        return None, {"symbol": commodity["symbol"], "error": str(exc)}


def collect_all_commodities():
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(_fetch, COMMODITY_LIST))

    items = [item for item, _ in results if item]
    errors = [err for _, err in results if err]
    return {"items": items, "errors": errors}
