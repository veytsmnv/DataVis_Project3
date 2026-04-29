import os
import json
import csv
import re
from pathlib import Path
from collections import defaultdict

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer


def extract_episode_name(filename: str) -> str:
    match = re.match(r'(\d+x\d+)', filename)
    return match.group(1) if match else filename.replace('.csv', '')


def load_episode_scripts():
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
        print(f"Processing {csv_file.name} (Episode: {episode_id})...")
        
        try:
            with open(csv_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                line_count = 0
                
                for row in reader:
                    # Combine all text from the row
                    text = ' '.join(str(v) for v in row.values() if v)
                    episode_texts[episode_id] += ' ' + text
                    line_count += 1
                
                print(f"  → Loaded {line_count} lines")
        
        except Exception as e:
            print(f"  ✗ Error reading {csv_file.name}: {e}")
    
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


def calculate_tfidf(episode_texts: dict, top_n: int = 10):
    """Calculate TF-IDF scores and extract top words per episode."""
    
    if not episode_texts:
        print("No episode texts found.")
        return {}
    
    print(f"\nProcessing {len(episode_texts)} episodes with TF-IDF...\n")
    
    # Preprocess texts
    processed_texts = {ep: preprocess_text(text) for ep, text in episode_texts.items()}
    
    # Characters to exclude
    characters = {
        'jeff', 'britta', 'troy', 'abed', 'annie', 'shirley', 'pierce', 
        'dean', 'chang', 'pelton', 'hickey', 'frankie', 'elroy', 'duncan', 'vaughn'
    }
    
    # Create TF-IDF vectorizer with built-in English stopwords + character names
    vectorizer = TfidfVectorizer(
        stop_words=list(characters),
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
    
    # Extract top words per episode
    episode_top_words = {}
    
    for idx, episode_id in enumerate(episode_ids):
        # Get TF-IDF scores for this document
        tfidf_scores = tfidf_matrix[idx].toarray()[0]
        
        # Get top N words
        top_indices = np.argsort(tfidf_scores)[-top_n:][::-1]
        top_words = [
            {
                "word": feature_names[i],
                "tfidf_score": float(tfidf_scores[i])
            }
            for i in top_indices if tfidf_scores[i] > 0
        ]
        
        episode_top_words[episode_id] = top_words
        
        # Print progress
        print(f"{episode_id}: {[w['word'] for w in top_words[:5]]}")
    
    return episode_top_words


def save_results(results: dict, output_file: str = "all_scripts/tfidf_episode_words.json"):
    """Save results to JSON file."""
    output_path = Path(output_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    print(f"\n✓ Results saved to {output_path}")


def main():
    """Main execution function."""
    print("="*60)
    print("TF-IDF Episode Word Analysis")
    print("="*60)
    
    # Load scripts
    episode_texts = load_episode_scripts()
    
    if not episode_texts:
        print("No episode texts loaded. Exiting.")
        return
    
    # Calculate TF-IDF
    top_words = calculate_tfidf(episode_texts, top_n=15)
    
    # Save results
    save_results(top_words)
    
    print(f"\n✓ Processed {len(top_words)} episodes successfully!")


if __name__ == "__main__":
    main()
