import os
import json
from bs4 import BeautifulSoup
from pathlib import Path

def parse_episode_descriptions():
    """
    Parse HTML files from EpisodeDescriptions directory and create a JSON file
    with episode descriptions.
    """
    
    episode_descriptions = {}
    descriptions_dir = Path("EpisodeDescriptions")
    
    if not descriptions_dir.exists():
        print(f"Directory {descriptions_dir} does not exist.")
        return
    
    # Process each HTML file in the EpisodeDescriptions directory
    for html_file in sorted(descriptions_dir.glob("*.htm")):
        print(f"Processing {html_file.name}...")
        
        with open(html_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        if not content.strip():
            print(f"  Warning: {html_file.name} is empty")
            continue
        
        # Parse HTML content
        soup = BeautifulSoup(content, 'html.parser')
        
        # Extract episode information
        # Adjust selectors based on actual HTML structure
        season_name = html_file.stem  # e.g., "Season1"
        episode_descriptions[season_name] = []
        
        # Try to find episode containers (adjust selectors as needed)
        # Common patterns: <div class="episode">, <article>, <tr> for tables
        episodes = soup.find_all(['div', 'article', 'tr'])
        
        for episode in episodes:
            # Extract title
            title_elem = episode.find(['h2', 'h3', 'h4', 'td'])
            if not title_elem:
                continue
            
            title = title_elem.get_text(strip=True)
            
            # Extract description
            description_elem = episode.find(['p', 'span', 'td'])
            description = description_elem.get_text(strip=True) if description_elem else ""
            
            if title:
                episode_descriptions[season_name].append({
                    "title": title,
                    "description": description
                })
        
        if not episode_descriptions[season_name]:
            print(f"  No episodes found in {html_file.name}")
        else:
            print(f"  Found {len(episode_descriptions[season_name])} episodes")
    
    # Write to JSON file
    output_file = Path("all_scripts/episode_descriptions.json")
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(episode_descriptions, f, indent=2, ensure_ascii=False)
    
    print(f"\nEpisode descriptions saved to {output_file}")
    print(f"Total seasons processed: {len(episode_descriptions)}")


if __name__ == "__main__":
    parse_episode_descriptions()
