import pandas as pd
from pathlib import Path
import unicodedata
import re

# --- Configuration ----------------------------------------------------
DATA_DIR = Path("data")
RAW_DIR = DATA_DIR / "rawData"
OUTPUT_DIR = Path("Bundestagswahl/outputs")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# KERG files (_2: party/system groups, both votes)
KERG_2021 = RAW_DIR / "kerg2021_2.csv"
KERG_2025 = RAW_DIR / "kerg2025_2.csv"

# Existing outputs
CONST_PARTY_VOTES_CSV = OUTPUT_DIR / "constituency_party_votes.csv"
PARTY_LIST_CSV = OUTPUT_DIR / "party_lists.csv"
DIRECT_CANDIDACY_CSV = OUTPUT_DIR / "direct_candidacy.csv"

# Lookup
PARTY_ID_MAPPING_CSV = OUTPUT_DIR / "party_id_mapping.csv"
CONSTITUENCY_2021 = OUTPUT_DIR / "constituencies_2021.csv"
CONSTITUENCY_2025 = OUTPUT_DIR / "constituencies_2025.csv"

# Outputs
OUT_CONST_PARTY_VOTES = OUTPUT_DIR / "constituency_party_votes_enriched.csv"
OUT_PARTY_LIST = OUTPUT_DIR / "party_list_enriched.csv"
OUT_DIRECT = OUTPUT_DIR / "direct_candidacy_enriched.csv"
# ---------------------------------------------------------------------


def normalize_party(s: str) -> str:
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s.strip())
    s = re.sub(r"[–-]", "-", s)
    s = re.sub(r"\s*-\s*", " - ", s)
    s = re.sub(r"[\s\u00A0]+", " ", s)
    return s.lower()


ALIASES = {
    "gesundheitsforschung": "verjüngungsforschung",
    "team todenhöfer": "die gerechtigkeitspartei - team todenhöfer",
    "die humanisten": "pdh",
    "die linke": "die linke",
}


def add_norm_party_short(df: pd.DataFrame, col: str, out_col: str) -> pd.DataFrame:
    df[out_col] = df[col].map(normalize_party).apply(
        lambda s: ALIASES.get(s, s))
    return df


def parse_number_col(series: pd.Series) -> pd.Series:
    """Convert German-style numeric text to float safely (no ×10 bug)."""
    def _fix(s):
        if not isinstance(s, str):
            return s
        s = s.strip()
        if not s:
            return None
        # remove thousand separators only if in ###.### pattern
        s = re.sub(r"(?<=\d)\.(?=\d{3}\b)", "", s)
        # replace decimal comma with dot
        s = s.replace(",", ".")
        return s
    return pd.to_numeric(series.map(_fix), errors="coerce")


def load_kerg(path: Path, year: int) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]
    df["Year"] = year
    return df


def detect_and_correct_x10(df: pd.DataFrame, cols):
    """Detects if typical KergVotes/Anzahl columns are scaled by ×10 and rescales."""
    for c in cols:
        if c in df.columns:
            m = df[c].dropna().abs()
            if not m.empty:
                med = m.median()
                if med > 1e6:  # unrealistic level for Wahlkreis totals
                    df[c] = df[c] / 10
                    print(f"⚙️  Auto‑rescaled '{c}' by ÷10 (median={med}).")
    return df


try:
    # -----------------------------------------------------------------
    # 1) Load and combine KERG_2
    # -----------------------------------------------------------------
    print("🧾 Loading KERG _2 files ...")
    k21 = load_kerg(KERG_2021, 2021)
    k25 = load_kerg(KERG_2025, 2025)
    kerg = pd.concat([k21, k25], ignore_index=True)

    for col in ["Anzahl", "Prozent", "Prozent", "VorpAnzahl", "VorpProzent", "DiffProzent", "DiffProzentPkt"]:
        if col in kerg.columns:
            kerg[col] = parse_number_col(kerg[col])

    # Build constituency mapping
    cons_2021 = pd.read_csv(CONSTITUENCY_2021, sep=";", encoding="utf-8-sig")
    cons_2025 = pd.read_csv(CONSTITUENCY_2025, sep=";", encoding="utf-8-sig")
    cons_2021["Year"] = 2021
    cons_2025["Year"] = 2025
    constituencies = pd.concat([cons_2021, cons_2025], ignore_index=True)
    constituencies.columns = [c.strip() for c in constituencies.columns]
    constituencies["Number"] = constituencies["Number"].astype("Int64")

    kerg_wk = kerg[kerg["Gebietsart"] == "Wahlkreis"].copy()
    kerg_wk["Gebietsnummer_int"] = (
        kerg_wk["Gebietsnummer"]
        .astype(str)
        .str.strip()
        .replace({"": None, "nan": None})
        .astype(float)
        .astype("Int64")
    )

    kerg_wk = kerg_wk.merge(
        constituencies[["Year", "Number", "ConstituencyID"]],
        left_on=["Year", "Gebietsnummer_int"],
        right_on=["Year", "Number"],
        how="left",
    )

    # Party mapping
    party_map = pd.read_csv(PARTY_ID_MAPPING_CSV,
                            sep=";", encoding="utf-8-sig")
    party_map.columns = [c.strip() for c in party_map.columns]
    party_map = add_norm_party_short(party_map, "ShortName", "NormPartyShort")
    party_map_unique = (
        party_map.sort_values(["Year", "NormPartyShort"])
        .drop_duplicates(subset=["Year", "NormPartyShort"], keep="last")
    )

    # -----------------------------------------------------------------
    # 2) Constituency‑party votes enrichment
    # -----------------------------------------------------------------
    print("\n🧭 Enriching constituency_party_votes ...")
    cp = pd.read_csv(CONST_PARTY_VOTES_CSV, sep=";", encoding="utf-8-sig")
    cp.columns = [c.strip() for c in cp.columns]

    kp = kerg_wk[kerg_wk["Gruppenart"] == "Partei"].copy()
    kp = add_norm_party_short(kp, "Gruppenname", "NormPartyShort")

    kp = kp.merge(
        party_map_unique[["Year", "NormPartyShort", "PartyID"]],
        on=["Year", "NormPartyShort"],
        how="left",
    )
    kp["VoteType"] = (
        kp["Stimme"].astype(str).str.strip().replace({"": None, "nan": None})
        .astype(float).astype("Int64")
    )

    agg = (
        kp.groupby(["Year", "ConstituencyID", "PartyID", "VoteType"], dropna=False)[
            ["Anzahl", "Prozent", "VorpAnzahl", "VorpProzent",
                "DiffProzent", "DiffProzentPkt"]
        ]
        .sum()
        .reset_index()
    )
    agg = detect_and_correct_x10(
        agg,
        ["Anzahl", "Prozent", "VorpAnzahl"],
    )
    agg = agg.rename(
        columns={"Anzahl": "KergVotes", "Prozent": "Percent", "VorpAnzahl": "PrevVotes", "VorpProzent": "PrevPercent",
                 "DiffProzent": "DiffPercent", "DiffProzentPkt": "DiffPercentPts"}
    )

    cp_en = cp.merge(
        agg, on=["Year", "ConstituencyID", "PartyID", "VoteType"], how="left"
    )
    cp_en.to_csv(OUT_CONST_PARTY_VOTES, sep=";",
                 index=False, encoding="utf-8-sig")
    print(f"💾 Saved {OUT_CONST_PARTY_VOTES.name} ({len(cp_en)} rows).")

    # -----------------------------------------------------------------
    # 3) party_list enrichment
    # -----------------------------------------------------------------
    print("\n🧭 Enriching party_list ...")
    pl = pd.read_csv(PARTY_LIST_CSV, sep=";", encoding="utf-8-sig")
    pl.columns = [c.strip() for c in pl.columns]

    kland = kerg[
        (kerg["Gebietsart"] == "Land")
        & (kerg["Gruppenart"] == "Partei")
        & (kerg["Stimme"].astype(str).str.strip() == "2")
    ].copy()

    kland["StateID"] = (
        kland["Gebietsnummer"]
        .astype(str)
        .str.strip()
        .replace({"": None, "nan": None})
        .astype(float)
        .astype("Int64")
    )
    kland = add_norm_party_short(kland, "Gruppenname", "NormPartyShort")
    kland = kland.merge(
        party_map_unique[["Year", "NormPartyShort", "PartyID"]],
        on=["Year", "NormPartyShort"],
        how="left",
    )

    agg_land = (
        kland.groupby(["Year", "StateID", "PartyID"], dropna=False)[
            ["Anzahl", "Prozent", "VorpAnzahl", "VorpProzent",
                "DiffProzent", "DiffProzentPkt"]
        ]
        .sum()
        .reset_index()
    )
    agg_land = detect_and_correct_x10(agg_land, ["Anzahl", "Prozent", "VorpAnzahl"])
    agg_land = agg_land.rename(
        columns={"Anzahl": "KergVotes", "Prozent": "Percent", "VorpAnzahl": "PrevVotes", "VorpProzent": "PrevPercent",
                 "DiffProzent": "DiffPercent", "DiffProzentPkt": "DiffPercentPts"}
    )

    pl_en = pl.merge(agg_land, on=["Year", "StateID", "PartyID"], how="left")
    pl_en.to_csv(OUT_PARTY_LIST, sep=";", index=False, encoding="utf-8-sig")
    print(f"💾 Saved {OUT_PARTY_LIST.name} ({len(pl_en)} rows).")

    # -----------------------------------------------------------------
    # 4) direct_candidacy enrichment stub
    # -----------------------------------------------------------------
    print("\n🧭 Copying direct_candidacy (placeholder for future deltas) ...")
    dc = pd.read_csv(DIRECT_CANDIDACY_CSV, sep=";", encoding="utf-8-sig")
    dc.to_csv(OUT_DIRECT, sep=";", index=False, encoding="utf-8-sig")
    print(f"💾 Saved {OUT_DIRECT.name} ({len(dc)} rows).")

    print("\n🎉 Done.\n")

except FileNotFoundError as e:
    print(f"❌ Missing file: {e.filename}")
except KeyError as e:
    print(f"❌ Missing expected column: {e}")
except Exception as e:
    print(f"❌ Unexpected error: {type(e).__name__}: {e}")
