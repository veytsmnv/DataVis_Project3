import json
import re
from pathlib import Path


TXT_PATH = Path("EpisodeDescriptions/episode_descriptions.txt")
EPISODE_INFO_PATH = Path("all_scripts/episode_info.json")
OUTPUT_PATH = Path("all_scripts/episode_descriptions.json")


def parse_episode_descriptions(txt_path: Path) -> dict[str, dict]:
    """Parse the text file and return {code: {title_from_text, description}}."""
    if not txt_path.exists():
        raise FileNotFoundError(f"Missing input file: {txt_path}")

    lines = txt_path.read_text(encoding="utf-8").splitlines()

    header_re = re.compile(r"^S(\d+)\.E(\d+)\s*∙\s*(.+)$")
    rating_re = re.compile(r"^\d+(?:\.\d+)?/10")

    parsed: dict[str, dict] = {}
    i = 0

    while i < len(lines):
        line = lines[i].strip()
        match = header_re.match(line)
        if not match:
            i += 1
            continue

        season = int(match.group(1))
        episode = int(match.group(2))
        title_from_text = match.group(3).strip()
        code = f"{season}x{episode}"

        i += 1

        # Skip blank lines and the date line(s)
        while i < len(lines) and not lines[i].strip():
            i += 1

        # IMDb pages usually include a date line right after header; skip one non-empty date line
        if i < len(lines) and not header_re.match(lines[i].strip()):
            i += 1

        # Capture description lines until rating or next episode header.
        desc_lines: list[str] = []
        while i < len(lines):
            cur = lines[i].strip()
            if not cur:
                i += 1
                continue
            if header_re.match(cur) or rating_re.match(cur):
                break
            if cur == "Top-rated":
                i += 1
                continue
            desc_lines.append(cur)
            i += 1

        description = " ".join(desc_lines).strip()
        parsed[code] = {
            "title_from_text": title_from_text,
            "description": description,
        }

        # Move past rating line and any cast/extra lines until next header
        while i < len(lines):
            cur = lines[i].strip()
            if header_re.match(cur):
                break
            i += 1

    return parsed


def merge_with_episode_info(
    parsed_descriptions: dict[str, dict], episode_info_path: Path
) -> dict:
    """Merge parsed descriptions with canonical episode info by code."""
    if not episode_info_path.exists():
        raise FileNotFoundError(f"Missing episode info file: {episode_info_path}")

    episode_info = json.loads(episode_info_path.read_text(encoding="utf-8"))
    episodes = episode_info.get("episodes", [])

    merged_episodes = []
    missing_description_codes = []

    for episode in episodes:
        code = episode.get("code")
        parsed = parsed_descriptions.get(code)

        merged = dict(episode)
        merged["description"] = parsed.get("description", "") if parsed else ""

        # Keep parsed title only if it differs (useful for punctuation/format checks)
        if parsed and parsed.get("title_from_text") and parsed["title_from_text"] != episode.get("title", ""):
            merged["title_from_text"] = parsed["title_from_text"]

        if not merged["description"]:
            missing_description_codes.append(code)

        merged_episodes.append(merged)

    return {
        "episodes": merged_episodes,
        "meta": {
            "episode_count": len(merged_episodes),
            "descriptions_found": len(merged_episodes) - len(missing_description_codes),
            "descriptions_missing": missing_description_codes,
        },
    }


def main() -> None:
    parsed = parse_episode_descriptions(TXT_PATH)
    merged = merge_with_episode_info(parsed, EPISODE_INFO_PATH)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Wrote {OUTPUT_PATH}")
    print(f"Parsed descriptions from text: {len(parsed)}")
    print(f"Episodes in output: {merged['meta']['episode_count']}")
    print(f"Descriptions found: {merged['meta']['descriptions_found']}")
    print(f"Descriptions missing: {len(merged['meta']['descriptions_missing'])}")


if __name__ == "__main__":
    main()
