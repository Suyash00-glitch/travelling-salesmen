# LoomOS — Frontend

The frontend of **LoomOS**, a Textile Manufacturing Management System designed to digitize and streamline factory operations.

## Overview

LoomOS provides a centralized interface for managing textile manufacturing workflows, including sales orders, inventory, production, quality control, dispatch, and reporting.

The frontend communicates with the backend API to retrieve and update factory data.

## Planned Features

- **Dashboard:** Overview of factory operations, pending orders, production status, and alerts.
- **Order Management:** View customer orders, deadlines, and order progress.
- **Inventory Management:** Monitor raw materials, stock levels, and finished goods.
- **Production Tracking:** Track production stages, machine utilization, and output.
- **Quality Control:** Record inspections, defects, rework, and rejected fabric rolls.
- **Dispatch Management:** Track shipments and dispatched orders.
- **Workforce Management:** View employee attendance and shift information.
- **Reports:** Display production metrics, inventory summaries, and order profitability.

## Technology Stack

- React
- TypeScript
- Vite
- CSS / component library (to be decided)

## Project Structure

```text
frontend/
├── public/
├── src/
│   ├── components/
│   ├── pages/
│   ├── layouts/
│   ├── services/
│   ├── hooks/
│   ├── types/
│   ├── utils/
│   ├── App.tsx
│   └── main.tsx
├── .env.example
├── package.json
└── README.md
```

The structure above is the planned structure; directories will be created as development progresses.

## Getting Started

Install Node.js and npm, then initialize the React application using Vite with the React + TypeScript template.

```bash
npm create vite@latest . -- --template react-ts
npm install
npm run dev
```

Run these commands from the `frontend` directory.

## Environment Variables

Use a `.env` file for frontend configuration.

```env
VITE_API_BASE_URL=http://localhost:5000/api
```

Never store database passwords, API secrets, or other private credentials in frontend environment variables. Vite exposes `VITE_` variables to browser code.

## Development Guidelines

- Use reusable React components.
- Keep API requests in the `services/` directory.
- Use TypeScript types for API responses and application data.
- Keep authentication and role-based navigation consistent across pages.
- Handle loading states, validation errors, and API failures.
- Use responsive layouts suitable for office staff and factory-floor devices.

## Status

**Current stage:** Project initialization.

The frontend will be developed alongside the LoomOS backend API.