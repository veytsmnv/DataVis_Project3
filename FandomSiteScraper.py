import csv
import os
import re
from urllib.parse import unquote, urlparse

import requests
from bs4 import BeautifulSoup


LINKS_CSV = "CommunityShowScriptLinks.csv"
OUTPUT_DIR = "scripts_csv"
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
}


def clean_value(value: str) -> str:
    return (value or "").strip()


def get_url_from_row(row: dict) -> str:
    for value in row.values():
        candidate = clean_value(value)
        if candidate.startswith("http://") or candidate.startswith("https://"):
            return candidate
    return ""


def get_row_value(row: dict, key_name: str) -> str:
    target = key_name.strip().lower()
    for key, value in row.items():
        normalized = str(key).replace("\ufeff", "").strip().lower()
        if normalized == target:
            return clean_value(value)
    return ""


def build_output_name(url: str, season: str, episode: str) -> str:
    season = clean_value(season)
    episode = clean_value(episode)
    
    # Extract title from URL
    title = ""
    if "wiki/" in url:
        parts = url.split("wiki/")
        if len(parts) > 1:
            title_encoded = parts[1].split("/")[0]
            title = unquote(title_encoded).replace("_", " ")
    
    if not title:
        title = "episode"
    
    # Sanitize title for filename
    safe_title = re.sub(r"[^A-Za-z0-9._-]+", "_", title).strip("._-") or "episode"
    
    if season and episode:
        return f"{season}x{episode}_{safe_title}.csv"
    
    return f"{safe_title}.csv"


def parse_dialogue_pairs(html: str) -> list:
    soup = BeautifulSoup(html, "html.parser")
    container = soup.select_one("div.mw-parser-output") or soup

    dialogue_rows = []

    for tag in container.find_all(["p", "li", "dd"]):
        block_text = tag.get_text("\n", strip=True)
        if not block_text:
            continue

        # Rejoin cases like "Jeff\n: hello" into "Jeff: hello".
        block_text = re.sub(r"\s*\n\s*:\s*", ": ", block_text)
        pending_speaker = None

        for raw_line in block_text.splitlines():
            line = re.sub(r"\s+", " ", raw_line).strip()
            if not line:
                continue

            if ":" not in line:
                if pending_speaker:
                    dialogue_rows.append((pending_speaker, line))
                    pending_speaker = None
                continue

            character, spoken_line = line.split(":", 1)
            character = character.strip()
            spoken_line = spoken_line.strip()
            if character and spoken_line:
                dialogue_rows.append((character, spoken_line))
                pending_speaker = None
            elif character:
                pending_speaker = character

    return dialogue_rows


def fetch_transcript_html(url: str) -> str:
    parsed = urlparse(url)
    path_parts = [part for part in parsed.path.split("/") if part]
    if len(path_parts) < 2 or path_parts[0].lower() != "wiki":
        raise ValueError(f"Unexpected transcript URL format: {url}")

    page_title = unquote("/".join(path_parts[1:]))
    api_url = f"{parsed.scheme}://{parsed.netloc}/api.php"

    params = {
        "action": "parse",
        "page": page_title,
        "format": "json",
    }

    response = requests.get(api_url, params=params, headers=REQUEST_HEADERS, timeout=30)
    response.raise_for_status()

    data = response.json()
    if "error" in data:
        raise RuntimeError(f"API error for {url}: {data['error'].get('info', 'unknown error')}")

    return data["parse"]["text"]["*"]


def save_dialogue_csv(output_path: str, rows: list) -> None:
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["character", "line"])
        writer.writerows(rows)


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    with open(LINKS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            season = get_row_value(row, "season")
            episode = get_row_value(row, "episode")
            url = get_url_from_row(row)

            if not url:
                continue

            try:
                html = fetch_transcript_html(url)
                dialogue_rows = parse_dialogue_pairs(html)
                output_name = build_output_name(url, season, episode)
                output_path = os.path.join(OUTPUT_DIR, output_name)
                save_dialogue_csv(output_path, dialogue_rows)
                print(f"Saved {len(dialogue_rows)} lines to {output_path}")
            except Exception as exc:
                print(f"Failed for {url}: {exc}")


if __name__ == "__main__":
    main()