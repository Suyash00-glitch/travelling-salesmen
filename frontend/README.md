# LoomOS — Web Frontend

Modern, high-performance web application for **LoomOS** (Textile Factory Operating System), designed for office executives and factory-floor operators.

## Technology Stack

- **Framework:** React 19 with TypeScript
- **Bundler:** Vite
- **Styling:** Vanilla CSS design system tokens + Tailwind CSS
- **State & Data Fetching:** TanStack React Query
- **Routing:** React Router v7
- **Icons:** Lucide React
- **Tables & Modals:** TanStack Table, Radix UI Dialog

## Key Features

- **Dashboard:** Factory KPIs, machine status mini-grid, and production charts.
- **Super Admin RBAC Panel:** User administration, multi-role assignment, custom role creator, interactive 5-action permission matrix, facility/department scoping, and immutable audit logs.
- **Guided Operator Consoles:** Tailored views for Spinning, Weaving, and Dyeing stages.
- **Quality & Traceability:** Fabric roll passports with QR codes and defect inspection logging.
- **Buyer Portal:** Personalized customer orders and dispatch tracking.

## Running the Frontend

From the workspace root:

```bash
npm run dev:web
```

Or from the `frontend/` directory:

```bash
npm run dev
```

The web application runs on port `5173` by default (`http://localhost:5173`).