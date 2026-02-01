import pandas as pd
from pathlib import Path

# --- Configuration ---
year = 2021                     # or 2021
input_filename = Path(f"data/states{year}.csv")
output_dir = Path("Bundestagswahl/outputs")
output_dir.mkdir(parents=True, exist_ok=True)

states_filename = output_dir / f"states{year}.csv"
mapping_filename = output_dir / "state_id_mapping.csv"
# --- End of Configuration ---

try:
    # Read CSV (semicolon-delimited)
    df = pd.read_csv(input_filename, delimiter=";", encoding="utf-8")

    # Check expected columns
    expected_cols = ["GebietLandAbk", "Gebietsname"]
    if not all(col in df.columns for col in expected_cols):
        raise KeyError(f"Expected columns {expected_cols}, but got {df.columns.tolist()}")

    # Drop duplicates just in case and sort alphabetically by abbreviation
    df = (
        df[expected_cols]
        .drop_duplicates(subset=["GebietLandAbk"])
        .sort_values("GebietLandAbk")
        .reset_index(drop=True)
    )

    # Assign integer IDs (same for both 2021/2025)
    df.insert(0, "StateID", df.index + 1)

    # Save the year‑specific file
    df.to_csv(states_filename, sep=";", index=False, encoding="utf-8")
    print(f"Created '{states_filename.name}' with {len(df)} unique states.")

    # Save / update the shared mapping file (one copy for all years)
    df.to_csv(mapping_filename, sep=";", index=False, encoding="utf-8")
    print(f"Saved mapping in '{mapping_filename.name}'.")
except FileNotFoundError:
    print(f"Error: '{input_filename}' not found.")
except KeyError as e:
    print(f"Missing expected column: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")