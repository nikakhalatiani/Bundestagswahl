import pandas as pd
import unicodedata
import re
from pathlib import Path

# --- Configuration ----------------------------------------------------
DATA_DIR = Path("data")
OUTPUT_DIR = Path("Bundestagswahl/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

mapping_file = OUTPUT_DIR / "state_id_mapping.csv"
wahlkreis_files = [
    DATA_DIR / "wahlkreis2021.csv",
    DATA_DIR / "wahlkreis2025.csv",
]

out_constituencies = OUTPUT_DIR / "constituencies.csv"
out_elections = OUTPUT_DIR / "elections.csv"
out_bridge = OUTPUT_DIR / "constituency_elections.csv"

# NEW - year-specific outputs
out_const_2021 = OUTPUT_DIR / "constituencies_2021.csv"
out_const_2025 = OUTPUT_DIR / "constituencies_2025.csv"
# ----------------------------------------------------------------------


def normalize_name(name: str) -> str:
    if not isinstance(name, str):
        return ""
    n = name.strip()
    n = unicodedata.normalize("NFKC", n)
    n = re.sub(r"[–-]", "-", n)
    n = re.sub(r"\s*-\s*", " - ", n)
    n = re.sub(r"[\s\u00A0]+", " ", n).strip()
    return n.lower()


try:
    # --- Load state mapping ------------------------------------------
    mapping_df = pd.read_csv(mapping_file, sep=";", encoding="utf-8")
    state_map = dict(zip(mapping_df["GebietLandAbk"], mapping_df["StateID"]))
    print(f"Loaded {len(state_map)} state mappings.\n")

    all_dfs = []
    election_rows = []
    dfs_by_year = {}  # store pre-combined dfs for later split

    for path in wahlkreis_files:
        year = int(path.stem[-4:])
        print(f"Reading {path.name} for year {year} ...")

        df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
        df.columns = [c.strip().lower() for c in df.columns]

        def find(term):
            return next((c for c in df.columns if term.lower() in c), None)

        num, name, abbr = find("gebietsnummer"), find("gebietsname"), find("gebietlandabk")
        if not all([num, name, abbr]):
            raise KeyError(f"{path.name} missing Gebietsnummer/Gebietsname/GebietLandAbk")

        df = df[[num, name, abbr]].rename(
            columns={num: "Number", name: "Name", abbr: "StateAbbr"}
        )

        df["StateID"] = df["StateAbbr"].map(state_map)
        missing = df[df["StateID"].isna()]["StateAbbr"].unique()
        if len(missing) > 0:
            print(f"Unknown states in {path.name}: {missing}")

        df["Year"] = year
        df["NormalizedName"] = df["Name"].apply(normalize_name)

        all_dfs.append(df)
        dfs_by_year[year] = df.copy()

        election_rows.append({"ElectionID": len(election_rows) + 1, "Year": year})

    # --- Combine both years ------------------------------------------
    combined = pd.concat(all_dfs, ignore_index=True)

    # --- Unique constituencies with ID --------------------------------
    unique_const = (
        combined[["Number", "Name", "NormalizedName", "StateID"]]
        .drop_duplicates(subset=["Number", "NormalizedName"])
        .sort_values(["StateID", "Number"])
        .reset_index(drop=True)
    )
    unique_const.insert(0, "ConstituencyID", unique_const.index + 1)

    # --- Elections ----------------------------------------------------
    elections = pd.DataFrame(election_rows)
    elections["Date"] = [f"{y}-09-26" for y in elections["Year"]]

    # --- Bridge table -------------------------------------------------
    bridge = combined.merge(
        unique_const[["ConstituencyID", "Number", "NormalizedName"]],
        on=["Number", "NormalizedName"],
        how="left",
        validate="many_to_one",
    )[["Year", "ConstituencyID"]].drop_duplicates().reset_index(drop=True)

    bridge.insert(0, "BridgeID", bridge.index + 1)

    # --- Save main outputs -------------------------------------------
    unique_const.drop(columns=["NormalizedName"]).to_csv(
        out_constituencies, sep=";", index=False, encoding="utf-8"
    )
    elections.to_csv(out_elections, sep=";", index=False, encoding="utf-8")
    bridge.to_csv(out_bridge, sep=";", index=False, encoding="utf-8")

    # --- NEW: year-specific constituency files ------------------------
    for year, path_out in [(2021, out_const_2021), (2025, out_const_2025)]:
        df_year = dfs_by_year[year].merge(
            unique_const[["ConstituencyID", "Number", "NormalizedName"]],
            on=["Number", "NormalizedName"],
            how="left",
        ).drop_duplicates(subset=["ConstituencyID"])

        df_year_out = df_year[["ConstituencyID", "Number", "Name", "StateID"]].sort_values("ConstituencyID")

        df_year_out.to_csv(path_out, sep=";", index=False, encoding="utf-8")
        print(f"Wrote {path_out.name} with {len(df_year_out)} rows.")

    # --- Logs ---------------------------------------------------------
    print(f"\nWrote {len(unique_const)} constituencies → {out_constituencies.name}")
    print(f"Wrote {len(elections)} elections → {out_elections.name}")
    print(f"Wrote {len(bridge)} bridge rows → {out_bridge.name}")

except FileNotFoundError as e:
    print(f"Missing file: {e.filename}")
except KeyError as e:
    print(f"Missing expected column: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")