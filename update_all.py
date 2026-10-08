"""
Обновляет все данные сайта за один запуск.

Каждый набор данных сохраняется дважды:
  * data/<имя>.json — его подгружает сайт в интернете (GitHub Pages) и открытые вкладки;
  * <имя>-data.js   — для открытия сайта двойным кликом, без сервера.

Используется Планировщиком заданий Windows (задача "FincompassAutoUpdate") и
облачным автообновлением GitHub Actions (.github/workflows/deploy.yml) — там
скрипт запускается с флагом --ci каждые 5 минут и дополнительно готовит котировки
и историю цен для «Избранного», «Портфеля» и «Графиков».

Медленно меняющиеся данные (ставки ЦБ, календарь) обновляются реже — см. MAX_AGE.
"""

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from stocks_data import collect_all_stocks
from commodities_data import collect_all_commodities
from indices_data import collect_all_indices
from rates_data import collect_all_rates
from events_data import collect_all_events
from news_data import collect_news
from charts_data import FETCH_ERRORS, STATIC_FIAT, STATIC_YAHOO, fetch_history, fetch_quotes

ROOT_DIR = Path(__file__).parent
DATA_DIR = ROOT_DIR / "data"
HISTORY_DIR = DATA_DIR / "history"
LOG_FILE = ROOT_DIR / "update_all_log.txt"

# имя набора → (файл для двойного клика, глобальная переменная в нём)
DATASETS = {
    "stocks": ("stocks-data.js", "STOCKS_DATA"),
    "commodities": ("commodities-data.js", "COMMODITIES_DATA"),
    "indices": ("indices-data.js", "INDICES_DATA"),
    "rates": ("rates-data.js", "RATES_DATA"),
    "events": ("events-data.js", "EVENTS_DATA"),
    "news": ("news-data.js", "NEWS_DATA"),
}

# Как часто обновлять (секунды); остальное — при каждом запуске
MAX_AGE = {
    "rates": 60 * 60,
    "events": 6 * 3600,  # Nasdaq отдаёт календарь по дню за запрос (~60 запросов)
}
HISTORY_MAX_AGE = {"1d": 4 * 60, "1w": 15 * 60, "1m": 30 * 60, "1y": 6 * 3600, "5y": 24 * 3600}


def log(message):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {message}"
    print(line, flush=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def _read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _age(data):
    try:
        return time.time() - datetime.fromisoformat(data["updatedAt"]).timestamp()
    except (TypeError, KeyError, ValueError):
        return float("inf")


def is_fresh(name):
    max_age = MAX_AGE.get(name)
    return bool(max_age) and _age(_read_json(DATA_DIR / f"{name}.json")) < max_age


def save_dataset(name, data):
    data["updatedAt"] = _now_iso()
    _write_json(DATA_DIR / f"{name}.json", data)


def write_js_files():
    """Файлы для двойного клика пересобираются из data/*.json — так они всегда совпадают."""
    for name, (filename, global_name) in DATASETS.items():
        data = _read_json(DATA_DIR / f"{name}.json")
        if data is not None:
            js = f"window.{global_name} = " + json.dumps(data, ensure_ascii=False) + ";\n"
            (ROOT_DIR / filename).write_text(js, encoding="utf-8")


def _load_js_dataset(filename):
    """Старый формат (до появления data/) — чтобы не терять накопленные новости."""
    try:
        text = (ROOT_DIR / filename).read_text(encoding="utf-8")
        return json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))
    except (OSError, ValueError):
        return None


def update_stocks():
    data = collect_all_stocks()
    save_dataset("stocks", data)
    log(f"Акции: {len(data['stocks'])}, ошибок {len(data['errors'])}")


def update_commodities():
    data = collect_all_commodities()
    save_dataset("commodities", data)
    log(f"Сырьё: {len(data['items'])}, ошибок {len(data['errors'])}")


def update_indices():
    data = collect_all_indices()
    save_dataset("indices", data)
    log(f"Индексы: {len(data['items'])}, ошибок {len(data['errors'])}")


def update_rates():
    data = collect_all_rates()
    save_dataset("rates", data)
    log(f"Ставки ЦБ, ошибок {len(data['errors'])}")


def update_events():
    data = collect_all_events()
    save_dataset("events", data)
    log(f"Календарь событий: {len(data['events'])}, ошибок {len(data['errors'])}")


def update_news():
    previous = _read_json(DATA_DIR / "news.json") or _load_js_dataset("news-data.js") or {}
    data = collect_news(previous.get("items", []))
    save_dataset("news", data)
    log(f"Новости рынка: {len(data['items'])}, ошибок {len(data['errors'])}")


def update_quotes():
    """Котировки зарубежных активов и курсов валют для «Избранного» и «Портфеля»."""
    symbols = STATIC_YAHOO + [f"{code}RUB=X" for code in STATIC_FIAT]
    quotes = fetch_quotes(symbols)
    _write_json(DATA_DIR / "quotes.json", {"quotes": quotes, "updatedAt": _now_iso()})
    log(f"Котировки: {len(quotes)} из {len(symbols)}")


def history_file(kind, symbol, period):
    # Имя файла должно совпадать с historyFileName() в app.js
    return HISTORY_DIR / f"{kind}_{re.sub(r'[^A-Za-z0-9]', '_', symbol)}_{period}.json"


def _update_history_one(job):
    kind, symbol, period = job
    try:
        data = dict(fetch_history(kind, symbol, period))
    except FETCH_ERRORS:
        return False
    if not data.get("points"):
        return False
    data["updatedAt"] = _now_iso()
    _write_json(history_file(kind, symbol, period), data)
    return True


def update_history():
    """История цен для «Графиков» и мини-графиков — каждый период со своей частотой."""
    jobs = [
        (kind, symbol, period)
        for kind, symbols in (("yahoo", STATIC_YAHOO), ("fiat", STATIC_FIAT))
        for symbol in symbols
        for period, max_age in HISTORY_MAX_AGE.items()
        if _age(_read_json(history_file(kind, symbol, period))) >= max_age
    ]
    with ThreadPoolExecutor(max_workers=8) as pool:
        done = sum(pool.map(_update_history_one, jobs))
    log(f"История цен: обновлено {done} из {len(jobs)} устаревших файлов")


def main():
    ci = "--ci" in sys.argv
    log(f"--- Запуск автообновления{' (облако)' if ci else ''} ---")

    jobs = [
        ("stocks", update_stocks),
        ("commodities", update_commodities),
        ("indices", update_indices),
        ("rates", update_rates),
        ("events", update_events),
        ("news", update_news),
    ]
    if ci:
        jobs += [("quotes", update_quotes), ("history", update_history)]

    def run(job):
        name, fn = job
        if is_fresh(name):
            log(f"{name}: данные свежие, пропускаем")
            return
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            log(f"Ошибка обновления {name}: {exc}")

    # Источники разные, поэтому обновляем их параллельно
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        list(pool.map(run, jobs))

    write_js_files()
    log("--- Готово ---")


if __name__ == "__main__":
    sys.exit(main() or 0)
