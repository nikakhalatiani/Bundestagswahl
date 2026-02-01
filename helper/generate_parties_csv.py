import pandas as pd
from pathlib import Path
import unicodedata, re

# --- Configuration ----------------------------------------------------
DATA_DIR = Path("data")
OUTPUT_DIR = Path("Bundestagswahl/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

inputs = [
    DATA_DIR / "parties2021.csv",
    DATA_DIR / "parties2025.csv",
]

out_master = OUTPUT_DIR / "parties.csv"
out_map = OUTPUT_DIR / "party_id_mapping.csv"
# ----------------------------------------------------------------------


def normalize(s: str) -> str:
    """Normalise a string for safe comparison (case-insensitive match)."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s.strip())
    s = re.sub(r"[–-]", "-", s)
    s = re.sub(r"\s*-\s*", " - ", s)
    s = re.sub(r"[\s\u00A0]+", " ", s)
    return s.lower()


# cross‑year renamings (normalised short names)
ALIASES = {
    "gesundheitsforschung": "verjüngungsforschung",
    "team todenhöfer": "die gerechtigkeitspartei - team todenhöfer",
    "die humanisten": "pdh",
    "die linke": "die linke",
}

try:
    frames = []

    for path in inputs:
        year = int(path.stem[-4:])
        print(f"\nReading {path.name}   (year={year})")

        df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
        print("   Columns found:", list(df.columns))

        # Clean and lower column names (no underscores)
        df.columns = [c.strip().lower() for c in df.columns]

        # handle typical possible cases
        if {"gruppenname", "gruppennameLang".lower()}.issubset(df.columns):
            short_col, long_col = "gruppenname", "gruppennameLang".lower()
        elif {"gruppenname", "gruppennamekurz"}.issubset(df.columns):
            short_col, long_col = "gruppennamekurz", "gruppenname"
        elif "gruppenname" in df.columns:
            short_col, long_col = "gruppenname", "gruppenname"
        else:
            raise KeyError(f"{path.name}: unexpected columns {list(df.columns)}")

        tmp = df[[short_col, long_col]].copy()
        tmp.columns = ["ShortName", "LongName"]
        tmp["Year"] = year

        # Replace empty long names with short ones instead of duplicating always
        tmp["LongName"] = tmp.apply(
            lambda r: r["LongName"] if isinstance(r["LongName"], str) and r["LongName"].strip() else r["ShortName"],
            axis=1,
        )

        # Normalization for matching
        tmp["NormShort"] = tmp["ShortName"].map(normalize).apply(lambda s: ALIASES.get(s, s))
        frames.append(tmp)

    combined = pd.concat(frames, ignore_index=True)
    combined = combined[combined["ShortName"].fillna("").str.strip() != ""]

    # prefer latest version (2025) for display names
    combined = combined.sort_values(["NormShort", "Year"], ascending=[True, True])

    # unique (by canonical short)
    unique_parties = (
        combined.drop_duplicates(subset=["NormShort"], keep="last")
        .sort_values("NormShort")
        .reset_index(drop=True)
    )
    unique_parties.insert(0, "PartyID", unique_parties.index + 1)
    master = unique_parties[["PartyID", "ShortName", "LongName"]].copy()

    # mapping (year→PartyID)
    mapping = (
        combined.merge(
            master.assign(NormShort=master["ShortName"].map(normalize)),
            on="NormShort", how="left", validate="many_to_one"
        )[["Year", "ShortName_x", "LongName_x", "PartyID"]]
        .rename(columns={"ShortName_x": "ShortName", "LongName_x": "LongName"})
        .sort_values(["PartyID", "Year"])
        .reset_index(drop=True)
    )

    master.to_csv(out_master, sep=";", index=False, encoding="utf-8")
    mapping.to_csv(out_map, sep=";", index=False, encoding="utf-8")

    print(f"\nCreated {out_master.name} ({len(master)} unique parties)")
    print(f"Created {out_map.name} ({len(mapping)} total rows)\n")

except Exception as e:
    print("Unexpected error:", e)