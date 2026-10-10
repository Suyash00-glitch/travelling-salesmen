import { useState } from 'react';
import { Plus, Users, Clock, LogIn, LogOut, UserRound, Pencil, Timer, ArrowLeftRight } from 'lucide-react';
import { hasPermission, type PageResponse } from '@loomos/shared';
import { useData, useLookups, useAction } from '../../hooks/useFactory';
import { useAuth } from '../auth/Auth';
import { Button } from '../../components/ui/button';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import { PageHeader, Panel, Loading, ErrorState, Badge, SearchBox, Kpi, Empty } from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { label, number } from '../../lib/utils';
import { handoverForm } from '../production/productionForms';

interface Attendance {
  id: string;
  date: string;
  hours: string;
  status: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  overtimeHours: string;
  note: string;
  shift: { id: string; name: string };
}

interface Worker {
  id: string;
  name: string;
  designation: string;
  active: boolean;
  department: { name: string } | null;
  attendance: Attendance[];
  assignments: { job: { id: string; stage: string; status: string; machineId: string | null; workerId: string | null; machine: { code: string } | null; production: { number: string } } }[];
}

interface ShiftBoard {
  current: { id: string; name: string; start: string; end: string } | null;
  shifts: { id: string; name: string; startHour: number; hours: string; state: string }[];
  checkedIn: { attendanceId: string; worker: { id: string; name: string; designation: string }; shift: { id: string; name: string }; since: string }[];
}

const time = (v: string) => new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

// Shifts and attendance. The supervisor checks people in and out; everyone else just sees who is on shift.
export function WorkforcePage() {
  const { user } = useAuth();
  const workers = useData<PageResponse<Worker>>('/workers?pageSize=100');
  const board = useData<ShiftBoard>('/shifts/board');
  const lookup = useLookups();
  const action = useAction();
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [search, setSearch] = useState('');
  const canAttend = hasPermission(user, 'attendance', 'manage');

  if (workers.isPending || board.isPending) return <Loading />;
  if (workers.error) return <ErrorState error={workers.error} retry={() => void workers.refetch()} />;

  const rows = (workers.data?.data ?? []).filter((w) => w.name.toLowerCase().includes(search.toLowerCase()));
  const b = board.data;
  const onShift = new Map((b?.checkedIn ?? []).map((c) => [c.worker.id, c]));
  const current = b?.current;

  const checkInForm = (workerId?: string): FormSpec => ({
    title: 'Check in',
    description: current ? `Current shift: ${current.name} (${time(current.start)} – ${time(current.end)})` : 'No shift is running right now. Check-in opens an hour before a shift starts.',
    path: '/attendance/check-in',
    fields: [
      { name: 'workerId', label: 'Worker', type: 'select', value: workerId ?? '', options: (lookup.data?.workers ?? []).filter((w) => !onShift.has(w.id)).map((w) => ({ value: w.id, label: w.name })) },
      { name: 'shiftId', label: 'Shift', type: 'select', value: current?.id ?? '', options: (b?.shifts ?? []).filter((s) => s.state !== 'COMPLETED').map((s) => ({ value: s.id, label: `${s.name} (${s.state.toLowerCase()})` })) },
    ],
    submit: 'Check in',
  });

  const correctionForm = (w: Worker, a: Attendance): FormSpec => ({
    title: `Correct ${w.name} · ${a.shift.name}`,
    description: 'Use this for a forgotten check-out or a wrong status. The change is recorded with your name.',
    path: `/attendance/${a.id}/correct`,
    fields: [
      { name: 'status', label: 'Status', type: 'select', value: a.status, options: ['PRESENT', 'ABSENT', 'LEAVE'].map((v) => ({ value: v, label: label(v) })) },
      { name: 'hours', label: 'Hours worked', type: 'number', min: 0, max: 16, value: Number(a.hours) || 8 },
      { name: 'reason', label: 'Reason for the correction', type: 'textarea', span: true },
    ],
    submit: 'Save correction',
  });

  const overtimeForm = (name: string, attendanceId: string): FormSpec => ({
    title: `Overtime · ${name}`,
    path: `/attendance/${attendanceId}/overtime`,
    fields: [
      { name: 'extraHours', label: 'Extra hours', type: 'number', min: 0.5, max: 8, value: 2 },
      { name: 'reason', label: 'Reason', span: true },
    ],
    submit: 'Approve overtime',
  });

  return (
    <>
      <PageHeader eyebrow="PEOPLE & SHIFTS" title="Workers & shifts" description={canAttend ? 'Check workers in at the start of their shift and out at the end.' : 'Who is on shift right now, and where they are working.'}>
        {hasPermission(user, 'settings', 'manage') && (
          <Button variant="outline" onClick={() => setSpec({
            title: 'Add a worker',
            path: '/workers',
            fields: [
              { name: 'name', label: 'Full name' },
              { name: 'designation', label: 'Designation' },
              { name: 'departmentId', label: 'Department', type: 'select', required: false, options: (lookup.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name })) },
              { name: 'wageType', label: 'Wage basis', type: 'select', options: [{ value: 'HOURLY', label: 'Hourly' }, { value: 'PIECE', label: 'Per metre of output' }] },
              { name: 'rate', label: 'Wage rate (₹)', type: 'number', min: 0.01 },
            ],
          })}>
            <Plus size={16} /> Add worker
          </Button>
        )}
        {canAttend && (
          <Button onClick={() => setSpec(checkInForm())}>
            <LogIn size={16} /> Check in
          </Button>
        )}
      </PageHeader>

      <div className="kpi-grid">
        <Kpi label="Current shift" value={current?.name ?? 'None'} icon={<Clock size={19} />} meta={current ? `${time(current.start)} – ${time(current.end)}` : 'Between shifts'} accent />
        <Kpi label="Checked in now" value={b?.checkedIn.length ?? 0} unit={`of ${rows.length}`} icon={<Users size={19} />} meta="On the floor right now" />
        <Kpi label="At a machine" value={rows.filter((w) => w.assignments.length).length} icon={<UserRound size={19} />} meta="Running a job" />
        <Kpi label="Shifts today" value={b?.shifts.length ?? 0} icon={<Timer size={19} />} meta={(b?.shifts ?? []).map((s) => `${s.name} ${s.state.toLowerCase()}`).join(' · ')} />
      </div>

      <div className="stage-track">
        {(b?.shifts ?? []).map((s) => (
          <div key={s.id} className={`stage-step ${s.state === 'CURRENT' ? 'is-active' : s.state === 'COMPLETED' ? 'is-done' : ''}`}>
            <header><strong>{s.name}</strong><Badge value={s.state === 'CURRENT' ? 'RUNNING' : s.state === 'COMPLETED' ? 'COMPLETED' : 'PLANNED'}>{label(s.state)}</Badge></header>
            <small>{String(s.startHour).padStart(2, '0')}:00 – {String((s.startHour + Number(s.hours)) % 24).padStart(2, '0')}:00 · {s.hours} h</small>
            <small>{(b?.checkedIn ?? []).filter((c) => c.shift.id === s.id).length} checked in</small>
          </div>
        ))}
      </div>

      <Panel title="On shift now" subtitle={canAttend ? 'Check people out when they leave; a running machine is handed over to the next operator or paused.' : 'Workers who are checked in.'}>
        {b?.checkedIn.length ? (
          <div className="record-list">
            {b.checkedIn.map((c) => {
              const w = rows.find((x) => x.id === c.worker.id);
              const job = w?.assignments[0]?.job;
              return (
                <div className="record" key={c.attendanceId}>
                  <div>
                    <strong>{c.worker.name}</strong> · {c.worker.designation}
                    <p>{c.shift.name} · since {time(c.since)}{job ? ` · ${job.machine?.code ?? label(job.stage)} on ${job.production.number}` : ' · not at a machine'}</p>
                  </div>
                  {canAttend && (
                    <div className="record-actions">
                      {job && (
                        <Button size="sm" variant="outline" title="Shift change: another checked-in operator continues on the same machine" onClick={() => setSpec(handoverForm({ ...job, workerName: c.worker.name, machineCode: job.machine?.code }, job.production.number, lookup.data))}>
                          <ArrowLeftRight size={14} /> Hand over
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setSpec(overtimeForm(c.worker.name, c.attendanceId))}><Timer size={14} /> Overtime</Button>
                      <Button size="sm" variant="outline" disabled={action.isPending} title={job ? `${job.production.number} will be paused until someone takes over` : undefined} onClick={() => action.mutate({ path: `/attendance/${c.attendanceId}/check-out` })}><LogOut size={14} /> Check out</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <Empty title="Nobody is checked in" description={canAttend ? 'Use Check in when the shift starts.' : 'The supervisor checks workers in at the start of a shift.'} />
        )}
      </Panel>

      <Panel title="All workers" subtitle="Last two weeks of attendance" className="mt-5" action={<SearchBox value={search} onChange={setSearch} placeholder="Find a worker…" />}>
        <DataTable
          data={rows}
          columns={[
            { accessorKey: 'name', header: 'Worker', cell: ({ row }) => <div className="cell-stack"><strong>{row.original.name}</strong><span>{row.original.designation}{row.original.department ? ` · ${row.original.department.name}` : ''}</span></div> },
            {
              id: 'now', header: 'Right now',
              cell: ({ row }) => {
                const c = onShift.get(row.original.id);
                const job = row.original.assignments[0]?.job;
                return c ? <div className="cell-stack"><Badge value="RUNNING">On shift · {c.shift.name}</Badge><span>{job ? `${job.machine?.code ?? label(job.stage)} · ${job.production.number}` : 'Not at a machine'}</span></div> : <Badge value="OFFLINE">Off shift</Badge>;
              },
            },
            {
              id: 'recent', header: 'Last 14 days',
              cell: ({ row }) => {
                const a = row.original.attendance;
                const present = a.filter((x) => x.status === 'PRESENT').length;
                const hours = a.reduce((s, x) => s + Number(x.hours) + Number(x.overtimeHours), 0);
                return <span>{present} day{present === 1 ? '' : 's'} · {number(hours, 1)} h</span>;
              },
            },
            {
              id: 'last', header: 'Latest record',
              cell: ({ row }) => {
                const a = row.original.attendance[0];
                if (!a) return <span className="muted">None</span>;
                return <div className="cell-stack"><span>{new Date(a.date).toLocaleDateString('en-IN')} · {a.shift.name} · {label(a.status)}</span><span>{a.checkInAt ? `${time(a.checkInAt)} → ${a.checkOutAt ? time(a.checkOutAt) : 'open'}` : `${a.hours} h`}{Number(a.overtimeHours) > 0 ? ` · +${a.overtimeHours} h OT` : ''}</span></div>;
              },
            },
            ...(canAttend
              ? [{
                  id: 'actions', header: '',
                  cell: ({ row }: { row: { original: Worker } }) => {
                    const a = row.original.attendance[0];
                    const c = onShift.get(row.original.id);
                    return (
                      <div className="record-actions">
                        {!c && <Button size="sm" variant="outline" onClick={() => setSpec(checkInForm(row.original.id))}><LogIn size={14} /> Check in</Button>}
                        {a && <Button size="sm" variant="outline" title="Fix a wrong record" onClick={() => setSpec(correctionForm(row.original, a))}><Pencil size={14} /></Button>}
                      </div>
                    );
                  },
                }]
              : []),
          ]}
        />
      </Panel>

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}
