# LoomOS — Textile Manufacturing Operating System

LoomOS is an enterprise-grade digital operating system built for modern textile mills. It connects operations end-to-end: sales orders, yarn procurement, inventory management, multi-stage production tracking (Spinning, Weaving, Dyeing), roll quality inspection with digital passports, transport dispatch, and operational finance.

---

## 🏗️ Architecture

The workspace is organized into a clean multi-package monorepo:

- **`backend/`**: Express API server with domain modules, session-based auth, and role permission guards.
- **`frontend/`**: High-performance React 19 + Vite web interface with guided operator consoles.
- **`packages/db/`**: Prisma ORM schema and PostgreSQL database client with multi-unit facility models.
- **`packages/shared/`**: Shared contracts, Zod schemas, 13 standard roles, and granular 5-action RBAC matrix.
- **`e2e/`**: Full Playwright end-to-end test suite (32 tests covering all user journeys).

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

# Push database schema & generate Prisma client
npm run db:generate

# Seed demo factory, departments, permissions, and accounts
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

| Role | Email |
| :--- | :--- |
| **Super Admin / Mill Owner** | `owner@loomos.demo` |
| **Production Manager** | `production@loomos.demo` |
| **Inventory Manager** | `inventory@loomos.demo` |
| **Procurement Manager** | `procurement@loomos.demo` |
| **Spinning Operator** | `spinning@loomos.demo` |
| **Weaving Operator** | `weaving@loomos.demo` |
| **Dyeing Operator** | `dyeing@loomos.demo` |
| **Quality Inspector** | `quality@loomos.demo` |
| **Dispatch Manager** | `dispatch@loomos.demo` |
| **Shift Supervisor** | `supervisor@loomos.demo` |
| **Maintenance Engineer** | `maintenance@loomos.demo` |
| **Accounts Manager** | `accounts@loomos.demo` |
| **Buyer Portal User** | `buyer@loomos.demo` |

---

## 🧪 Verification & Testing

```bash
# Run unit & schema tests (Vitest)
npm run test

# Run end-to-end tests (Playwright)
npm run test:e2e

# Run TypeScript type check
npm run typecheck

# Run ESLint
npm run lint

# Build production bundle
npm run build
```
