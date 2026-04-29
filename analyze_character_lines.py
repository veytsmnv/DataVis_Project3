import os
import csv
import json
import argparse
from collections import defaultdict
import re

# Configuration (default to all_scripts for this workspace)
SCRIPTS_DIR = "all_scripts"
OUTPUT_CSV = "character_lines_per_episode.csv"
OUTPUT_JSON_TEMPLATE = "{scripts_dir}/character_lines_data.json"

# Main cast characters to track
MAIN_CHARACTERS = {
    "Jeff", "Abed", "Shirley", "Britta", "Troy", 
    "Pierce", "Duncan", "Chang", "Pelton", "Frankie", "Elroy"
}

def normalize_character_name(name):
    name = name.strip()
    name_lower = name.lower()
    
    # Map variations to canonical names
    if "jeff" in name_lower:
        return "Jeff"
    elif "abed" in name_lower:
        return "Abed"
    elif "shirley" in name_lower:
        return "Shirley"
    elif "britta" in name_lower:
        return "Britta"
    elif "troy" in name_lower:
        return "Troy"
    elif "pierce" in name_lower:
        return "Pierce"
    elif "duncan" in name_lower:
        return "Duncan"
    elif "chang" in name_lower:
        return "Chang"
    elif "pelton" in name_lower:
        return "Pelton"
    elif "frankie" in name_lower:
        return "Frankie"
    elif "elroy" in name_lower:
        return "Elroy"
    else:
        return None  # Return None for non-main-cast characters

def get_episode_name_from_filename(filename):
    # Remove .csv extension
    name = filename[:-4]
    # Replace underscores with spaces
    name = name.replace("_", " ")
    return name

def count_character_lines(csv_file):
    """Count lines per character in a single episode."""
    character_counts = defaultdict(int)
    
    try:
        with open(csv_file, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if not row or 'character' not in row or 'line' not in row:
                    continue
                
                character = row['character'].strip()
                line = row['line'].strip()
                
                # Skip empty lines
                if not character or not line:
                    continue
                
                # Skip metadata rows (Summary, Featuring, Setting)
                if character in {"Summary", "Featuring", "Setting"}:
                    continue
                
                # Normalize character name
                normalized = normalize_character_name(character)
                
                # Only count main cast characters
                if normalized is None:
                    continue
                
                # Count this line (we're counting line appearances, not word count)
                character_counts[normalized] += 1
    
    except Exception as e:
        print(f"Error reading {csv_file}: {e}")
    
    return character_counts

def analyze_all_episodes(scripts_dir: str):
    """Analyze all episodes and create output files."""
    episode_data = []
    all_characters = set()
    
    # Get all CSV files, sorted
    csv_files = sorted([f for f in os.listdir(scripts_dir) if f.endswith('.csv')])
    
    for csv_file in csv_files:
        filepath = os.path.join(scripts_dir, csv_file)
        episode_name = get_episode_name_from_filename(csv_file)
        
        print(f"Processing: {episode_name}")
        
        # Count lines for this episode
        character_counts = count_character_lines(filepath)
        
        # Store data
        for character, count in character_counts.items():
            episode_data.append({
                'episode': episode_name,
                'character': character,
                'line_count': count
            })
            all_characters.add(character)
    
    # Write to CSV
    with open(OUTPUT_CSV, 'w', newline='', encoding='utf-8') as f:
        fieldnames = ['episode', 'character', 'line_count']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(episode_data)
    
    print(f"\n✓ Created {OUTPUT_CSV}")
    
    # Also create a JSON file for the visualization
    # Restructure data for easier D3 consumption
    json_data = {
        'episodes': [],
        'characters': sorted(list(all_characters))
    }
    
    # Group by episode
    episodes_dict = defaultdict(list)
    for item in episode_data:
        episodes_dict[item['episode']].append({
            'character': item['character'],
            'lines': item['line_count']
        })
    
    # Create episodes array
    for episode_name in sorted(episodes_dict.keys()):
        characters = episodes_dict[episode_name]
        total_lines = sum(c['lines'] for c in characters)
        
        episode_obj = {
            'name': episode_name,
            'characters': []
        }
        
        for char in sorted(list(all_characters)):
            char_data = next((c for c in characters if c['character'] == char), None)
            lines = char_data['lines'] if char_data else 0
            percentage = (lines / total_lines * 100) if total_lines > 0 else 0
            
            episode_obj['characters'].append({
                'name': char,
                'lines': lines,
                'percentage': round(percentage, 2)
            })
        
        json_data['episodes'].append(episode_obj)
    
    # Write JSON file into scripts_dir
    output_json = OUTPUT_JSON_TEMPLATE.format(scripts_dir=scripts_dir)
    with open(output_json, 'w', encoding='utf-8') as f:
        json.dump(json_data, f, indent=2)
    print(f"✓ Created {output_json}")

    # Also create an index.json for the frontend
    index = []
    for csv_file in csv_files:
        episode_name = get_episode_name_from_filename(csv_file)
        index.append({
            'file': csv_file,
            'episode': episode_name
        })
    index_path = os.path.join(scripts_dir, 'index.json')
    with open(index_path, 'w', encoding='utf-8') as f:
        json.dump(index, f, indent=2)
    print(f"✓ Created {index_path}")
    print(f"\nAnalyzed {len(json_data['episodes'])} episodes")
    print(f"Tracked {len(json_data['characters'])} main characters")
    print(f"Characters: {', '.join(sorted(json_data['characters']))}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Analyze character lines from CSV scripts folder')
    parser.add_argument('--scripts-dir', default=SCRIPTS_DIR, help='Folder containing episode CSV files')
    args = parser.parse_args()
    analyze_all_episodes(args.scripts_dir)
