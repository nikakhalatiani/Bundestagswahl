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

The database schema has been configured to match the CSV files in `data/`. The schema includes tables for states, parties, elections, constituencies, persons, party lists, direct candidacy, party list candidacy, constituency elections, constituency party votes, first votes, and second votes.

### Setting Up the Database and Loading Data

To set up the database from scratch and load all election data, run the following commands in sequence:

```bash
cd backend

# 1. Reset the database (drops all tables and data)
npx ts-node src/resetDB.ts

# 2. Generate Drizzle migration files based on the schema
npx drizzle-kit generate

# 3. Push the schema to the database (creates tables)
npx drizzle-kit push

# 4. Load all CSV data from data/ into the database
npx ts-node src/loadCsvData.ts

# 5. Show database statistics and sample data
npx ts-node src/showDB.ts

# 6. Generate ballot data (first and second votes)
npx ts-node src/generateBallots.ts

# 7. Verify that generated ballots match the original aggregated data
npx ts-node src/verifyBallots.ts
```

### What Each Command Does

- `npx ts-node src/resetDB.ts`: Drops all existing tables in the database to start fresh.
- `npx drizzle-kit generate`: Generates migration files from the TypeScript schema in `src/db/schema.ts`.
- `npx drizzle-kit push`: Applies the schema to the PostgreSQL database, creating all necessary tables and constraints.
- `npx ts-node src/loadCsvData.ts`: Imports data from CSV files in the `data/` directory into the database tables.
- `npx ts-node src/showDB.ts`: Displays statistics about the loaded data, including row counts and sample entries.
- `npx ts-node src/generateBallots.ts`: Generates individual ballot records (first and second votes) based on the loaded election data.
- `npx ts-node src/verifyBallots.ts`: Verifies that the generated ballots accurately reflect the original vote counts and distributions.

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
- **Constituency Party Votes**: Vote counts by party and type per constituency
- **First Votes**: Generated individual first vote ballots
- **Second Votes**: Generated individual second vote ballots

Next steps / optional
- Add authentication, migrations as part of CI, or a PgAdmin service in docker-compose.

