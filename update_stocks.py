"""
Обновляет stocks-data.js — файл с котировками акций (Yahoo Finance),
который сайт читает как обычный <script>, без сервера и localhost.

Запускайте этот скрипт (или update_stocks.bat), когда хотите обновить
котировки на вкладке "Акции". После обновления обновите страницу сайта (F5).
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from stocks_data import collect_all_stocks

OUTPUT_FILE = Path(__file__).parent / "stocks-data.js"


def main():
    print("Загружаю котировки акций...")
    data = collect_all_stocks()
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()

    js_content = "window.STOCKS_DATA = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    OUTPUT_FILE.write_text(js_content, encoding="utf-8")

    print(f"Готово! Акций: {len(data['stocks'])}.")
    if data["errors"]:
        failed = ", ".join(e.get("symbol", "?") for e in data["errors"])
        print(f"Не удалось загрузить: {failed}")
    print(f"Файл обновлён: {OUTPUT_FILE}")
    print("Теперь обновите страницу сайта (F5), чтобы увидеть котировки.")


if __name__ == "__main__":
    main()
