import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Factory,
  ShieldCheck,
  ArrowUpRight,
  CalendarDays,
  FileDown,
} from 'lucide-react';
import type { Dashboard } from '@loomos/shared';
import { can } from '@loomos/shared';
import { useAuth } from '../auth/Auth';
import { useData } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  Kpi,
  Progress,
  ExportButton,
} from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { FactoryAnalytics } from '../../components/shared/FactoryAnalytics';
import { number, today, exportCsv } from '../../lib/utils';

export function ReportsPage() {
  const [day, setDay] = useState(today());
  const query = useData<Dashboard>(`/dashboard?date=${day}`);
  const { user } = useAuth();
  const navigate = useNavigate();

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const d = query.data!;

  const handleExport = () => {
    exportCsv(
      `machine-output-${day}`,
      d.machines.map((m) => ({
        machine: m.code,
        type: m.type,
        reportedOutput: m.todayOutput,
        status: m.status,
      }))
    );
  };

  const runningShare = d.totalMachines ? Math.round((d.running / d.totalMachines) * 100) : 0;
  const passRate =
    d.passed + d.rejected ? Math.round((d.passed / (d.passed + d.rejected)) * 100) : 0;

  return (
    <>
      <PageHeader
        eyebrow="REPORTING & INSIGHTS"
        title="Factory reports"
        description="Compare output, machine availability and quality for the selected reporting date."
      >
        <label className="date-button">
          <CalendarDays size={16} />
          <input
            aria-label="Report date"
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value || today())}
          />
        </label>
        <Button variant="outline" onClick={() => navigate('/workforce?view=reports')}>
          <Activity size={16} /> Shift reports
        </Button>
        <ExportButton onClick={handleExport} />
      </PageHeader>

      <div className="kpi-grid">
        <Kpi
          label="Reported output"
          value={number(d.todayOutput)}
          unit="m"
          icon={<Activity size={18} />}
          meta="All production stages for the selected date"
        />
        <Kpi
          label="Running machine share"
          value={runningShare}
          unit="%"
          icon={<Factory size={18} />}
          meta="Current running machines / total machines"
          accent
        />
        <Kpi
          label="Inspection pass rate"
          value={passRate}
          unit="%"
          icon={<ShieldCheck size={18} />}
          meta="Passed / passed + rejected rolls, current state"
        />
        <Kpi
          label="Orders behind schedule"
          value={d.delayed}
          icon={<CalendarDays size={18} />}
          meta="Open orders past their deadline"
        />
      </div>

      <FactoryAnalytics />

      <Panel
        title="Machine output report"
        subtitle="Daily output, by reported production machine"
        action={
          can(user.role, 'finance') ? (
            <Button size="sm" variant="outline" onClick={() => navigate('/finance')}>
              Financial reporting
              <ArrowUpRight size={14} />
            </Button>
          ) : undefined
        }
      >
        <DataTable
          data={d.machines}
          columns={[
            {
              accessorKey: 'code',
              header: 'Machine',
              cell: ({ row }) => (
                <div className="cell-stack">
                  <strong>{row.original.code}</strong>
                  <span>{row.original.name}</span>
                </div>
              ),
            },
            { accessorKey: 'type', header: 'Process' },
            {
              accessorKey: 'todayOutput',
              header: 'Daily output',
              cell: ({ row }) => `${number(row.original.todayOutput)} m`,
            },
            {
              accessorKey: 'capacityPerHour',
              header: 'Rated hourly capacity',
              cell: ({ row }) => `${number(row.original.capacityPerHour)} m/h`,
            },
            {
              id: 'capacity',
              header: 'Output vs. 8-hour capacity',
              cell: ({ row }) => {
                const rate =
                  (Number(row.original.todayOutput) /
                    (Number(row.original.capacityPerHour) * 8)) *
                  100;
                return <Progress value={rate} label={`${Math.round(rate)}%`} />;
              },
            },
            { accessorKey: 'status', header: 'Reported state' },
          ]}
        />
      </Panel>

      <div className="info-banner mt-5">
        <FileDown size={19} />
        <p>
          Export the report to reconcile output with factory records. Production across sequential stages counts stage throughput, not unique finished metres.
        </p>
      </div>
    </>
  );
}
