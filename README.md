# BizLedger

**A practical business management platform for inventory, purchasing, sales and finance.**

BizLedger is a full-stack application for managing the day-to-day flow of a small business: maintain a product catalogue, manage suppliers and buyers, process purchase and sales orders, track stock movements, issue invoices, record payments, and review business performance.

> Portfolio note: screenshots below are intentionally placeholders. Replace them with captures from a running BizLedger instance before publishing a portfolio version.

## Contents

- [Features](#features)
- [Technology and architecture](#technology-and-architecture)
- [Screenshots](#screenshots)
- [Database overview](#database-overview)
- [Local setup on Windows](#local-setup-on-windows)
- [Environment variables](#environment-variables)
- [Migrations and admin seed](#migrations-and-admin-seed)
- [Run the application](#run-the-application)
- [Tests and quality checks](#tests-and-quality-checks)
- [API documentation](#api-documentation)
- [Project structure](#project-structure)
- [Future improvements](#future-improvements)

## Features

### Dashboard, analytics and reports

- Dashboard overview with current inventory indicators, low-stock alerts, recent business activity and trends.
- Analytics across sales, purchases, collections, supplier payments and inventory movements.
- Filterable reports for orders, inventory, partners, receivables, payables and payments.
- CSV export for reports.

### Products and inventory

- Product catalogue with categories, SKU, unit, specifications, purchase and selling prices, tax rate and stock thresholds.
- Search, category and low-stock filtering, and paginated listings.
- Stock adjustments with reasons and an inventory transaction history.
- Stock changes from purchase receipts, sales fulfillment, returns and manual adjustments are recorded in the inventory ledger.
- Product and category archiving preserves historical records.

### Suppliers and buyers

- Supplier and buyer profiles with contact, address, tax registration and payment details.
- Search, status filtering, pagination and transaction history views.
- Soft archiving retains partners referenced by historical orders.

### Purchasing and sales

- Purchase orders with status changes, line items, partial or complete goods receipts and purchase invoices.
- Sales orders with status changes, fulfillment, returns and sales invoices.
- Order lines retain product and price snapshots; server-side calculations use decimal arithmetic.
- Receipt, fulfillment and return operations update inventory and create ledger entries.

### Invoices and payments

- Purchase and sales invoice records linked to their source orders.
- Invoice PDFs, invoice metadata, payment history and outstanding balances.
- Partial and full payments with payment methods and transaction references.
- Financial summaries for accounts payable and receivable.

### Accounts and access

- JWT-based authentication using an HTTP-only session cookie (and bearer token support in the API middleware).
- ADMIN, MANAGER and STAFF roles with permission checks on protected routes.
- Admin tools for creating staff accounts and activating or deactivating them.
- Audit logging for important changes.

## Technology and architecture

| Layer | Technology |
| --- | --- |
| Web client | React, Vite, Tailwind CSS |
| API | Node.js, Express |
| Data access | Prisma ORM 7 with the MariaDB adapter |
| Database | MySQL-compatible database; the project targets MySQL 8 |
| Validation | Zod |
| Authentication | JWT, HTTP-only cookies and bcryptjs password hashing |
| Monetary arithmetic | Decimal.js |

The frontend communicates with the Express JSON API under `/api`. During local Vite development, `/api` requests are proxied to `http://localhost:5000` by default. The backend loads its `.env` relative to the backend folder, so server and Prisma commands can be run from the repository root or the `backend` folder.

## Screenshots

Add screenshots from your own running environment. No screenshots are included in this repository yet.

| Dashboard | Products and inventory |
| --- | --- |
| `![Dashboard screenshot](docs/screenshots/dashboard.png)` | `![Products screenshot](docs/screenshots/products.png)` |

| Purchase and sales orders | Invoice and payments |
| --- | --- |
| `![Orders screenshot](docs/screenshots/orders.png)` | `![Finance screenshot](docs/screenshots/finance.png)` |

The image references above are placeholders. Add the corresponding image files under `docs/screenshots/` or replace the references with the locations you choose.

## Database overview

The Prisma schema is in [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma), and additive SQL migrations are in [`backend/prisma/migrations/`](backend/prisma/migrations/).

Core entities include:

- **Users and audit logs** for authentication, roles and activity history.
- **Categories and products** for the catalogue and current stock levels.
- **Inventory transactions** for stock receipts, fulfillment, returns and adjustments.
- **Suppliers and buyers** linked to their purchase and sales orders.
- **Purchase and sales orders** with snapshotted order items, receipt/fulfillment records and returns.
- **Invoices, invoice items and payments** for issued amounts, payment history and balances.

Money and quantities use MySQL decimal columns. The database schema stores relationships and historical snapshots so edits to current partner or product details do not replace the saved details on existing invoices or orders.

## Local setup on Windows

### Prerequisites

- Git
- Node.js and npm compatible with the versions required by the installed Vite and Prisma packages
- MySQL 8 (or a compatible MariaDB server) running locally

### 1. Get dependencies

From the repository root in PowerShell:

```powershell
Set-Location .\backend
npm ci
Set-Location ..\frontend
npm ci
Set-Location ..
```

### 2. Configure the backend

```powershell
Copy-Item .\backend\.env.example .\backend\.env
```

Edit `backend\.env` with your local database connection and a unique JWT secret. Configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` and `DB_NAME` for the runtime database adapter, and set `DATABASE_URL` for Prisma CLI operations. The database named in the connection settings must already exist.

### 3. Generate Prisma Client, validate and apply migrations

Run the commands in [Migrations and admin seed](#migrations-and-admin-seed) before starting the application.

### 4. Start the backend and frontend

Open two PowerShell terminals at the repository root and follow [Run the application](#run-the-application). The Vite development server uses port `5173`; the API defaults to port `5000`.

## Environment variables

The checked-in template is [`backend/.env.example`](backend/.env.example). Copy it to `backend/.env` and replace placeholders locally. Never commit `.env` or real credentials.

| Variable | Purpose | Example placeholder |
| --- | --- | --- |
| `PORT` | Express listening port | `5000` |
| `NODE_ENV` | Runtime mode; controls secure cookie behavior | `development` |
| `FRONTEND_ORIGIN` | Allowed browser origin for credentialed CORS | `http://localhost:5173` |
| `DATABASE_URL` | Prisma CLI connection string | `mysql://<user>:<password>@<host>:<port>/<database>` |
| `DB_HOST` | Runtime adapter database host | `<mysql-host>` |
| `DB_PORT` | Runtime adapter database port | `3306` |
| `DB_USER` | Runtime adapter database user | `<database-user>` |
| `DB_PASSWORD` | Runtime adapter database password | `<database-password>` |
| `DB_NAME` | Runtime adapter database name | `<database-name>` |
| `JWT_SECRET` | Secret used to sign and verify session tokens | `<long-random-secret>` |
| `ADMIN_EMAIL` | Email for the admin seed account | `<admin-email>` |
| `ADMIN_PASSWORD` | Seed account password (at least 12 characters) | `<unique-local-password>` |
| `ADMIN_NAME` | Optional seed account display name | `<admin-name>` |

`ADMIN_NAME` defaults to `BizLedger Admin` in the seed script. Admin seed settings are required only when running the seed command.

The frontend optionally reads `VITE_API_URL`. For local development it can be omitted: Vite proxies `/api` to `http://localhost:5000`. If you use a different backend address, configure `VITE_API_URL` in the frontend environment before starting Vite.

## Migrations and admin seed

The following commands match the scripts in `backend/package.json`. Run them from the backend directory:

```powershell
Set-Location .\backend
npm run db:generate
npm run db:validate
npm run db:migrate
```

`db:migrate` runs `prisma migrate deploy` and applies the checked-in migrations; it does not reset the database. Once the database is configured, set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters in `backend\.env`, then run:

```powershell
npm run seed
```

The seed uses an upsert: it creates the configured admin account if that email does not exist. If the email already exists, the seed preserves the existing account details, including its password and role. It is not a password reset command. For a fresh local admin login, use an email not already present in that database, then sign in with the values configured for the seed.

## Run the application

Start the API in one PowerShell terminal:

```powershell
Set-Location .\backend
npm run dev
```

Start the frontend in another terminal:

```powershell
Set-Location .\frontend
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). The backend provides `GET http://localhost:5000/api/health` for a database connectivity check.

Production build and preview commands, defined in `frontend/package.json`:

```powershell
Set-Location .\frontend
npm run build
npm run preview
```

## Docker deployment

### Prerequisites

- Docker Desktop for Windows with the Docker Compose plugin enabled.
- A free local port for the web app (`8080` by default) and MySQL (`3307` by default).

The Compose stack builds the React/Vite production bundle and serves it through unprivileged Nginx. Nginx proxies `/api` to Express over the Compose network. The backend uses the MySQL service hostname `mysql`, waits for its health check, and has its own API/database health check. MySQL data is stored in the named `mysql_data` volume.

### Configure and start

Run these commands from the repository root in PowerShell:

```powershell
Copy-Item .\.env.example .\.env
```

Edit the root `.env`. Replace the database and JWT placeholders with unique values. Keep `DATABASE_URL` synchronized with `MYSQL_DATABASE`, `MYSQL_USER` and `MYSQL_PASSWORD`; its host must remain `mysql` for container-to-container database access. Use URL-safe characters in `MYSQL_PASSWORD` unless you URL-encode them in `DATABASE_URL`.

Apply the existing Prisma migrations, then build and start the stack:

```powershell
docker compose run --rm migrate
docker compose up --build -d
docker compose ps
```

Open `http://localhost:8080` (or the port set in `FRONTEND_PORT`). Check API and database health at `http://localhost:8080/api/health`; check frontend container health with `docker compose ps`.

The local Compose default is `NODE_ENV=development` so the HTTP-only session cookie works over local HTTP. For a public deployment, set `NODE_ENV=production` and put the stack behind HTTPS/TLS termination; production cookies are marked secure. Configure `FRONTEND_ORIGIN` to the exact browser origin used to access the app.

### Admin seed

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the root `.env` (the seed requires at least 12 password characters). With the stack running, execute:

```powershell
docker compose exec backend node prisma/seed.js
```

The seed creates an admin if the email is new and preserves account details if it already exists; it does not reset passwords. Use a fresh email for a new local admin account.

### Stop and troubleshoot

Stop containers while preserving the MySQL data volume:

```powershell
docker compose down
```

View service status and logs:

```powershell
docker compose ps
docker compose logs -f mysql
docker compose logs -f backend
docker compose logs -f frontend
```

If a host port is occupied, change `FRONTEND_PORT` or `MYSQL_PORT` in `.env`. If the backend cannot connect to MySQL, confirm its `DB_HOST` is the Compose service name `mysql` (the Compose file sets this), verify the `.env` database credentials and `DATABASE_URL`, then inspect MySQL health and logs. If migrations are pending, rerun `docker compose run --rm migrate`; it runs the repository's existing `npm run db:migrate` (`prisma migrate deploy`) and does not reset the database. A failed frontend build should be diagnosed from `docker compose build frontend` output.

The Dockerfiles use the existing package lockfiles and scripts. The backend image generates the Prisma 7 client during image build and keeps the Prisma CLI in a separate migration target; the API runtime image contains production dependencies only.

## Tests and quality checks

Backend tests use Node's built-in test runner and are defined by `npm test`:

```powershell
Set-Location .\backend
npm test
```

The backend suite covers authentication and authorization, products and inventory, partners, purchase and sales orders, invoices and payments, users, analytics and reports.

The frontend has a focused invoice PDF client regression test and lint/build scripts:

```powershell
Set-Location .\frontend
node --test test/invoicePdfClient.test.js
npm run lint
npm run build
```

## API documentation

See [`docs/API.md`](docs/API.md) for dashboard, analytics, report filters, response shapes, calculation conventions and errors. The Express route groups are mounted under `/api`; the principal groups are:

| Prefix | Resource |
| --- | --- |
| `/api/auth` | Login, current session and logout |
| `/api/users` | Admin-managed staff accounts |
| `/api/categories`, `/api/products` | Product catalogue and stock operations |
| `/api/suppliers`, `/api/buyers` | Business partners |
| `/api/purchases`, `/api/sales` | Orders, receipts, fulfillment, returns and invoice creation |
| `/api/invoices`, `/api/payments` | Invoice records, PDF output and payments |
| `/api/dashboard`, `/api/analytics`, `/api/reports` | Business insights and report exports |

Protected endpoints require a valid BizLedger session. Role permissions are enforced by the API.

## Project structure

```text
bizledger/
├── backend/
│   ├── prisma/              # Prisma schema, migrations and admin seed
│   ├── src/
│   │   ├── config/          # Environment and Prisma setup
│   │   ├── controllers/     # HTTP request handlers
│   │   ├── middleware/      # Authentication, validation, logging and errors
│   │   ├── routes/          # Express API route groups
│   │   ├── schemas/         # Zod request schemas
│   │   ├── services/        # Business operations
│   │   └── utils/           # Password, units and invoice PDF helpers
│   └── test/                # Backend unit/service tests
├── docs/
│   └── API.md               # API and reporting documentation
└── frontend/
    ├── src/
    │   ├── finance/         # Invoices and payments
    │   ├── insights/        # Dashboard, analytics and reports
    │   ├── partners/        # Suppliers and buyers
    │   ├── products/        # Products and inventory
    │   ├── purchases/       # Purchase orders
    │   ├── sales/           # Sales orders
    │   └── users/           # User management
    └── test/                # Frontend regression tests
```

## Future improvements

These are potential next steps, not features represented as currently implemented:

- Add screenshots captured from a seeded local demo environment.
- Add browser-level end-to-end tests for the principal workflows.
- Add a deployment guide and production operations documentation for a chosen hosting environment.
