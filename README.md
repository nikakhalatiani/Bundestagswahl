# Bundestagswahl

## Data

- `kand2025.csv`: Kandidaten, Wahlkreise ("VerknGebietsname"), Partei, Listenplatz
    - Unterscheidung in Wahlkreis und Land (Aufstellung für Erst- und Zweitstimme)
- `kerg2025.csv`: Scheint keine Einzelkandidaten zu haben
- `kerg2025_2.csv`: Kandidaten/Parteien ("Gruppenname"), Stimmenanzahl ("Anzahl")
    - Unterscheidung in Erst- und Zweitstimmen

## Code

This repository contains a small example scaffold: a TypeScript + React frontend and a TypeScript Node backend using Drizzle ORM + PostgreSQL.

Goals:
- Repeatable onboarding using Docker Compose for the database and backend.
- Simple frontend (Vite + React + TypeScript) that talks to the backend API.

Structure
- `frontend/` — Vite + React + TypeScript app
- `backend/` — Express + TypeScript backend with Drizzle ORM
- `docker-compose.yml` — starts Postgres and the backend for local development

Quick start (Windows PowerShell)
1. Install Node.js (LTS) and Docker Desktop.
2. From the repo root run:

```powershell
# Start Postgres and backend (backend runs in dev mode via docker-compose)
docker-compose up -d --build

# Open a new terminal and install deps for frontend and backend
cd frontend; npm install; cd ..
cd backend; npm install; cd ..

# Generate Drizzle artifacts and run migrations (backend needs drizzle-kit installed)
cd backend
npm run drizzle:generate
npm run drizzle:migrate
cd ..

# Start the frontend dev server
cd frontend; npm run dev
```

3. Open the frontend in your browser at http://localhost:5173. It will proxy API calls to the backend at http://localhost:4000.

Notes
- The backend exposes basic endpoints at `/api/items` and `/api/health`.
- Edit `backend/.env.example` and copy it to `backend/.env` if you need to change the database URL.
- The project uses Drizzle ORM for schema management and type-safe DB access. Drizzle schema/migrations live in `backend/drizzle` (or use `drizzle-kit` commands to generate/migrate).

## Database Setup & CSV Data Loading

The database schema has been configured to match the CSV files in `Bundestagswahl/outputs/`. The schema includes:
- **States** (German federal states)
- **Parties** (Political parties with IDs and names)
- **Constituencies** (electoral districts/Wahlkreise)
- **Candidates** (candidates with personal info, party affiliation, and vote counts)
- **StateParties** (Second vote results by state and party)

### Loading CSV Data into Database

After setting up the database with migrations, load the CSV data:

```powershell
cd backend

# Load all CSV data from Bundestagswahl/outputs/ into the database
npm run load-csv

# Verify the loaded data (shows statistics and samples)
npm run verify
```

The `load-csv` script will:
1. Load all 16 states from `states.csv`
2. Load 86 unique parties from `parties.csv` (handles duplicates)
3. Load 299 constituencies from `wahlkreis.csv`
4. Load 4,506 candidates from `candidates.csv`
5. Load 227 state party results from `state_parties.csv`

The `verify` script displays database statistics and sample data, including top parties by second votes.

### Database Schema Overview

The simplified schema (Drizzle migration/schema files) should map to the CSV structure:
- `State`: Uses state abbreviation (e.g., "BB", "NW") as primary key
- `Party`: Indexed by PartyID with unique shortName (e.g., "SPD", "CDU")
- `Constituency`: Uses constituency number as primary key
- `Candidate`: Contains all candidate information including votes, list positions, and party affiliations
- `StateParty`: Links states and parties with Zweitstimmen (second votes)

Next steps / optional
- Add authentication, migrations as part of CI, or a PgAdmin service in docker-compose.

