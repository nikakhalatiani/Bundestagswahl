import csv
import os

def clean_decimal(value):
    """
    Converts German decimal comma to dot format.
    Example: "9,8" -> "9.8"
    """
    if not value:
        return ""
    return value.replace(",", ".")

def main():
    # Calculate paths relative to this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    
    input_file = os.path.join(project_root, "data", "rawData", "btw2025_strukturdaten.csv")
    output_file = os.path.join(project_root, "data", "strukturdaten.csv")

    print(f"Reading from: {input_file}")

    if not os.path.exists(input_file):
        print(f"Error: File not found at {input_file}")
        return

    with open(input_file, mode='r', encoding='utf-8-sig', newline='') as f_in, \
         open(output_file, mode='w', encoding='utf-8', newline='') as f_out:
        
        # The input file uses semicolons
        reader = csv.DictReader(f_in, delimiter=';')
        
        # Identify the exact column names from headers
        headers = reader.fieldnames
        
        # Helper to find column by substring to be robust vs year changes
        def get_col_name(keywords):
            for h in headers:
                if all(k in h for k in keywords):
                    return h
            return None

        col_id = "Wahlkreis-Nr."
        # Use unique substrings to find the columns
        col_foreigners = get_col_name(["Bevölkerung", "Ausländer", "%"])
        col_income = get_col_name(["Verfügbares Einkommen", "EUR"])

        if not col_foreigners or not col_income:
            print("Error: Could not find required columns.")
            print(f"Searching in headers: {headers}")
            return

        print(f"Found columns:\n - Foreigners: '{col_foreigners}'\n - Income: '{col_income}'")

        # Prepare output
        fieldnames = ['ConstituencyID', 'ForeignerPct', 'DisposableIncome']
        writer = csv.DictWriter(f_out, fieldnames=fieldnames, delimiter=';')
        writer.writeheader()

        row_count = 0
        for row in reader:
            wk_val = row.get(col_id)
            
            # Simple validation: must be a number
            if not wk_val or not wk_val.isdigit():
                continue
            
            wk_id = int(wk_val)

            # Filter out State summaries (usually IDs > 299 or 900+)
            if wk_id > 299:
                continue

            writer.writerow({
                'ConstituencyID': wk_id,
                'ForeignerPct': clean_decimal(row[col_foreigners]),
                'DisposableIncome': clean_decimal(row[col_income])
            })
            row_count += 1

    print(f"✅ Transformation complete. Wrote {row_count} rows to {output_file}")

if __name__ == "__main__":
    main()
