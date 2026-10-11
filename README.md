# LoomOS — Textile Manufacturing Operating System

LoomOS is a simple factory management system for a textile mill. It covers the whole flow: buyer orders at fixed material prices → yarn stock → production (Spinning → Weaving → Dyeing) with machine and operator assignment → quality check and rework → dispatch and delivery → invoices, payments and claims.

---

## 🏗️ Architecture

The workspace is organized into a clean multi-package monorepo:

- **`backend/`**: Express API server with domain modules, session-based auth, and role permission guards.
- **`frontend/`**: High-performance React 19 + Vite web interface with guided operator consoles.
- **`packages/db/`**: Prisma ORM schema and PostgreSQL database client with multi-unit facility models.
- **`packages/shared/`**: Shared contracts, Zod schemas, 13 standard roles, and granular 5-action RBAC matrix.
- **`e2e/`**: Playwright browser tests of the main journeys per role.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js**: v20+
- **PostgreSQL**: Running on port `5439` (or configure in `.env`)
- **Docker** (optional): `docker-compose up -d` to launch PostgreSQL container

### 2. Setup & Database Seeding

```bash
# Install dependencies
npm install

# Start PostgreSQL, apply migrations, generate the Prisma client
docker compose up -d
npm run db:migrate
npm run db:generate

# Seed the demo factory (needs an empty database)
npm run db:seed
```

### 3. Run Development Servers

```bash
# Start both Backend (port 4000) and Frontend (port 5173) concurrently
npm run dev
```

- **Frontend Application**: `http://localhost:5173`
- **Backend API**: `http://localhost:4000`
- **Super Admin RBAC Panel**: `http://localhost:5173/settings`

---

## 🔐 Demo Credentials

All seeded accounts use password: `LoomDemo2026!`

| Role | Email | What they do |
| :--- | :--- | :--- |
| Super Admin | `owner@loomos.demo` | Users, roles, material prices, machines, everything |
| Operations Manager | `operations@loomos.demo` | Runs the office: places and accepts orders, watches the whole mill |
| Production Manager | `production@loomos.demo` | Plans batches, assigns machines and operators, moves stopped work, decides rework |
| Shift Supervisor | `supervisor@loomos.demo` | Checks workers in and out, overtime, shift handovers, reports breakdowns |
| Spinning / Weaving / Dyeing operator | `spinning@` / `weaving@` / `dyeing@loomos.demo` | Starts, records and finishes the jobs assigned to them |
| Maintenance Engineer | `maintenance@loomos.demo` | Adds and retires machines, takes them into maintenance, confirms repairs |
| Quality Inspector | `quality@loomos.demo` | Inspects rolls, sends failures back for rework |
| Dispatch Manager | `dispatch@loomos.demo` | Loads trucks, confirms dispatch, marks delivery |
| Accounts Manager | `accounts@loomos.demo` | Invoices, payments, expenses, claims |
| Inventory / Procurement | `inventory@` / `procurement@loomos.demo` | Yarn stock / purchase orders |
| Buyer | `buyer@loomos.demo`, `fabindia@loomos.demo` | Places orders, tracks deliveries |

New buyers sign up at `/buyer/signup`; staff use "Request an account" on the login page. An administrator approves every account.

## Where people start

- `/` is the public home page: the animated hero, the dashboard preview, how a day at the mill runs, demo roles, and the buyer section. Nothing on it needs a session.
- `/login` is sign-in for staff and buyers (the once-per-tab introduction plays here). A demo-role card on the home page opens it with that account filled in; nobody is signed in automatically.
- `/buyer/signup` creates a buyer account; `/signup` requests a staff account. Signing out returns to the home page.

## What the owner sees

- **Accounts** answers "did we make money this month?": sales against yarn bills, other bills, wages and expenses, a six-month chart, and cost per order.
- **Workers & shifts → Shift reports** shows what happened in every shift of any day: who worked, metres per stage and machine, breakdowns, inspections, wages and a timeline.
- **+ New** in the top bar adds anything your role allows: orders, batches, yarn receipts, purchase orders, bills, expenses, buyers, suppliers, machines, workers, shifts, fabrics and user logins.
- The demo data covers five months (24 finished orders, monthly yarn receipts and bills, daily attendance and wages, breakdowns, claims) plus today's live floor.

## Who may do what

Every API write names the one permission it needs; the role table lives in
`packages/shared/src/index.ts` (`ROLE_PERMISSIONS_TEMPLATE`) and is used by both the server and the
browser. Standard roles are fixed in code; custom roles made in Settings carry their own list.

| Action | Who |
| :--- | :--- |
| Place an order | Buyer (own), Operations Manager, Admin |
| Accept / decline / edit an order, plan production | Operations Manager, Production Manager |
| Create a stock or replacement batch, cancel a batch | Production Manager |
| Assign or move a machine and operator | Production Manager |
| Start, record output, pause, finish a job | The assigned operator (own stage only), Production Manager |
| Report a production problem | Operators, Production Manager, Quality Inspector |
| Resolve a problem, cancel rework | Production Manager |
| Send work back for rework | Production Manager, Quality Inspector |
| Shift handover (next operator takes a running machine) | Shift Supervisor, Production Manager |
| Check in / out, overtime, attendance corrections | Shift Supervisor |
| Report a machine breakdown | Operators, Shift Supervisor, Production Manager, Maintenance |
| Start maintenance, confirm a repair | Maintenance Engineer |
| Add, edit, deactivate machines | Maintenance Engineer, Admin |
| Receive, reserve, correct yarn stock | Inventory Manager |
| Purchase orders | Procurement Manager (Inventory Manager may raise one) |
| Inspect rolls, repair at the bay | Quality Inspector |
| Load trucks, confirm dispatch, mark delivered | Dispatch Manager |
| Bills, payments, wage runs, expenses, claims | Accounts Manager |
| Prices, fabrics, workers, shifts, users, roles | Admin |

Administrators can do everything. Everyone else sees only the pages their role needs.

## How work flows

1. **Order**: a buyer picks a material (fixed price), colour, quantity and a future delivery date. The office accepts it and a batch with one job card per stage is planned.
2. **Shift**: the supervisor checks workers in. Production can only start for workers who are checked in on the current shift.
3. **Production**: for each stage the production manager assigns a machine and operator. The operator presses **Start production**: the server checks the machine is idle and working, the operator is checked in and not busy, and the yarn is in stock. Output is recorded while running; **Finish** asks for the final output of the run and hands the batch to the next team. A short run reduces the next stage's target and is written to the history.
4. **Shift change**: the supervisor hands a running machine to the incoming operator. If an operator is checked out while a job runs, the job is paused and the manager is told.
5. **Problems**: a breakdown reported from the Machine floor blocks the job; the manager moves it to another machine (or waits for maintenance to confirm the repair) and the operator starts again.
6. **Quality**: inspect every roll. Failed rolls go back to the right stage for rework or are repaired at the bay.
7. **Dispatch**: load passed rolls, verify labels, confirm the truck (invoice raised), mark delivered.
8. **Accounts**: record payments (unique references), expenses and claims; approved buyer claims credit the invoice.

## Tests

```bash
npm test               # unit tests (shared schemas, frontend helpers)
npm run test:workflows # API workflow tests against a throwaway loomos_test database
npm run test:e2e       # Playwright browser tests (needs `npm run dev` or starts it)
npm run typecheck && npm run lint && npm run build
```

## Business assumptions

- Invoices are due 30 days after dispatch; "overdue" means unpaid after that.
- Expenses are recorded by accounts staff and need no separate approval step.
- A shift day is the date the shift starts; one attendance record per worker per shift day (re-entering reopens it).
- Operators must be checked in on the current shift to start a job; a check-in from an earlier shift that was never closed does not count.
- A stage can only be finished with real output. Finishing with less than planned is allowed and recorded as a shortfall; later stages are planned on what actually exists.
- Only the first stage uses yarn; when it finishes, unused reserved yarn goes back to the store.
- A running job is never re-planned underneath the operator: it is paused (or handed over) first, then moved.
- Operators can only run machines in their own department; workers without a department may run any.
- Stock yarn is reserved automatically when the first stage starts; unused reservations are released when the batch finishes or is cancelled.
