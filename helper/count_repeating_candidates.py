import pandas as pd

def load_and_process(file_path):
    """
    Loads the CSV and creates a unique signature for each candidate.
    """
    # Read CSV with semicolon delimiter. 
    # encoding='utf-8' is standard, but excel sometimes saves as 'latin-1' or 'cp1252' in Germany.
    try:
        df = pd.read_csv(file_path, sep=';', encoding='utf-8', dtype=str)
    except UnicodeDecodeError:
        df = pd.read_csv(file_path, sep=';', encoding='latin-1', dtype=str)

    # Normalize column names to handle slight differences (strip spaces)
    df.columns = df.columns.str.strip()
    
    # Ensure the required columns exist
    required_cols = ['Nachname', 'Vornamen', 'Geburtsjahr', 'Geschlecht']
    for col in required_cols:
        if col not in df.columns:
            raise ValueError(f"Missing required column '{col}' in file: {file_path}")

    # Create a unique ID for every row
    # Structure: lastname_firstname_year_gender
    # We strip whitespace and convert to lowercase to ensure 'Müller' matches 'müller '
    
    df['unique_id'] = (
        df['Nachname'].str.strip().str.lower() + "_" +
        df['Vornamen'].str.strip().str.lower() + "_" +
        df['Geburtsjahr'].str.strip() + "_" +
        df['Geschlecht'].str.strip().str.lower()
    )
    
    return df

def main():
    file1_path = 'data/rawData/kand2021.csv'
    file2_path = 'data/rawData/kand2025.csv'

    try:
        print("Loading files...")
        df1 = load_and_process(file1_path)
        df2 = load_and_process(file2_path)

        # Get the sets of unique IDs
        ids_1 = set(df1['unique_id'])
        ids_2 = set(df2['unique_id'])

        # Find the intersection (IDs present in both)
        common_ids = ids_1.intersection(ids_2)
        
        count = len(common_ids)

        print("-" * 30)
        print(f"Total candidates in File 1: {len(ids_1)}")
        print(f"Total candidates in File 2: {len(ids_2)}")
        print("-" * 30)
        print(f"MATCHING PEOPLE FOUND: {count}")
        print("-" * 30)

        if count > 0:
            print("First 5 matches:")
            # Filter the first dataframe to show details of matched people
            matches = df1[df1['unique_id'].isin(common_ids)].head(5)
            for index, row in matches.iterrows():
                print(f" - {row['Nachname']}, {row['Vornamen']} ({row['Geburtsjahr']})")
                
            # Optional: Save matches to a new CSV
            # df1[df1['unique_id'].isin(common_ids)].to_csv('common_candidates.csv', sep=';', index=False)
            # print("\nFull list saved to 'common_candidates.csv'")

    except FileNotFoundError as e:
        print(f"Error: Could not find file. {e}")
    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    main()