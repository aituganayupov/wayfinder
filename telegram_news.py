"""
Общая логика получения постов из публичных Telegram-каналов.
Используется и сервером (server.py), и офлайн-обновлятором (update_news.py).
"""

import html
import re
import urllib.error
import urllib.request

TELEGRAM_CHANNELS = [
    "hse_official",
    "extrahse",
    "spbhse",
    "hsebusinessclub",
    "hsevoluuntercenter",
    "hse_live",
    "HSEafisha",
]

POSTS_PER_CHANNEL = 8
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def fetch_channel_posts(channel):
    url = f"https://t.me/s/{channel}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode("utf-8", errors="replace")

    posts = []
    chunks = body.split("tgme_widget_message_wrap")[1:]

    for chunk in chunks:
        post_match = re.search(r'data-post="([^"]+)"', chunk)
        if not post_match:
            continue
        post_id = post_match.group(1)

        text_match = re.search(
            r'class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', chunk, re.S
        )
        text_html = text_match.group(1) if text_match else ""
        text = re.sub(r"<br\s*/?>", "\n", text_html)
        text = re.sub(r"<[^>]+>", "", text)
        text = html.unescape(text).strip()

        date_match = re.search(r'<time[^>]*datetime="([^"]+)"', chunk)
        date_str = date_match.group(1) if date_match else ""

        if not text and not date_str:
            continue

        posts.append({
            "channel": channel,
            "text": text,
            "date": date_str,
            "link": f"https://t.me/{post_id}",
        })

    # На странице посты идут от старых к новым — берём последние N
    return posts[-POSTS_PER_CHANNEL:]


def collect_all_news(channels=None):
    all_posts = []
    errors = []

    channel_list = channels if channels else TELEGRAM_CHANNELS

    for channel in channel_list:
        try:
            all_posts.extend(fetch_channel_posts(channel))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            errors.append({"channel": channel, "error": str(exc)})

    all_posts.sort(key=lambda p: p["date"], reverse=True)
    return {"posts": all_posts, "errors": errors}
