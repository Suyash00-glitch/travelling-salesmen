import { useState } from 'react';
import { Plus, Users, Clock, CalendarCheck, UserRound } from 'lucide-react';
import { can, type PageResponse } from '@loomos/shared';
import { useData, useLookups, useAction } from '../../hooks/useFactory';
import { useAuth } from '../auth/Auth';
import { Button } from '../../components/ui/button';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import { Modal } from '../../components/ui/dialog';
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  Badge,
  SearchBox,
} from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { money, date, today, label } from '../../lib/utils';

interface Worker {
  id: string;
  name: string;
  designation: string;
  initials: string;
  rate?: string;
  wageType: string;
  attendance: {
    id: string;
    date: string;
    hours: string;
    status: string;
    shift: {
      name: string;
    };
    wage?: {
      id: string;
      amount: string;
      calculation: string;
      paidAt: string | null;
    };
  }[];
  assignments: {
    job: {
      machine: {
        code: string;
      } | null;
      stage: string;
    };
  }[];
}

export function WorkforcePage() {
  const query = useData<PageResponse<Worker>>('/workers?pageSize=100');
  const lookup = useLookups();
  const { user } = useAuth();
  const action = useAction();
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [worker, setWorker] = useState<Worker | null>(null);
  const [search, setSearch] = useState('');

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const rows = query.data?.data ?? [];
  const present = rows.filter((w) =>
    w.attendance.some((a) => a.date.slice(0, 10) === today() && a.status === 'PRESENT')
  );

  const openAddWorker = () => {
    setSpec({
      title: 'Add a team member',
      path: '/workers',
      fields: [
        { name: 'name', label: 'Full name' },
        { name: 'designation', label: 'Designation' },
        {
          name: 'wageType',
          label: 'Wage basis',
          type: 'select',
          options: [
            { value: 'HOURLY', label: 'Hourly' },
            { value: 'PIECE', label: 'Per metre of output' },
          ],
        },
        { name: 'rate', label: 'Wage rate (₹)', type: 'number', min: 0.01 },
      ],
    });
  };

  const openRecordAttendance = () => {
    setSpec({
      title: 'Record attendance',
      description:
        'One attendance record per worker per day. Piece wages use that day’s recorded output; record attendance after production is finished.',
      path: '/attendance',
      fields: [
        {
          name: 'workerId',
          label: 'Team member',
          type: 'select',
          options: lookup.data?.workers.map((w) => ({ value: w.id, label: w.name })),
        },
        {
          name: 'shiftId',
          label: 'Shift',
          type: 'select',
          options: lookup.data?.shifts.map((s) => ({ value: s.id, label: s.name })),
        },
        { name: 'date', label: 'Work date', type: 'date', value: today() },
        { name: 'hours', label: 'Hours worked', type: 'number', min: 0, max: 16, value: 8 },
        {
          name: 'status',
          label: 'Attendance',
          type: 'select',
          value: 'PRESENT',
          options: ['PRESENT', 'ABSENT', 'LEAVE'].map((v) => ({
            value: v,
            label: label(v),
          })),
        },
      ],
    });
  };

  const filteredRows = rows.filter((w) =>
    w.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <PageHeader
        eyebrow="PEOPLE & SHIFTS"
        title="Workers & shifts"
        description="Review attendance, shift assignments and each team member’s records."
      >
        {can(user.role, 'settings') && (
          <Button variant="outline" onClick={openAddWorker}>
            <Plus size={16} />
            Add worker
          </Button>
        )}
        <Button onClick={openRecordAttendance}>
          <CalendarCheck size={16} />
          Record attendance
        </Button>
      </PageHeader>

      <div className="summary-strip">
        <div>
          <Users size={20} />
          <span>
            <strong>{rows.length}</strong>Team members
          </span>
        </div>
        <div>
          <CalendarCheck size={20} />
          <span>
            <strong>{present.length}</strong>Present today
          </span>
        </div>
        <div>
          <Clock size={20} />
          <span>
            <strong>{lookup.data?.shifts.length ?? 0}</strong>Factory shifts
          </span>
        </div>
        <div>
          <UserRound size={20} />
          <span>
            <strong>{rows.filter((w) => w.assignments.length).length}</strong>Assigned to machines
          </span>
        </div>
      </div>


      <div className="shift-cards">
        {lookup.data?.shifts.map((s) => (
          <div key={s.id}>
            <span className="shift-icon">
              <Clock size={20} />
            </span>
            <div>
              <h3>{s.name}</h3>
              <p>
                {String(s.startHour).padStart(2, '0')}:00 –{' '}
                {String((Number(s.startHour) + Number(s.hours)) % 24).padStart(2, '0')}:00{' '}
                <span>· {String(s.hours)} hours</span>
              </p>
            </div>
          </div>
        ))}
      </div>

      <Panel
        title="Your team"
        action={
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Find a team member…"
          />
        }
      >
        <DataTable
          data={filteredRows}
          onRow={setWorker}
          columns={[
            {
              accessorKey: 'name',
              header: 'Team member',
              cell: ({ row }) => (
                <div className="buyer-cell">
                  <span className="avatar">{row.original.initials}</span>
                  <div className="cell-stack">
                    <strong>{row.original.name}</strong>
                    <span>{row.original.designation}</span>
                  </div>
                </div>
              ),
            },
            {
              id: 'machine',
              header: 'Current assignment',
              cell: ({ row }) =>
                row.original.assignments[0]?.job.machine?.code ?? 'Available',
            },
            {
              id: 'attendance',
              header: 'Today',
              cell: ({ row }) => (
                <Badge
                  value={
                    row.original.attendance.find((a) => a.date.slice(0, 10) === today())
                      ?.status ?? 'PENDING'
                  }
                />
              ),
            },
            {
              id: 'shift',
              header: 'Latest shift',
              cell: ({ row }) => row.original.attendance[0]?.shift.name ?? '—',
            },
            ...(can(user.role, 'finance')
              ? [
                  {
                    accessorKey: 'rate',
                    header: 'Wage rate',
                    cell: ({ row }: { row: { original: Worker } }) =>
                      `${money(row.original.rate)} / ${
                        row.original.wageType === 'HOURLY' ? 'hr' : 'm'
                      }`,
                  },
                ]
              : []),
            {
              id: 'view',
              header: '',
              cell: () => <span className="text-link">View records →</span>,
            },
          ]}
        />
      </Panel>

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}

      {worker && (
        <Modal
          open
          onClose={() => setWorker(null)}
          title={worker.name}
          description={`${worker.designation} · Attendance & wage history`}
        >
          <div className="ledger">
            {(rows.find((w) => w.id === worker.id) ?? worker).attendance.map((a) => (
              <div key={a.id}>
                <div>
                  <strong>
                    {date(a.date)} · {a.hours} hours
                  </strong>
                  <small>
                    {a.shift.name} · {a.status}
                  </small>
                  {a.wage && <small>{a.wage.calculation}</small>}
                </div>
                {a.wage && (
                  <div className="wage-action">
                    <strong>{money(a.wage.amount)}</strong>
                    {a.wage.paidAt ? (
                      <Badge value="PAID" />
                    ) : (
                      can(user.role, 'finance') && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={action.isPending}
                          onClick={() =>
                            action.mutate({ path: `/wages/${a.wage!.id}/pay` })
                          }
                        >
                          Record paid
                        </Button>
                      )
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
