import pandas as pd
from pathlib import Path

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
DATA_DIR = Path("data")
PARTY_MAP_FILE = DATA_DIR / "old2.0/party_id_mapping.csv"
CPV_FILE = DATA_DIR / "constituency_party_votes.csv"
OUT_FILE = DATA_DIR / "constituency_party_votes_partyid_fixed_strict.csv"
# -------------------------------------------------------------------


def load_csv(path):
    df = pd.read_csv(path, sep=";", encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]
    return df


def is_number(x):
    """Return True for numeric strings or ints/floats."""
    try:
        float(x)
        return True
    except (TypeError, ValueError):
        return False


def build_name_index(mapping: pd.DataFrame):
    """Return a lookup where each unique name points to all PartyIDs that use it."""
    name_to_ids = {}
    for _, r in mapping.iterrows():
        for name in (r["ShortName"], r["LongName"]):
            if pd.isna(name) or str(name).strip() == "":
                continue
            key = str(name).strip().lower()
            name_to_ids.setdefault(key, set()).add(int(r["PartyID"]))
    return name_to_ids


def try_match(val, name_to_ids):
    """Match by normalized string, disallow duplicates, support EB: fallback."""
    if pd.isna(val) or str(val).strip() == "":
        return None

    text = str(val).strip()
    key = text.lower()

    ids = name_to_ids.get(key)
    if ids:
        if len(ids) == 1:
            return list(ids)[0]
        print(f"Ambiguous mapping for '{val}' → {sorted(ids)} (skipped)")
        return None

    # Fallback for EB: with space
    if text.startswith("EB: "):
        text_fixed = "EB:" + text[4:]
        ids = name_to_ids.get(text_fixed.lower())
        if ids:
            if len(ids) == 1:
                return list(ids)[0]
            print(f"Ambiguous mapping for '{val}' via EB-fix → {sorted(ids)} (skipped)")
            return None

    # No match at all
    return None


def main():
    print("Loading files ...")
    cpv = load_csv(CPV_FILE)
    mapping = load_csv(PARTY_MAP_FILE)

    mapping["PartyID"] = pd.to_numeric(mapping["PartyID"], errors="coerce")
    name_index = build_name_index(mapping)

    mask_non_num = ~cpv["PartyID"].apply(is_number)
    non_num_rows = cpv.loc[mask_non_num].copy()

    print(f"Found {len(non_num_rows)} non‑numeric PartyID entries to verify.")

    changes = []
    for i, r in non_num_rows.iterrows():
        old_val = r["PartyID"]
        new_id = try_match(old_val, name_index)
        if new_id is not None:
            cpv.at[i, "PartyID"] = new_id
            changes.append((old_val, new_id))

    cpv.to_csv(OUT_FILE, sep=";", index=False, encoding="utf-8-sig")
    print(f"Saved → {OUT_FILE}")

    if changes:
        print("\nUpdated PartyIDs:")
        for old, new in changes:
            print(f"  {old} → {new}")
    else:
        print("\nNo automatic updates performed (ambiguous or unmatched names were skipped).")

if __name__ == "__main__":
    main()