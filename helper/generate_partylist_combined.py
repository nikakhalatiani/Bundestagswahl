import pandas as pd
from pathlib import Path

# --- Configuration ----------------------------------------------------
DATA_DIR = Path("data")
OUTPUT_DIR = Path("Bundestagswahl/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

elections_file = OUTPUT_DIR / "elections.csv"
states_file = OUTPUT_DIR / "state_id_mapping.csv"
party_map_file = OUTPUT_DIR / "party_id_mapping.csv"

state_parties_files = [
    DATA_DIR / "state_parties2021.csv",
    DATA_DIR / "state_parties2025.csv",
]

output_combined = OUTPUT_DIR / "party_lists.csv"
# ----------------------------------------------------------------------

try:
    # --- Load reference lookup tables --------------------------------
    elections_df = pd.read_csv(elections_file, sep=";", encoding="utf-8")
    states_df = pd.read_csv(states_file, sep=";", encoding="utf-8")
    party_map_df = pd.read_csv(party_map_file, sep=";", encoding="utf-8")

    elections = dict(zip(elections_df["Year"], elections_df["Date"]))
    state_map = dict(zip(states_df["GebietLandAbk"], states_df["StateID"]))

    print(
        f"Loaded {len(elections)} elections, {len(state_map)} states, "
        f"{party_map_df['PartyID'].nunique()} distinct parties.\n"
    )

    all_rows = []

    for file in state_parties_files:
        year = int(file.stem[-4:])
        print(f"Reading {file.name} for {year}...")
        df = pd.read_csv(file, sep=";", encoding="utf-8-sig")
        df.columns = [c.strip() for c in df.columns]
        required_cols = {"GebietLandAbk", "GruppennameKurz", "Anzahl"}
        if not required_cols.issubset(df.columns):
            raise KeyError(f"{file.name} missing expected columns {required_cols}")

        df["Year"] = year
        df["Date"] = elections.get(year)

        # Replace state abbreviations by numeric ID
        df["StateID"] = df["GebietLandAbk"].map(state_map)

        # Map party short names → PartyID through the yearly mapping file
        mapping_this_year = party_map_df.loc[
            party_map_df["Year"] == year, ["ShortName", "PartyID"]
        ].drop_duplicates(subset=["ShortName"])
        year_party_map = dict(zip(mapping_this_year["ShortName"], mapping_this_year["PartyID"]))
        df["PartyID"] = df["GruppennameKurz"].map(year_party_map)

        missing = df[df["PartyID"].isna()]["GruppennameKurz"].unique()
        if len(missing) > 0:
            print(f"Unmapped parties in {file.name}: {missing}")
        else:
            print("   All parties mapped for this year.")

        df = df.dropna(subset=["StateID", "PartyID"])
        df = df.rename(columns={"Anzahl": "VoteCount"})
        df = df[["Year", "Date", "StateID", "PartyID", "VoteCount"]]
        all_rows.append(df)

    # --- Combine years, assign ID ------------------------------------
    combined = pd.concat(all_rows, ignore_index=True)
    combined.insert(0, "PartyListID", range(1, len(combined) + 1))

    combined.to_csv(output_combined, sep=";", index=False, encoding="utf-8")

    print(f"\nCombined party lists saved → {output_combined.name} ({len(combined)} rows)\n")

except FileNotFoundError as e:
    print(f"Missing file: {e.filename}")
except Exception as e:
    print(f"Unexpected error: {e}")