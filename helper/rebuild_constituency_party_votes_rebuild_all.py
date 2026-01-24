import pandas as pd
from pathlib import Path
import unicodedata
import re

# ----------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------
DATA_DIR = Path("data")
RAW_DIR = DATA_DIR / "rawData"

KERG_2021 = RAW_DIR / "kerg2021_2.csv"
KERG_2025 = RAW_DIR / "kerg2025_2_new.csv"

CONST_ELECTIONS = DATA_DIR / "constituency_elections.csv"
CONSTITUENCIES_2021 = DATA_DIR / "old2.0/constituencies_2021.csv"
CONSTITUENCIES_2025 = DATA_DIR / "old2.0/constituencies_2025.csv"
PARTY_MAP = DATA_DIR / "old2.0/party_id_mapping.csv"

CURRENT_CPV = DATA_DIR / "constituency_party_votes.csv"
OUT_UPDATED = DATA_DIR / "constituency_party_votes_rebuilt.csv"
# ----------------------------------------------------------------------


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


def add_norm_party(df: pd.DataFrame, src: str, dst: str) -> pd.DataFrame:
    df[dst] = df[src].map(normalize_party).apply(lambda s: ALIASES.get(s, s))
    return df


def parse_num(series: pd.Series) -> pd.Series:
    """Convert German style numerals safely."""
    def _fix(x):
        if not isinstance(x, str):
            return x
        x = x.strip()
        if not x:
            return None
        x = re.sub(r"(?<=\d)\.(?=\d{3}\b)", "", x)
        x = x.replace(",", ".")
        return x
    return pd.to_numeric(series.map(_fix), errors="coerce")


def load_kerg(path: Path, year: int) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]
    df["Year"] = year
    return df


# ----------------------------------------------------------------------
# 1) Load reference data
# ----------------------------------------------------------------------
print("🧭 Loading reference CSVs ...")

cpv_old = pd.read_csv(CURRENT_CPV, sep=";", encoding="utf-8-sig")
cpv_columns = list(cpv_old.columns)

elections = pd.read_csv(CONST_ELECTIONS, sep=";", encoding="utf-8-sig")

cons21 = pd.read_csv(CONSTITUENCIES_2021, sep=";", encoding="utf-8-sig")
cons25 = pd.read_csv(CONSTITUENCIES_2025, sep=";", encoding="utf-8-sig")
cons21["Year"] = 2021
cons25["Year"] = 2025
cons_all = pd.concat([cons21, cons25], ignore_index=True)
cons_all.columns = [c.strip() for c in cons_all.columns]
cons_all["Number"] = cons_all["Number"].astype("Int64")

party_map = pd.read_csv(PARTY_MAP, sep=";", encoding="utf-8-sig")
party_map = add_norm_party(party_map, "ShortName", "NormPartyShort")
party_map_unique = (
    party_map.sort_values(["Year", "NormPartyShort"])
    .drop_duplicates(subset=["Year", "NormPartyShort"], keep="last")
)

# ----------------------------------------------------------------------
# 2) Load and clean KERG for both years
# ----------------------------------------------------------------------
print("🧾 Loading KERG 2021 + updated 2025 ...")

k21 = load_kerg(KERG_2021, 2021)
k25 = load_kerg(KERG_2025, 2025)
kerg = pd.concat([k21, k25], ignore_index=True)

kerg = kerg[kerg["Gebietsart"] == "Wahlkreis"].copy()

for c in ["Anzahl", "VorpAnzahl", "Prozent", "VorpProzent", "DiffProzent", "DiffProzentPkt"]:
    if c in kerg.columns:
        kerg[c] = parse_num(kerg[c])

kerg["Number"] = (
    kerg["Gebietsnummer"].astype(str).str.strip().str.lstrip("0").replace({"": None})
)
kerg["Number"] = pd.to_numeric(kerg["Number"], errors="coerce").astype("Int64")
kerg["VoteType"] = pd.to_numeric(kerg["Stimme"], errors="coerce").astype("Int64")

# ----------------------------------------------------------------------
# 3) Select usable rows: Partei, EB/Wählergruppe
# ----------------------------------------------------------------------
print("🔍 Selecting Partei + Einzelbewerber/Wählergruppe")

kp = kerg[
    (
        kerg["Gruppenart"].isin(
            ["Partei", "Einzelbewerber", "Einzelbewerber/Wählergruppe"]
        )
    )
].copy()

# Keep EB names as-is (e.g. "für mehr Bürgerbeteiligung", "ZUKUNFT")
add_norm_party(kp, "Gruppenname", "NormPartyShort")

# ----------------------------------------------------------------------
# 4) Attach PartyID where known; create synthetic IDs where missing
# ----------------------------------------------------------------------
kp = kp.merge(
    party_map_unique[["Year", "NormPartyShort", "PartyID"]],
    on=["Year", "NormPartyShort"],
    how="left",
)

# ------------------------------------------------------------------
# When PartyID missing, use Gruppenname directly instead of 900*
# ------------------------------------------------------------------
missing_mask = kp["PartyID"].isna()
if missing_mask.any():
    unmapped = kp.loc[missing_mask, ["Year", "Gruppenname"]].drop_duplicates()
    print(
        f"⚠ {len(unmapped)} KERG parties/candidates not in mapping; "
        "using original Gruppenname as PartyID string."
    )
    kp.loc[missing_mask, "PartyID"] = kp.loc[missing_mask, "Gruppenname"]

# ----------------------------------------------------------------------
# 5) Map constituencies & BridgeID
# ----------------------------------------------------------------------
kp = kp.merge(
    cons_all[["Year", "Number", "ConstituencyID"]],
    on=["Year", "Number"],
    how="left",
)
bridge_map = elections[["Year", "ConstituencyID", "BridgeID"]].drop_duplicates()
kp = kp.merge(bridge_map, on=["Year", "ConstituencyID"], how="left")

# ----------------------------------------------------------------------
# 6) Aggregate all numeric metrics
# ----------------------------------------------------------------------
print("🧮 Aggregating votes + percentages + previous values ...")

numeric_src_cols = [
    c for c in [
        "Anzahl",
        "Prozent",
        "VorpAnzahl",
        "VorpProzent",
        "DiffProzent",
        "DiffProzentPkt",
    ] if c in kp.columns
]

group_cols = ["Year", "BridgeID", "PartyID", "Gruppenname", "VoteType"]

agg = (
    kp.groupby(group_cols, dropna=False)[numeric_src_cols]
    .sum()
    .reset_index()
)

rename_map = {
    "Anzahl": "Votes",
    "Prozent": "Percent",
    "VorpAnzahl": "PrevVotes",
    "VorpProzent": "PrevPercent",
    "DiffProzent": "DiffPercent",
    "DiffProzentPkt": "DiffPercentPts",
}
agg = agg.rename(columns=rename_map)
agg = agg.rename(columns={"Gruppenname": "PartyName"})

# # Drop truly empty vote rows (no Erst-/Zweitstimme)
# agg = agg[agg["Votes"] > 0]

# ----------------------------------------------------------------------
# 7) Build new CPV with same columns as old
# ----------------------------------------------------------------------
print("🔁 Building new constituency_party_votes from KERG for 2021 + 2025 ...")

cpv_new = agg.copy()

# If old file has no Year column, drop it
if "Year" not in cpv_columns and "Year" in cpv_new.columns:
    cpv_new = cpv_new.drop(columns=["Year"])

# Make sure all expected columns exist
for c in cpv_columns:
    if c not in cpv_new.columns:
        cpv_new[c] = None

# If an ID column exists, regenerate sequential IDs
if "ID" in cpv_columns:
    cpv_new["ID"] = range(1, len(cpv_new) + 1)

# Reorder columns to match original schema
cpv_new = cpv_new[cpv_columns]

cpv_new.to_csv(OUT_UPDATED, sep=";", index=False, encoding="utf-8-sig")
print(f"💾 Saved rebuilt file → {OUT_UPDATED.name} ({len(cpv_new)} rows).")
print("✅ All useful metrics (Percent, PrevVotes, PrevPercent, DiffPercentPts) restored from KERG.")
print("✅ Each Einzelbewerber/Wählergruppe is a separate row in 2021 and 2025.")