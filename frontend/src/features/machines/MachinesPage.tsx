import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserRound, Wrench, Plus, Factory, Activity, PauseCircle, TriangleAlert, Pencil, Power, History } from 'lucide-react';
import { hasPermission, type BatchRef, type MachineSummary } from '@loomos/shared';
import { useData, useLookups } from '../../hooks/useFactory';
import { useAuth } from '../auth/Auth';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import { PageHeader, Loading, ErrorState, Badge, Kpi, SearchBox, Empty } from '../../components/shared/common';
import { number, date, label } from '../../lib/utils';
import { machineForm } from '../forms/quickForms';

type Machine = Omit<MachineSummary, 'jobs' | 'downtime'> & {
  active: boolean;
  departmentId?: string | null;
  department?: { code: string; name: string } | null;
  jobs: { id: string; status: string; worker: { id: string; name: string } | null; shift: { name: string } | null; production: BatchRef }[];
  downtime: { id: string; kind: string; reason: string; startedAt: string; endedAt: string | null }[];
};

const unavailable = ['BREAKDOWN', 'MAINTENANCE', 'OFFLINE'];
const types = ['SPINNING', 'WEAVING', 'DYEING'];

const reasonForm = (machine: Machine, verb: string, title: string, description: string, submit: string, fieldLabel = 'Reason'): FormSpec => ({
  title: `${title} · ${machine.code}`,
  description,
  path: `/machines/${machine.id}/${verb}`,
  fields: [{ name: 'reason', label: fieldLabel, type: 'textarea', span: true }],
  submit,
});

export function MachinesPage() {
  const query = useData<Machine[]>('/machines');
  const lookups = useLookups();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [search, setSearch] = useState('');
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const selectedId = params.get('machine');
  const canManage = hasPermission(user, 'machines', 'manage') || hasPermission(user, 'settings', 'manage');

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const machines = query.data ?? [];
  const active = machines.filter((m) => m.active);
  const rows = machines
    .filter((m) => (status === 'ALL' ? m.active : status === 'INACTIVE' ? !m.active : m.active && m.status === status))
    .filter((m) => type === 'ALL' || m.type === type)
    .filter((m) => `${m.code} ${m.name} ${m.location}`.toLowerCase().includes(search.toLowerCase()));
  const selected = machines.find((m) => m.id === selectedId);
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('machine', id);
    else next.delete('machine');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader eyebrow="FACTORY FLOOR" title="Machines" description="Who is running what, which machines are free, and which need repair.">
        {canManage && (
          <Button onClick={() => setSpec(machineForm(lookups.data))}>
            <Plus size={16} /> Add machine
          </Button>
        )}
      </PageHeader>

      <div className="kpi-grid">
        <Kpi label="Running" value={active.filter((m) => m.status === 'RUNNING').length} unit={`of ${active.length}`} icon={<Activity size={19} />} meta={`${number(active.reduce((s, m) => s + Number(m.todayOutput), 0))} m produced today`} accent />
        <Kpi label="Idle · free for work" value={active.filter((m) => m.status === 'IDLE').length} icon={<PauseCircle size={19} />} meta={types.map((t) => `${active.filter((m) => m.status === 'IDLE' && m.type === t).length} ${t.toLowerCase()}`).join(' · ')} />
        <Kpi label="Breakdown" value={active.filter((m) => m.status === 'BREAKDOWN').length} icon={<TriangleAlert size={19} />} meta={active.filter((m) => m.status === 'BREAKDOWN').map((m) => m.code).join(', ') || 'None'} />
        <Kpi label="Under maintenance" value={active.filter((m) => m.status === 'MAINTENANCE').length} icon={<Wrench size={19} />} meta={`${machines.length - active.length} deactivated`} />
      </div>

      <div className="production-toolbar">
        <div className="segmented-control">
          {[['ALL', 'All'], ['RUNNING', 'Running'], ['IDLE', 'Idle'], ['BREAKDOWN', 'Breakdown'], ['MAINTENANCE', 'Maintenance'], ['INACTIVE', 'Deactivated']].map(([v, t]) => (
            <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>{t}</button>
          ))}
        </div>
        <div className="segmented-control">
          {['ALL', ...types].map((t) => (
            <button key={t} className={type === t ? 'active' : ''} onClick={() => setType(t)}>{t === 'ALL' ? 'All stages' : label(t)}</button>
          ))}
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder="Find a machine…" />
      </div>

      {rows.length ? (
        <div className="card-grid">
          {rows.map((m) => {
            const job = m.jobs.find((j) => j.status === 'IN_PROGRESS') ?? m.jobs[0];
            return (
              <button key={m.id} className="job-card" style={{ textAlign: 'left', cursor: 'pointer', opacity: m.active ? 1 : 0.6 }} onClick={() => open(m.id)}>
                <div className="job-card-top">
                  <strong style={{ fontSize: 16 }}>{m.code}</strong>
                  <span className="batch-flags" style={{ marginTop: 0 }}>
                    <Badge value={m.type} />
                    <Badge value={m.active ? m.status : 'OFFLINE'}>{m.active ? label(m.status) : 'Deactivated'}</Badge>
                  </span>
                </div>
                <p className="muted" style={{ margin: '4px 0 10px' }}>{m.name} · {m.location}</p>
                <div className="job-meta">
                  <span><Factory size={13} />{job ? `${job.production.number} · ${job.production.fabric}` : m.status === 'BREAKDOWN' ? m.downtime[0]?.reason ?? 'Breakdown' : 'No job assigned'}</span>
                  <span><UserRound size={13} />{job?.worker?.name ?? 'No operator'}{job?.shift ? ` · ${job.shift.name}` : ''}</span>
                </div>
                <div className="job-quantity" style={{ marginTop: 10 }}>
                  <strong>{number(m.todayOutput)} <small>m today</small></strong>
                  <span className="muted">{number(m.capacityPerHour)} m/h capacity</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <Empty title="No machines match" description="Change the filter or add a machine." />
      )}

      {selected && <MachineDetails machine={selected} onClose={() => open(null)} onForm={setSpec} canManage={canManage} />}
      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}

function MachineDetails({ machine, onClose, onForm, canManage }: { machine: Machine; onClose: () => void; onForm: (s: FormSpec) => void; canManage: boolean }) {
  const { user } = useAuth();
  const lookups = useLookups();
  const history = useData<{
    entries: { id: string; quantity: string; hours: string; createdAt: string; job: { stage: string } }[];
    downtime: { id: string; kind: string; reason: string; resolution: string; reportedBy: string; startedAt: string; endedAt: string | null }[];
    runs: { id: string; startedAt: string; endedAt: string | null; reason: string; worker: { name: string } | null; shift: { name: string } | null; job: { stage: string; production: { number: string } } }[];
  }>(`/machines/${machine.id}/history`);
  // Floor staff report breakdowns; maintenance takes machines out of service and confirms repairs.
  const canReport = hasPermission(user, 'machines', 'update');
  const canService = hasPermission(user, 'machines', 'approve');
  const job = machine.jobs.find((j) => j.status === 'IN_PROGRESS') ?? machine.jobs[0];
  const down = unavailable.includes(machine.status);

  return (
    <Modal open onClose={onClose} wide title={`${machine.code} · ${machine.name}`} description={`${label(machine.type)} · ${machine.location}${machine.department ? ` · ${machine.department.name}` : ''}`}>
      <div className="batch-modal-body">
        <div className="batch-flags" style={{ marginBottom: 12 }}>
          <Badge value={machine.active ? machine.status : 'OFFLINE'}>{machine.active ? label(machine.status) : 'Deactivated'}</Badge>
          <span className="flag">{number(machine.capacityPerHour)} m/h</span>
          <span className="flag">{number(machine.todayOutput)} m today</span>
          {machine.downtime[0] && <span className="flag issue">{label(machine.downtime[0].kind ?? 'BREAKDOWN')}: {machine.downtime[0].reason}</span>}
        </div>

        <div className="stage-track">
          <div className="stage-step">
            <header><strong>Current job</strong></header>
            <small>{job ? `${job.production.number} · ${job.production.fabric} · ${label(job.status)}` : 'None'}</small>
          </div>
          <div className="stage-step">
            <header><strong>Operator</strong></header>
            <small>{job?.worker?.name ?? 'None'}{job?.shift ? ` · ${job.shift.name}` : ''}</small>
          </div>
        </div>
        {down && !canService && machine.active && (
          <p className="muted" style={{ margin: '0 0 8px' }}>Maintenance will confirm when this machine is repaired.</p>
        )}

        <div className="detail-actions">
          {canReport && machine.active && !down && (
            <Button size="sm" variant="outline" onClick={() => onForm(reasonForm(machine, 'breakdown', 'Report breakdown', 'The running job stops and managers are told. Work can be moved to another machine.', 'Report breakdown', 'What happened?'))}>
              <TriangleAlert size={14} /> Report breakdown
            </Button>
          )}
          {canService && machine.active && machine.status === 'IDLE' && (
            <Button size="sm" variant="outline" onClick={() => onForm(reasonForm(machine, 'maintenance', 'Start maintenance', 'Takes the idle machine out of service until it is confirmed repaired.', 'Start maintenance'))}>
              <Wrench size={14} /> Maintenance
            </Button>
          )}
          {canService && machine.active && down && (
            <Button size="sm" onClick={() => onForm(reasonForm(machine, 'recover', 'Confirm repair', 'The machine becomes available for new jobs.', 'Mark as repaired', 'What was done?'))}>
              <Power size={14} /> Repaired · back in service
            </Button>
          )}
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => onForm(machineForm(lookups.data, machine))}>
              <Pencil size={14} /> Edit
            </Button>
          )}
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => onForm(machine.active
              ? reasonForm(machine, 'deactivate', 'Deactivate', 'History is kept. The machine can no longer be assigned.', 'Deactivate')
              : reasonForm(machine, 'activate', 'Activate', 'The machine becomes available again.', 'Activate'))}>
              <Power size={14} /> {machine.active ? 'Deactivate' : 'Activate'}
            </Button>
          )}
        </div>

        <section className="detail-section">
          <h3><History size={15} /> Who ran it</h3>
          {history.data?.runs.length ? (
            <div className="record-list">
              {history.data.runs.slice(0, 10).map((r) => (
                <div className="record" key={r.id}>
                  <div><strong>{r.job.production.number}</strong> · {label(r.job.stage)} · {r.worker?.name ?? 'No operator'}{r.shift ? ` · ${r.shift.name}` : ''}<p>{r.reason}</p></div>
                  <span className="record-meta">{new Date(r.startedAt).toLocaleString('en-IN')}{r.endedAt ? ` → ${new Date(r.endedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : ' · running'}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted">No runs recorded yet.</p>}
        </section>

        <section className="detail-section">
          <h3><Wrench size={15} /> Breakdowns & maintenance</h3>
          {history.data?.downtime.length ? (
            <div className="record-list">
              {history.data.downtime.map((d) => (
                <div className="record" key={d.id}>
                  <div><strong>{label(d.kind ?? 'BREAKDOWN')}</strong> · {d.reason}{d.resolution && <p>Fixed: {d.resolution}</p>}</div>
                  <span className="record-meta">{date(d.startedAt)} · {d.endedAt ? `resolved ${date(d.endedAt)}` : 'open'}{d.reportedBy ? ` · ${d.reportedBy}` : ''}</span>
                </div>
              ))}
            </div>
          ) : <p className="muted">No downtime recorded.</p>}
        </section>

        <section className="detail-section">
          <h3><Activity size={15} /> Recent output</h3>
          {history.data?.entries.length ? (
            <div className="history-list">
              {history.data.entries.slice(0, 10).map((e) => (
                <div key={e.id}><p>{number(e.quantity)} m · {label(e.job.stage)} · {number(e.hours, 1)} h</p><small>{new Date(e.createdAt).toLocaleString('en-IN')}</small></div>
              ))}
            </div>
          ) : <p className="muted">No output recorded yet.</p>}
        </section>
      </div>
    </Modal>
  );
}
