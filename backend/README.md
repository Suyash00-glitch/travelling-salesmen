# LoomOS — Backend API

Enterprise backend service for **LoomOS** (Textile Factory Operating System), providing REST APIs, domain workflows, authentication, audit logging, and database operations.

## Technology Stack

- **Runtime:** Node.js (ES modules)
- **Framework:** Express.js
- **Database:** PostgreSQL via Prisma ORM (`@loomos/db`)
- **Validation:** Zod schemas (`@loomos/shared`)
- **Authentication:** Session-based with httpOnly cookies, CSRF protection, and bcrypt password hashing
- **Testing:** Vitest & Playwright E2E

## Architecture & Modules

```text
backend/
├── src/
│   ├── config/          # Environment & server settings
│   ├── middleware/      # Auth, permission guards, error handlers
│   ├── modules/         # Domain modules (auth, users, inventory, etc.)
│   ├── routes/          # Express route controllers & RBAC endpoints
│   ├── lib/             # Route helpers & domain validation
│   ├── app.ts           # Express application setup
│   └── server.ts        # Server entrypoint
├── package.json
└── tsconfig.json
```

## Running the Backend

From the workspace root:

```bash
npm run dev:api
```

Or from the `backend/` directory:

```bash
npm run dev
```

The API runs on port `4000` by default (`http://localhost:4000`).