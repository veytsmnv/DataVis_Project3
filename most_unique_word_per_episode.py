import os
import json
import csv
import re
from pathlib import Path
from collections import defaultdict

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer


def extract_episode_name(filename: str) -> str:
    """Extract episode identifier from filename (e.g., '1x1' from '1x1_Pilot.csv')"""
    match = re.match(r'(\d+x\d+)', filename)
    return match.group(1) if match else filename.replace('.csv', '')


def load_episode_scripts():
    """Load all scripts from all_scripts directory and organize by episode."""
    episode_texts = defaultdict(str)
    scripts_dir = Path("all_scripts")
    
    if not scripts_dir.exists():
        print(f"Directory {scripts_dir} does not exist.")
        return episode_texts
    
    # Get all CSV files
    csv_files = sorted(scripts_dir.glob("*.csv"))
    print(f"Found {len(csv_files)} CSV files\n")
    
    for csv_file in csv_files:
        if csv_file.name in ['character_lines_per_episode.csv', 'CommunityShowScriptLinks.csv']:
            continue  # Skip metadata files
        
        episode_id = extract_episode_name(csv_file.name)
        
        try:
            with open(csv_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                line_count = 0
                
                for row in reader:
                    # Combine all text from the row
                    text = ' '.join(str(v) for v in row.values() if v)
                    episode_texts[episode_id] += ' ' + text
                    line_count += 1
        
        except Exception as e:
            print(f"Error reading {csv_file.name}: {e}")
    
    return episode_texts


def preprocess_text(text: str) -> str:
    """Clean and preprocess text."""
    # Convert to lowercase
    text = text.lower()
    # Remove special characters and numbers, keep only letters and spaces
    text = re.sub(r'[^a-z\s]', '', text)
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def find_most_unique_words(episode_texts: dict):
    """Find the single most unique word per episode using TF-IDF."""
    
    if not episode_texts:
        print("No episode texts found.")
        return {}
    
    print(f"Processing {len(episode_texts)} episodes with TF-IDF...\n")
    
    # Preprocess texts
    processed_texts = {ep: preprocess_text(text) for ep, text in episode_texts.items()}
    
    # Main characters to exclude
    main_characters = {
        'jeff', 'britta', 'troy', 'abed', 'annie', 'shirley', 'pierce', 
        'dean', 'chang', 'pelton', 'hickey', 'frankie', 'elroy', 'duncan'
    }
    
    # Combine English stopwords with character names
    stop_words = set(['english'])  # Use sklearn's built-in English stopwords
    all_stop_words = list(stop_words) + list(main_characters)
    
    # Create TF-IDF vectorizer with built-in English stopwords + character names
    vectorizer = TfidfVectorizer(
        stop_words=all_stop_words,
        max_features=10000,
        min_df=1,
        max_df=0.95
    )
    
    # Create document list in consistent order
    episode_ids = sorted(processed_texts.keys())
    documents = [processed_texts[ep] for ep in episode_ids]
    
    # Fit and transform
    tfidf_matrix = vectorizer.fit_transform(documents)
    feature_names = vectorizer.get_feature_names_out()
    
    # Extract the single most unique word per episode
    most_unique_words = {}
    
    for idx, episode_id in enumerate(episode_ids):
        # Get TF-IDF scores for this document
        tfidf_scores = tfidf_matrix[idx].toarray()[0]
        
        # Find the word with the highest TF-IDF score
        max_idx = np.argmax(tfidf_scores)
        most_unique_word = feature_names[max_idx]
        max_score = float(tfidf_scores[max_idx])
        
        most_unique_words[episode_id] = {
            "word": most_unique_word,
            "tfidf_score": max_score
        }
        
        print(f"{episode_id}: {most_unique_word} (score: {max_score:.4f})")
    
    return most_unique_words


def save_results(results: dict, output_file: str = "all_scripts/most_unique_words_per_episode.json"):
    """Save results to JSON file."""
    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    print(f"\n✓ Results saved to {output_path}")


def main():
    """Main execution function."""
    print("="*60)
    print("Most Unique Word Per Episode (TF-IDF Analysis)")
    print("="*60 + "\n")
    
    # Load scripts
    episode_texts = load_episode_scripts()
    
    if not episode_texts:
        print("No episode texts loaded. Exiting.")
        return
    
    # Find most unique word per episode
    most_unique_words = find_most_unique_words(episode_texts)
    
    # Save results
    save_results(most_unique_words)
    
    print(f"\n✓ Processed {len(most_unique_words)} episodes successfully!")


if __name__ == "__main__":
    main()
