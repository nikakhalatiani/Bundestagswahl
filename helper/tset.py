import pandas as pd
from pathlib import Path

DATA = Path("data")
OUTPUT = Path("Bundestagswahl/outputs")
OUTPUT.mkdir(parents=True, exist_ok=True)

# Input files
CPV = DATA / "constituency_party_votes.csv"
MISMATCH_21 = DATA / "firstvote_mismatches_2021.csv"
MISMATCH_25 = DATA / "firstvote_mismatches_2025.csv"

# Output
OUT_FILE = OUTPUT / "constituency_party_votes_with_residuals.csv"

# ---------------------------------------------------------------
# Load data
# ---------------------------------------------------------------
cpv = pd.read_csv(CPV, sep=";", encoding="utf-8-sig")

mismatches = []
for f, yr in [(MISMATCH_21, 2021), (MISMATCH_25, 2025)]:
    if f.exists():
        df = pd.read_csv(f, sep=";", encoding="utf-8-sig")
        df["Year"] = yr
        mismatches.append(df)
if not mismatches:
    print("❌ No mismatch files found.")
    raise SystemExit

mismatch = pd.concat(mismatches, ignore_index=True)

# Sometimes BridgeID is missing or misnamed — attempt fallback
bridge_col = None
for cand in ["BridgeID", "bridge_id", "ConstituencyID"]:
    if cand in mismatch.columns:
        bridge_col = cand
        break
if not bridge_col:
    raise ValueError("Could not find a BridgeID/ConstituencyID column in mismatch files.")

# ---------------------------------------------------------------
# Build rows for missing votes
# ---------------------------------------------------------------
new_rows = []
for _, row in mismatch.iterrows():
    diff = row.get("FirstDiff", 0)
    if pd.isna(diff) or diff >= 0:
        continue  # we only handle negative differences (missing votes)

    new_rows.append(
        {
            "BridgeID": row[bridge_col],
            "VoteType": 1,
            "Votes": abs(diff),
            "PartyID": None,
            "PartyName": "Residual",  # synthetic filler entry
        }
    )

if not new_rows:
    print("✅ No negative FirstVote residuals found — nothing to add.")
    raise SystemExit

# ---------------------------------------------------------------
# Merge with existing CPV schema
# ---------------------------------------------------------------
new_df = pd.DataFrame(new_rows)

# Ensure all required columns exist
for col in cpv.columns:
    if col not in new_df.columns:
        new_df[col] = None

# Align order
new_df = new_df[cpv.columns]

# Append & export
cpv_with_residuals = pd.concat([cpv, new_df], ignore_index=True)
cpv_with_residuals.to_csv(OUT_FILE, sep=";", encoding="utf-8-sig", index=False)

print(f"💾 Added {len(new_rows)} residual entries.")
print(f"📁 Output: {OUT_FILE}")