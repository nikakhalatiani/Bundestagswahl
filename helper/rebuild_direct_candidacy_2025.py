import pandas as pd
from pathlib import Path

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
DATA_DIR  = Path("data")
RAW_DIR   = DATA_DIR / "rawData"

KERG_2025      = RAW_DIR / "kerg2025_2_new.csv"
PERSONS_CSV    = DATA_DIR / "persons.csv"
CONST_2025     = DATA_DIR / "old2.0/constituencies_2025.csv"
DIRECT_CAND    = DATA_DIR / "direct_candidacy.csv"
PARTY_MAP      = DATA_DIR / "old2.0/party_id_mapping.csv"

OUT_FILE = DATA_DIR / "direct_candidacy_updated.csv"
# -------------------------------------------------------------------

def parse_num(x):
    if not isinstance(x, str): return x
    x = x.strip()
    if not x: return None
    x = x.replace(".", "").replace(",", ".")
    return x

# -------------------------------------------------------------------
# 1) Load base data
# -------------------------------------------------------------------
print("🧭 Loading input files ...")
persons  = pd.read_csv(PERSONS_CSV, sep=";", encoding="utf-8-sig")
const25  = pd.read_csv(CONST_2025, sep=";", encoding="utf-8-sig")
party_map = pd.read_csv(PARTY_MAP, sep=";", encoding="utf-8-sig")
direct   = pd.read_csv(DIRECT_CAND, sep=";", encoding="utf-8-sig")

# -------------------------------------------------------------------
# 2) Load and clean KERG 2025
# -------------------------------------------------------------------
print("🧾 Loading KERG 2025 (new) ...")
kerg = pd.read_csv(KERG_2025, sep=";", encoding="utf-8-sig")
kerg.columns = [c.strip() for c in kerg.columns]

# Keep only constituency-level candidate rows (no System‑Gruppe)
kerg = kerg[
    (kerg["Gebietsart"] == "Wahlkreis") &
    (kerg["Stimme"] == 1) &
    (kerg["Gruppenart"].isin(
        ["Partei", "Einzelbewerber", "Einzelbewerber/Wählergruppe"]
    ))
].copy()

kerg["Anzahl"] = pd.to_numeric(kerg["Anzahl"].map(parse_num), errors="coerce")

# Map Wahlkreis number → ConstituencyID
kerg["Number"] = pd.to_numeric(
    kerg["Gebietsnummer"].astype(str).str.strip().str.lstrip("0"),
    errors="coerce"
).astype("Int64")
const25["Number"] = const25["Number"].astype("Int64")

kerg = kerg.merge(const25[["Number", "ConstituencyID"]],
                  on="Number", how="left")

# -------------------------------------------------------------------
# 3) Map PartyIDs
# -------------------------------------------------------------------
# ensure unique ShortName mapping
party_map.columns = [c.strip() for c in party_map.columns]
pmap = party_map.drop_duplicates(subset=["ShortName"])

kerg = kerg.merge(
    pmap[["ShortName", "PartyID"]],
    left_on="Gruppenname",
    right_on="ShortName",
    how="left"
)

# -------------------------------------------------------------------
# 4) Aggregate first‑vote totals per (ConstituencyID, PartyID)
# -------------------------------------------------------------------
print("🧮 Aggregating first‑votes per constituency and party …")
votes = (
    kerg.groupby(["ConstituencyID", "PartyID"], dropna=False)["Anzahl"]
    .sum()
    .reset_index()
    .rename(columns={"Anzahl": "Erststimmen"})
)

print(f"DEBUG: total summed votes → {int(votes['Erststimmen'].sum()):,}")

# -------------------------------------------------------------------
# 5) Recreate 2025 direct‑candidacy block
# -------------------------------------------------------------------
print("🔗 Building 2025 candidate entries ...")

# build new 2025 rows similar to 2021 structure
template = ["PersonID", "Year", "ConstituencyID",
            "Erststimmen", "PreviouslyElected", "PartyID"]

# create PersonIDs sequentially (no individual names available for now)
votes = votes.reset_index(drop=True)
votes.insert(0, "PersonID", range(1, len(votes) + 1))
votes["Year"] = 2025
votes["PreviouslyElected"] = False
new25 = votes[template]

# -------------------------------------------------------------------
# 6) Merge with existing direct_candidacy
# -------------------------------------------------------------------
print("🔁 Updating direct_candidacy.csv …")
direct_no25 = direct[direct["Year"] != 2025].copy()
updated = pd.concat([direct_no25, new25], ignore_index=True)

updated.to_csv(OUT_FILE, sep=";", index=False, encoding="utf-8-sig")

# -------------------------------------------------------------------
# 7) Consistency check
# -------------------------------------------------------------------
total_votes = updated.loc[updated["Year"] == 2025, "Erststimmen"].sum()
rowcount     = (updated["Year"] == 2025).sum()

print(f"\n💾 Saved → {OUT_FILE.name}")
print(f"✅ 2025 total Erststimmen : {int(total_votes):,}")
print(f"✅ 2025 candidate rows    : {rowcount:,}")
print("Expected total ≈ 49,505,389 and rows = cpv VoteType 1 count.")
print("🎉 Step 3 complete.")
# -------------------------------------------------------------------

if __name__ == "__main__":
    main = None  # placeholder to avoid accidental rerun in import