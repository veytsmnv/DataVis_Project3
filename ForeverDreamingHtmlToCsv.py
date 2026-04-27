import argparse
import csv
import os
import re
from typing import List, Optional, Tuple

from bs4 import BeautifulSoup


DEFAULT_INPUT_DIR = "script_htmls_forever_dreaming"
DEFAULT_OUTPUT_DIR = "scripts_csv"

SPEAKER_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])([A-Z][A-Za-z0-9'&()./#\-]*(?:\s+[A-Z][A-Za-z0-9'&()./#\-]*){0,3})\s*:"
)
EPISODE_PATTERN = re.compile(r"(\d{1,2})x(\d{1,2})")
BRACKETED_PATTERN = re.compile(r"\[[^\]]+\]")
WHITESPACE_PATTERN = re.compile(r"\s+")
UNSAFE_FILENAME_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


def normalize_speaker(raw: str) -> str:
    speaker = WHITESPACE_PATTERN.sub(" ", raw.strip().replace("_", " "))
    if speaker.isupper():
        return speaker.title()
    return speaker


def clean_spoken_text(text: str) -> str:
    cleaned = BRACKETED_PATTERN.sub("", text)
    cleaned = cleaned.replace("\u2019", "'").replace("\u2018", "'")
    cleaned = cleaned.replace("\u201c", '"').replace("\u201d", '"')
    cleaned = cleaned.replace("\xa0", " ")
    cleaned = cleaned.replace("\u266a", " ")
    cleaned = cleaned.strip(" \t-:")
    cleaned = WHITESPACE_PATTERN.sub(" ", cleaned).strip()
    cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
    return cleaned


def get_episode_code(filename: str) -> Optional[str]:
    match = EPISODE_PATTERN.search(filename)
    if not match:
        return None
    season = int(match.group(1))
    episode = int(match.group(2))
    return f"{season}x{episode}"


def get_episode_title(filename: str) -> str:
    stem, _ = os.path.splitext(filename)
    parts = [part.strip() for part in stem.split(" - ")]

    if len(parts) >= 2:
        raw_title = parts[1]
    elif len(parts) == 1:
        raw_title = parts[0]
    else:
        raw_title = "episode"

    safe = UNSAFE_FILENAME_PATTERN.sub("_", raw_title)
    safe = safe.strip("._-")
    return safe or "episode"


def extract_transcript_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    blocks = soup.select("div.postbody div.content")
    if not blocks:
        return ""
    return "\n".join(block.get_text("\n", strip=False) for block in blocks)


def parse_dialogue_rows(transcript_text: str) -> List[Tuple[str, str]]:
    rows: List[Tuple[str, str]] = []

    current_speaker: Optional[str] = None
    current_parts: List[str] = []

    def flush_current() -> None:
        nonlocal current_speaker, current_parts
        if not current_speaker:
            return
        merged_line = clean_spoken_text(" ".join(current_parts))
        if merged_line:
            rows.append((current_speaker, merged_line))
        current_speaker = None
        current_parts = []

    normalized = transcript_text.replace("\r", "\n")

    for raw_line in normalized.splitlines():
        line = WHITESPACE_PATTERN.sub(" ", raw_line).strip()
        if not line:
            continue

        matches = list(SPEAKER_PATTERN.finditer(line))
        if not matches:
            if current_speaker:
                spoken = clean_spoken_text(line)
                if spoken:
                    current_parts.append(spoken)
            continue

        if matches[0].start() > 0 and current_speaker:
            preface = clean_spoken_text(line[: matches[0].start()])
            if preface:
                current_parts.append(preface)

        for index, match in enumerate(matches):
            speaker = normalize_speaker(match.group(1))
            start = match.end()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(line)
            spoken = clean_spoken_text(line[start:end])

            flush_current()
            current_speaker = speaker
            current_parts = []
            if spoken:
                current_parts.append(spoken)

    flush_current()

    return rows


def save_csv(path: str, rows: List[Tuple[str, str]]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["character", "line"])
        writer.writerows(rows)


def convert_html_file(html_path: str, output_dir: str, overwrite: bool) -> Tuple[str, int, str]:
    file_name = os.path.basename(html_path)
    episode_code = get_episode_code(file_name)
    episode_title = get_episode_title(file_name)
    if not episode_code:
        return file_name, 0, "skipped (no season/episode code in file name)"

    output_path = os.path.join(output_dir, f"{episode_code}_{episode_title}.csv")
    if os.path.exists(output_path) and not overwrite:
        return file_name, 0, "skipped (output exists, use --overwrite)"

    with open(html_path, "r", encoding="utf-8", errors="ignore") as f:
        html = f.read()

    transcript_text = extract_transcript_text(html)
    if not transcript_text.strip():
        return file_name, 0, "skipped (no transcript content found)"

    rows = parse_dialogue_rows(transcript_text)
    save_csv(output_path, rows)
    return file_name, len(rows), output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert Forever Dreaming transcript HTML files to character/line CSV files."
    )
    parser.add_argument("--input-dir", default=DEFAULT_INPUT_DIR, help="Folder containing .htm/.html files")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR, help="Folder to write CSV files")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing CSV files in the output directory",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    os.makedirs(args.output_dir, exist_ok=True)

    html_files = sorted(
        [
            os.path.join(args.input_dir, name)
            for name in os.listdir(args.input_dir)
            if name.lower().endswith((".htm", ".html"))
        ]
    )

    if not html_files:
        print(f"No HTML files found in {args.input_dir}")
        return

    converted = 0
    skipped = 0
    for html_file in html_files:
        source, count, status = convert_html_file(html_file, args.output_dir, args.overwrite)
        if status.endswith(".csv"):
            converted += 1
            print(f"{source} -> {status} ({count} rows)")
        else:
            skipped += 1
            print(f"{source} -> {status}")

    print(f"Done. Converted: {converted}, Skipped: {skipped}")


if __name__ == "__main__":
    main()