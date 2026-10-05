"""
Обновляет study-news.js — файл с последними постами из Telegram-каналов,
который сайт читает как обычный <script>, без сервера и localhost.

Запускайте этот скрипт (или update_news.bat), когда хотите обновить
новости на вкладке "Учёба". После обновления просто обновите страницу
сайта (F5) в браузере.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

from telegram_news import collect_all_news

OUTPUT_FILE = Path(__file__).parent / "study-news.js"


def main():
    print("Загружаю новости из Telegram-каналов...")
    data = collect_all_news()
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()

    js_content = "window.STUDY_NEWS = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"
    OUTPUT_FILE.write_text(js_content, encoding="utf-8")

    print(f"Готово! Постов: {len(data['posts'])}.")
    if data["errors"]:
        failed = ", ".join(e.get("channel", "?") for e in data["errors"])
        print(f"Не удалось загрузить каналы: {failed}")
    print(f"Файл обновлён: {OUTPUT_FILE}")
    print("Теперь обновите страницу сайта (F5), чтобы увидеть новости.")


if __name__ == "__main__":
    main()
