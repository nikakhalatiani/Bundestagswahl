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
# ----------------------------------------------------------------------


def normalize_name(name: str) -> str:
    """Normalize constituency names for deduplication."""
    if not isinstance(name, str):
        return ""
    n = name.strip()
    n = unicodedata.normalize("NFKC", n)          # normalize Unicode form
    n = re.sub(r"[–—]", "-", n)                  # convert en/em dashes -> hyphen
    n = re.sub(r"\s*-\s*", " - ", n)             # normalize spaces around hyphen
    n = re.sub(r"[\s\u00A0]+", " ", n).strip()   # collapse whitespace
    return n.lower()


try:
    # --- Load state mapping ------------------------------------------
    mapping_df = pd.read_csv(mapping_file, sep=";", encoding="utf-8")
    state_map = dict(zip(mapping_df["GebietLandAbk"], mapping_df["StateID"]))
    print(f"📖 Loaded {len(state_map)} state mappings.\n")

    all_dfs = []
    election_rows = []

    for path in wahlkreis_files:
        year = int(path.stem[-4:])
        print(f"🗂 Reading {path.name} for year {year} ...")

        # Read & normalize column names
        df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
        df.columns = [c.strip().lower() for c in df.columns]

        def find(term):
            return next((c for c in df.columns if term.lower() in c), None)

        num, name, abbr = find("gebietsnummer"), find("gebietsname"), find("gebietlandabk")
        if not all([num, name, abbr]):
            raise KeyError(f"{path.name} missing Gebietsnummer/Gebietsname/GebietLandAbk")

        # Keep only needed cols & rename clearly
        df = df[[num, name, abbr]].rename(
            columns={num: "Number", name: "Name", abbr: "StateAbbr"}
        )

        # Map to numeric state IDs
        df["StateID"] = df["StateAbbr"].map(state_map)
        missing = df[df["StateID"].isna()]["StateAbbr"].unique()
        if len(missing) > 0:
            print(f"⚠ Unknown states in {path.name}: {missing}")

        df["Year"] = year
        df["NormalizedName"] = df["Name"].apply(normalize_name)
        all_dfs.append(df)

        election_rows.append({"ElectionID": len(election_rows) + 1, "Year": year})

    # Combine 2021 + 2025
    combined = pd.concat(all_dfs, ignore_index=True)

    # --- Unique constituencies ---------------------------------------
    unique_const = (
        combined[["Number", "Name", "NormalizedName", "StateID"]]
        .drop_duplicates(subset=["Number", "NormalizedName"])
        .sort_values(["StateID", "Number"])
        .reset_index(drop=True)
    )
    unique_const.insert(0, "ConstituencyID", unique_const.index + 1)

    # --- Elections table ---------------------------------------------
    elections = pd.DataFrame(election_rows)
    # you can change these dates to the real ones later
    elections["Date"] = [f"{y}-09-26" for y in elections["Year"]]

    # --- Bridge table (which constituency participated when) ----------
    bridge = combined.merge(
        unique_const[["ConstituencyID", "Number", "NormalizedName"]],
        on=["Number", "NormalizedName"],
        how="left",
        validate="many_to_one",
    )[["Year", "ConstituencyID"]].drop_duplicates().reset_index(drop=True)
    bridge.insert(0, "BridgeID", bridge.index + 1)

    # --- Save outputs -------------------------------------------------
    unique_const.drop(columns=["NormalizedName"]).to_csv(
        out_constituencies, sep=";", index=False, encoding="utf-8"
    )
    elections.to_csv(out_elections, sep=";", index=False, encoding="utf-8")
    bridge.to_csv(out_bridge, sep=";", index=False, encoding="utf-8")

    # --- Log results -------------------------------------------------
    print(f"\n✅ Wrote {len(unique_const)} constituencies → {out_constituencies.name}")
    print(f"✅ Wrote {len(elections)} elections → {out_elections.name}")
    print(f"✅ Wrote {len(bridge)} bridge rows → {out_bridge.name}\n")

except FileNotFoundError as e:
    print(f"❌ Missing file: {e.filename}")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {e}")