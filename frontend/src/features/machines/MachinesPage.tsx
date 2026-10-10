import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Factory,
  ArrowUpRight,
  UserRound,
  Wrench,
  Plus,
  Radio,
  Sparkles,
  Droplets,
} from 'lucide-react';
import type { MachineSummary } from '@loomos/shared';
import { useData } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import {
  PageHeader,
  Loading,
  ErrorState,
  Badge,
} from '../../components/shared/common';
import { number, date } from '../../lib/utils';

export function MachinesPage() {
  const query = useData<MachineSummary[]>('/machines');
  const [filter, setFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [selected, setSelected] = useState<MachineSummary | null>(null);
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const navigate = useNavigate();

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const machines = query.data!;

  const filteredMachines = machines
    .filter((m) => (filter === 'ALL' ? true : m.status === filter))
    .filter((m) => (typeFilter === 'ALL' ? true : m.type === typeFilter));

  return (
    <>
      <PageHeader
        eyebrow="LIVE FACTORY BOARD"
        title="A pulse on every machine."
        description="Your shop floor, in focus. Updates reported by your team."
      >
        <span className="reported-pill">
          <Radio size={14} />
          Operator-reported data
        </span>
        <Button onClick={() => navigate('/production')}>
          <Plus size={16} />
          Assign production
        </Button>
      </PageHeader>

      <div className="machine-filters">
        {[
          ['ALL', 'All machines'],
          ['RUNNING', 'Running'],
          ['IDLE', 'Idle'],
          ['BREAKDOWN', 'Breakdown'],
          ['MAINTENANCE', 'Maintenance'],
        ].map(([value, text]) => (
          <button
            key={value}
            className={filter === value ? 'active' : ''}
            onClick={() => setFilter(value)}
          >
            <span className={`status-dot status-${value.toLowerCase()}`} />
            {text}
            <b>
              {value === 'ALL'
                ? machines.length
                : machines.filter((m) => m.status === value).length}
            </b>
          </button>
        ))}
      </div>

      <div
        className="floor-section-heading"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <h2>
          <Factory size={18} />
          Everest Textile Mills <span>/ Shop floor</span>
        </h2>
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          {[
            ['ALL', 'All Units'],
            ['SPINNING', 'Spinning'],
            ['WEAVING', 'Weaving'],
            ['DYEING', 'Dyeing'],
          ].map(([val, txt]) => (
            <button
              key={val}
              onClick={() => setTypeFilter(val)}
              style={{
                padding: '3px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: typeFilter === val ? 'var(--accent)' : 'transparent',
                color: typeFilter === val ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.75rem',
                fontWeight: typeFilter === val ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {txt}
            </button>
          ))}
        </div>
      </div>

      <div className="machine-grid">
        {filteredMachines.map((machine) => {
          const job = machine.jobs[0];
          return (
            <button
              key={machine.id}
              className={`machine-card machine-${machine.status.toLowerCase()}`}
              onClick={() => setSelected(machine)}
            >
              <div className="machine-card-top">
                <span className="machine-avatar">
                  {machine.type === 'SPINNING' ? (
                    <Sparkles size={22} color="var(--accent)" />
                  ) : machine.type === 'DYEING' ? (
                    <Droplets size={22} color="#06b6d4" />
                  ) : (
                    <Factory size={25} />
                  )}
                </span>
                <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                  <Badge value={machine.type} />
                  <Badge value={machine.status} />
                </div>
              </div>

              <div className="machine-name">
                <h3>
                  {machine.code}
                  <ArrowUpRight size={16} />
                </h3>
                <p>{machine.name}</p>
              </div>

              <div className="loom-illustration" aria-hidden="true">
                <div className="loom-top" />
                <div className="loom-threads">
                  {Array.from({ length: 18 }, (_, i) => (
                    <i key={i} />
                  ))}
                </div>
                <div className="loom-roller" />
                <div className="loom-base" />
              </div>

              <div className="machine-job">
                <small>CURRENT WORK ORDER</small>
                <strong>
                  {job?.production?.number ??
                    (machine.status === 'BREAKDOWN'
                      ? 'Production paused'
                      : 'Ready for the next thread')}
                </strong>
                <p>{job?.production?.item.fabric ?? machine.location}</p>
              </div>

              <div className="machine-stats">
                <div>
                  <small>Today’s output</small>
                  <strong>
                    {number(machine.todayOutput)} <span>m</span>
                  </strong>
                </div>
                <div>
                  <small>Rated capacity</small>
                  <strong>
                    {number(machine.capacityPerHour)} <span>m/h</span>
                  </strong>
                </div>
              </div>

              <div className="machine-card-footer">
                <span>
                  <UserRound size={13} />
                  {job?.worker?.name ?? 'No operator assigned'}
                </span>
                <span className="tiny-dot" />
              </div>

              {machine.status === 'BREAKDOWN' && (
                <div className="machine-breakdown">
                  <Wrench size={13} />
                  {machine.downtime[0]?.reason ?? 'Maintenance attention needed'}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {selected && (
        <MachineDetails
          machine={machines.find((m) => m.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
          onForm={setSpec}
        />
      )}

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}

function MachineDetails({
  machine,
  onClose,
  onForm,
}: {
  machine: MachineSummary;
  onClose: () => void;
  onForm: (s: FormSpec) => void;
}) {
  const query = useData<{
    entries: { id: string; quantity: string; createdAt: string; hours: string }[];
    downtime: { id: string; reason: string; startedAt: string; endedAt: string | null }[];
  }>(`/machines/${machine.id}/history`);
  const navigate = useNavigate();

  return (
    <Modal
      open
      onClose={onClose}
      title={`${machine.code} · ${machine.name}`}
      description={`${machine.location} · Last reported ${new Date(machine.reportedAt).toLocaleString('en-IN')}`}
    >
      <div className="machine-detail-summary">
        <Badge value={machine.status} />
        <strong>
          {number(machine.todayOutput)} m <small>reported today</small>
        </strong>
      </div>
      <div className="detail-section">
        <h3>Current assignment</h3>
        <p>
          {machine.jobs[0]?.production?.number ?? 'No active job'} ·{' '}
          {machine.jobs[0]?.worker?.name ?? 'Unassigned'}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onClose();
            navigate('/production');
          }}
        >
          Open production board
          <ArrowUpRight size={14} />
        </Button>
      </div>
      <div className="detail-section">
        <h3>Recent output</h3>
        <div className="ledger">
          {query.data?.entries.slice(0, 5).map((e) => (
            <div key={e.id}>
              <span>
                {date(e.createdAt)} · {number(e.hours, 1)} h
              </span>
              <strong>{number(e.quantity)} m</strong>
            </div>
          ))}
          {!query.data?.entries.length && (
            <p className="muted">No output recorded yet.</p>
          )}
        </div>
      </div>
      <div className="detail-section">
        <h3>Downtime history</h3>
        {query.data?.downtime.map((d) => (
          <p className="downtime-entry" key={d.id}>
            <Wrench size={15} />
            {d.reason}
            <small>{d.endedAt ? 'Resolved' : 'Open'}</small>
          </p>
        ))}
        {!query.data?.downtime.length && (
          <p className="muted">No reported downtime.</p>
        )}
      </div>
      <div className="dialog-footer">
        <Button
          variant={
            ['BREAKDOWN', 'MAINTENANCE', 'OFFLINE'].includes(machine.status)
              ? 'default'
              : 'danger'
          }
          onClick={() => {
            onClose();
            const recover = ['BREAKDOWN', 'MAINTENANCE', 'OFFLINE'].includes(machine.status);
            onForm({
              title: recover ? 'Return machine to service' : 'Report a breakdown',
              description: recover
                ? 'The machine will become idle and available for assignment.'
                : 'Running production will be blocked and the assigned worker released.',
              path: `/machines/${machine.id}/${recover ? 'recover' : 'breakdown'}`,
              fields: [
                {
                  name: 'reason',
                  label: recover ? 'Resolution notes' : 'Breakdown reason',
                  type: 'textarea',
                  span: true,
                },
              ],
              submit: recover ? 'Mark available' : 'Report breakdown',
            });
          }}
        >
          <Wrench size={15} />
          {['BREAKDOWN', 'MAINTENANCE', 'OFFLINE'].includes(machine.status)
            ? 'Return to service'
            : 'Report breakdown'}
        </Button>
      </div>
    </Modal>
  );
}
