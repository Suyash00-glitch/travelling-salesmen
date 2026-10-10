# LoomOS — Backend

The backend of **LoomOS**, a Textile Manufacturing Management System for managing production workflows, inventory, orders, quality control, dispatch, and operational finance.

## Overview

The backend provides REST APIs, business logic, authentication, and database access for the LoomOS frontend.

It is responsible for enforcing business rules and maintaining consistency across factory operations.

## Planned Modules

- **Authentication & Authorization:** User login, roles, and access control.
- **Order Management:** Customer orders and order status tracking.
- **Procurement:** Suppliers, purchase orders, and goods receipts.
- **Inventory:** Material lots, stock movements, and stock availability.
- **Production:** Production orders, operations, machines, shifts, and production runs.
- **Quality Control:** Fabric roll inspections, defect tracking, and rework.
- **Dispatch:** Shipment creation and finished-goods dispatch.
- **Finance:** Invoices, customer payments, payroll, expenses, and production costing.
- **Audit & Notifications:** Record important actions and generate operational alerts.

## Technology Stack

- Node.js
- TypeScript
- Express.js
- PostgreSQL
- Prisma ORM
- JWT or session-based authentication (implementation to be decided)

## Project Structure

```text
backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── config/
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── customers/
│   │   ├── suppliers/
│   │   ├── inventory/
│   │   ├── orders/
│   │   ├── production/
│   │   ├── quality/
│   │   ├── dispatch/
│   │   └── finance/
│   ├── middleware/
│   ├── database/
│   ├── utils/
│   ├── app.ts
│   └── server.ts
├── .env.example
├── package.json
└── README.md
```

The structure above is planned and will be implemented incrementally.

## Getting Started

Install Node.js and npm, then initialize the backend.

```bash
npm init -y
npm install express cors dotenv @prisma/client
npm install -D typescript tsx prisma @types/node @types/express @types/cors
npx tsc --init
npx prisma init
```

Run these commands from the `backend` directory.

Configure the `package.json` scripts and TypeScript settings before starting the server.

## Environment Variables

Create a local `.env` file:

```env
PORT=5000
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/loomos"
```

Update the database URL with your actual PostgreSQL connection details. Do not commit `.env` to GitHub.

## API Conventions

- Prefix endpoints with `/api`.
- Use appropriate HTTP methods and status codes.
- Validate request bodies and query parameters.
- Apply authentication and role-based authorization to protected endpoints.
- Use database transactions for stock changes, reservations, and dispatch.
- Return consistent JSON responses.
- Log errors without exposing secrets or sensitive information.

Example planned endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/orders` | List customer orders |
| POST | `/api/orders` | Create a customer order |
| GET | `/api/inventory` | View stock |
| GET | `/api/production/orders` | View production orders |

These endpoints are examples; they are not implemented yet.

## Database

PostgreSQL will store operational data, including customers, suppliers, materials, production orders, machine records, fabric rolls, quality inspections, shipments, invoices, and payments.

Prisma migrations will manage database schema changes.

## Security Guidelines

- Hash passwords using a suitable password-hashing algorithm.
- Validate all user input.
- Keep secrets in environment variables.
- Enforce permissions on the backend, not just the frontend.
- Use database constraints and transactions to protect inventory integrity.
- Maintain audit records for sensitive operations.

## Status

**Current stage:** Project initialization.

The backend will be implemented module by module, beginning with database configuration, authentication, and core master data.