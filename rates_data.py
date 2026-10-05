"""
Официальные данные Банка России (cbr.ru): ключевая ставка, инфляция и
максимальная ставка по вкладам десяти крупнейших банков.
У cbr.ru нет CORS, поэтому данные берёт сервер. Доходности ОФЗ сайт
получает напрямую из браузера через API Мосбиржи (iss.moex.com).
"""

import datetime
import html
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
ROMAN_DECADE_DAY = {"I": 5, "II": 15, "III": 25}


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", "replace")


def _table_rows(page):
    rows = []
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = [
            html.unescape(re.sub(r"<[^>]+>|\s+", " ", cell)).strip()
            for cell in re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.S)
        ]
        if cells:
            rows.append(cells)
    return rows


def _num(text):
    return float(text.replace(" ", "").replace(",", "."))


def _cbr_query(path, years_back):
    today = datetime.date.today()
    start = today.replace(year=today.year - years_back)
    return (
        f"https://www.cbr.ru/{path}?UniDbQuery.Posted=True"
        f"&UniDbQuery.From={start:%d.%m.%Y}&UniDbQuery.To={today:%d.%m.%Y}"
    )


def fetch_key_rate():
    rows = _table_rows(_get(_cbr_query("hd_base/KeyRate/", 3)))
    points = []
    for date_str, rate_str in (r[:2] for r in rows if len(r) >= 2):
        d = datetime.datetime.strptime(date_str, "%d.%m.%Y").date()
        points.append((d, _num(rate_str)))
    points.sort()
    if not points:
        raise ValueError("no key rate data")

    changes = [points[0]]
    for d, rate in points[1:]:
        if rate != changes[-1][1]:
            changes.append((d, rate))

    return {
        "current": points[-1][1],
        "asOf": points[-1][0].isoformat(),
        "since": changes[-1][0].isoformat(),
        "previous": changes[-2][1] if len(changes) > 1 else None,
        "history": [{"date": d.isoformat(), "value": r} for d, r in changes]
        + [{"date": points[-1][0].isoformat(), "value": points[-1][1]}],
    }


def fetch_inflation():
    rows = _table_rows(_get(_cbr_query("hd_base/infl/", 2)))
    history = []
    target = None
    for row in rows:
        if len(row) < 4 or not re.fullmatch(r"\d{2}\.\d{4}", row[0]):
            continue
        month, year = row[0].split(".")
        history.append({"date": f"{year}-{month}-15", "value": _num(row[2])})
        target = target or _num(row[3])
    history.sort(key=lambda p: p["date"])
    if not history:
        raise ValueError("no inflation data")

    return {
        "current": history[-1]["value"],
        "month": history[-1]["date"][:7],
        "target": target,
        "history": history,
    }


def fetch_deposit_rates():
    rows = _table_rows(_get("https://www.cbr.ru/statistics/avgprocstav/"))
    history = []
    for row in rows:
        match = re.fullmatch(r"(I{1,3})\.(\d{2})\.(\d{4})", row[0]) if len(row) >= 2 else None
        if not match:
            continue
        decade, month, year = match.groups()
        history.append({
            "date": f"{year}-{month}-{ROMAN_DECADE_DAY[decade]:02d}",
            "decade": row[0],
            "value": _num(row[1]),
        })
    history.sort(key=lambda p: p["date"])
    if not history:
        raise ValueError("no deposit data")

    return {
        "current": history[-1]["value"],
        "decade": history[-1]["decade"],
        "history": [{"date": p["date"], "value": p["value"]} for p in history],
    }


def _run(job):
    key, fetcher = job
    try:
        return key, fetcher(), None
    except Exception as exc:  # noqa: BLE001
        return key, None, {"source": key, "error": str(exc)}


def collect_all_rates():
    jobs = [
        ("keyRate", fetch_key_rate),
        ("inflation", fetch_inflation),
        ("deposits", fetch_deposit_rates),
    ]
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(_run, jobs))

    result = {"errors": [err for _, _, err in results if err]}
    for key, value, _ in results:
        result[key] = value
    return result
