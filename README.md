# Bundestagswahl

This repository contains a small example scaffold: a TypeScript + React frontend and a TypeScript Node backend using Prisma + PostgreSQL.

Goals:
- Repeatable onboarding using Docker Compose for the database and backend.
- Simple frontend (Vite + React + TypeScript) that talks to the backend API.

Structure
- `frontend/` — Vite + React + TypeScript app
- `backend/` — Express + TypeScript backend with Prisma
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

# Generate Prisma client and run migrations (backend needs prisma installed)
cd backend
npm run prisma:generate
npm run prisma:migrate
cd ..

# Start the frontend dev server
cd frontend; npm run dev
```

3. Open the frontend in your browser at http://localhost:5173. It will proxy API calls to the backend at http://localhost:4000.

Notes
- The backend exposes basic endpoints at `/api/items` and `/api/health`.
- Edit `backend/.env.example` and copy it to `backend/.env` if you need to change the database URL.
- The project uses Prisma for schema management and type-safe DB access. The Prisma schema is in `backend/prisma/schema.prisma`.

Next steps / optional
- Add authentication, migrations as part of CI, or a PgAdmin service in docker-compose.

