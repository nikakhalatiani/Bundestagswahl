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
- When using Docker Compose, run data scripts via `docker-compose exec backend ...` so they target the same DB the backend uses.
- The Docker backend expects CSVs under `/data`; `docker-compose.yml` mounts the repo `data/` directory there.

## Database Setup & CSV Data Loading

The database schema matches the CSV files in `data/`. Base tables store source data and single votes. Aggregate results are computed via materialized views and must be refreshed after loading/generating votes.

### Setting Up the Database and Loading Data

#### Option A: Docker workflow (recommended)
Run these commands from the repo root (so `docker-compose.yml` is found):

```bash
# Optional: wipe the DB volume for a clean start
docker-compose down -v

# Start DB + backend
docker-compose up -d --build

# Apply migrations (creates tables + materialized views)
docker-compose exec backend npm run drizzle:migrate

# Load CSVs
docker-compose exec backend npm run load-csv

# Generate single ballots from CSV aggregates
docker-compose exec backend npm run generate-ballots

# Refresh materialized views and seat caches
curl -X POST "http://localhost:4000/api/admin/calculate-seats?year=2025"
```

#### Option B: Local workflow (advanced)
Use this only if your backend is not running in Docker. Make sure `backend/.env` points to your local Postgres.

```bash
cd backend

# Optional: reset DB (drops all tables)
npx ts-node src/resetDB.ts

# Generate and apply migrations
npx drizzle-kit generate
npx drizzle-kit migrate

# Load CSVs + generate ballots
npx ts-node src/loadCsvData.ts
npx ts-node src/generateBallots.ts

# Refresh materialized views and seat caches
curl -X POST "http://localhost:4000/api/admin/calculate-seats?year=2025"
```

### What Each Command Does (data pipeline)

- `drizzle-kit migrate`: Creates/updates tables and materialized views.
- `loadCsvData.ts`: Imports base data from `data/`.
- `generateBallots.ts`: Generates individual `first_votes` and `second_votes` from CSV aggregates.
- `calculate-seats` endpoint: Refreshes materialized views used by API and seat allocation.

### Verification Options

The `verifyBallots.ts` script supports command-line options for flexible verification:

- Verify all constituencies for 2025 (default):
  ```bash
  npx ts-node src/verifyBallots.ts --year=2025
  ```

- Verify just constituency 9 for 2025:
  ```bash
  npx ts-node src/verifyBallots.ts --year=2025 --constituency=9
  ```

- Print top 10 candidates/parties instead of the default 5:
  ```bash
  npx ts-node src/verifyBallots.ts --year=2025 --top=10
  ```

These options can be combined as needed.
### Database Schema Overview

The schema supports multi-year election data with proper foreign key relationships:
- **States**: German federal states
- **Parties**: Political parties
- **Elections**: Election years and dates
- **Constituencies**: Electoral districts
- **Persons**: Candidate personal information
- **Party Lists**: State-level party lists for second votes
- **Direct Candidacy**: Direct candidates per constituency
- **Party List Candidacy**: Candidates on party lists
- **Constituency Elections**: Election statistics per constituency
- **First Votes**: Generated individual first vote ballots
- **Second Votes**: Generated individual second vote ballots
- **Materialized Views**: Base vote counters (`mv_direct_candidacy_votes`, `mv_party_list_votes`, `mv_constituency_first_votes`, `mv_constituency_second_votes`, `mv_constituency_invalid_votes`, `mv_constituency_vote_totals`) and the seat cache (`seat_allocation_cache`)

## Running Seat Allocation Algorithm

After loading the data, you can run the seat allocation algorithm that implements the German electoral system with the 2023 reform.
Make sure materialized views are refreshed first via:

```bash
curl -X POST "http://localhost:4000/api/admin/calculate-seats?year=2025"
```

### Option 1: Full Results (Recommended)

```bash
cd backend
npx ts-node src/runCalculateSeats.ts [year]
```

**Example**:
```bash
npx ts-node src/runCalculateSeats.ts 2025
```

**Output includes**:
- Party Summary (votes, percentages, qualification status)
- Federal Distribution (Oberverteilung) - Sainte-Laguë allocation
- State Distribution (Unterverteilung) - per party, per state
- Total seats allocated (should be 630)

### Option 2: Seat Counts Per Party

```bash
npx ts-node src/countSeatsPerParty.ts [year]
```

**Output**: Table showing each party's:
- Direct mandates (from constituencies)
- List seats (from party lists)
- Total seats

### Option 3: Debug Mode

For detailed diagnostics and troubleshooting:

```bash
npx ts-node src/debugSeats.ts [year] [mode] [party]
```

**Available modes**:
- `all` - Run all diagnostic checks (default)
- `basic` - Party votes, qualification, and constituency winners
- `ober` - Federal distribution (Oberverteilung)
- `unter` - State distribution (Unterverteilung)
- `seats` - List seat allocation details
- `party` - Analyze specific party (requires party name)

**Examples**:
```bash
# Run all checks for 2025
npx ts-node src/debugSeats.ts

# Debug specific party
npx ts-node src/debugSeats.ts 2025 party SPD
npx ts-node src/debugSeats.ts 2025 party GRÜNE

# Check federal distribution only
npx ts-node src/debugSeats.ts 2025 ober

# Check state distribution only
npx ts-node src/debugSeats.ts 2025 unter
```

### Option 4: Run Validation Tests

Validate the algorithm's correctness with comprehensive tests:

```bash
npx ts-node src/testSeatAllocation.ts [year]
```

**Tests include**:
1. ✓ Total seats equals 630
2. ✓ No duplicate person assignments
3. ✓ Only qualified parties have seats (5% threshold, 3 mandates, or minority)
4. ✓ Oberverteilung matches total seats
5. ✓ Unterverteilung matches Oberverteilung
6. ✓ Seat type breakdown is correct (direct + list = total)
7. ✓ Direct mandate winners excluded from list seats
8. ✓ Zweitstimmendeckung compliance (2023 reform)
9. ✓ Summary data consistency

**Exit code**: 0 if all tests pass, 1 if any fail

## Algorithm Overview

The seat allocation implements the German electoral system with the 2023 reform:

1. **Constituency Winners**: 299 constituencies each elect one representative by first votes (Erststimmen)
2. **Party Qualification**: Parties must meet 5% threshold OR 3 direct mandates OR be a minority party
3. **Oberverteilung**: 630 total seats distributed among qualified parties using Sainte-Laguë method based on second votes
4. **Unterverteilung**: Each party's federal seats distributed to states using Sainte-Laguë method
5. **Zweitstimmendeckung** (2023 Reform): Direct mandates limited by Unterverteilung per state to prevent overhang mandates
6. **List Seats**: Remaining seats filled from party lists, excluding direct mandate winners
