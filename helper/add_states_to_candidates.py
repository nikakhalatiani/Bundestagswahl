import pandas as pd
import os

def normalize_string(series):
    """Helper to normalize strings for the key (lowercase, stripped)."""
    return series.astype(str).str.strip().str.lower()

def create_key(df):
    """Creates the unique identifier based on specific logic."""
    # Ensure columns exist to avoid KeyErrors
    req_cols = ["Nachname", "Vornamen", "Geschlecht", "Geburtsjahr"]
    for col in req_cols:
        if col not in df.columns:
            # Handle potential case sensitivity in headers
            match = [c for c in df.columns if c.lower() == col.lower()]
            if match:
                df.rename(columns={match[0]: col}, inplace=True)
            else:
                raise KeyError(f"Column '{col}' not found in file.")

    return (
        normalize_string(df["Nachname"])
        + "|" + normalize_string(df["Vornamen"])
        + "|" + normalize_string(df["Geschlecht"])
        + "|" + df["Geburtsjahr"].fillna("").astype(str).str.strip()
    )

def enrich_candidates(target_file, source_file, output_file):
    print(f"Processing: {target_file} using source {source_file}...")
    
    try:
        # 1. Load the files
        # Using encoding='utf-8' by default, but falling back to latin-1 if needed
        # dtype=str ensures Zip codes or Years don't get converted to floats
        try:
            target_df = pd.read_csv(target_file, sep=';', encoding='utf-8', dtype=str)
            source_df = pd.read_csv(source_file, sep=';', encoding='utf-8', dtype=str)
        except UnicodeDecodeError:
            target_df = pd.read_csv(target_file, sep=';', encoding='latin-1', dtype=str)
            source_df = pd.read_csv(source_file, sep=';', encoding='latin-1', dtype=str)

        # 2. Create the Key for the Source File
        source_df["key"] = create_key(source_df)
        
        # 3. Create a Lookup Dictionary (Key -> State)
        # We assume 'GebietLandAbk' holds the State abbreviation (e.g., 'SH', 'BY')
        # If a person appears multiple times in source, we drop duplicates to keep the unique mapping
        state_lookup = source_df[["key", "GebietLandAbk"]].drop_duplicates(subset="key")
        state_lookup = state_lookup.rename(columns={"GebietLandAbk": "Bundesland_Liste"})

        # 4. Create the Key for the Target File
        target_df["key"] = create_key(target_df)

        # 5. Merge the State info into the Target
        # How='left' ensures we keep all rows from candidates file, even if no match found
        merged_df = pd.merge(target_df, state_lookup, on="key", how="left")

        # 6. Clean up: Remove the helper key column
        merged_df.drop(columns=["key"], inplace=True)

        # 7. Save to new CSV
        merged_df.to_csv(output_file, sep=';', index=False, encoding='utf-8')
        print(f"Success! Saved to {output_file}")
        print("-" * 40)

    except Exception as e:
        print(f"Error processing {target_file}: {e}")

def main():
    # File definitions
    files_to_process = [
        {
            "target": "data/candidates2025.csv", 
            "source": "data/rawData/kand2025.csv", 
            "output": "candidates2025_with_state.csv"
        },
        {
            "target": "data/candidates2021.csv", 
            "source": "data/rawData/kand2021.csv", 
            "output": "candidates2021_with_state.csv"
        }
    ]

    for job in files_to_process:
        if os.path.exists(job["target"]) and os.path.exists(job["source"]):
            enrich_candidates(job["target"], job["source"], job["output"])
        else:
            print(f"Skipping job. Missing files: {job['target']} or {job['source']}")

if __name__ == "__main__":
    main()