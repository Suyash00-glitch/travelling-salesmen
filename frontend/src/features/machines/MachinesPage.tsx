import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, UserRound, Wrench, Plus, Radio, Factory, Activity, PauseCircle, TriangleAlert } from 'lucide-react';
import { PreviewButton } from '../../components/shared/PreviewButton';
import { MachineIcon, MachinePreview } from '../../components/shared/MachinePreview';
import type { MachineSummary } from '@loomos/shared';
import { useData } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/dialog';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import { PageHeader, Loading, ErrorState, Badge, Kpi, } from '../../components/shared/common';
import { number, date } from '../../lib/utils';
export function MachinesPage() {
    const query = useData<MachineSummary[]>('/machines');
    const [filter, setFilter] = useState('ALL');
    const [typeFilter, setTypeFilter] = useState('ALL');
    // A machine can be opened directly from elsewhere, e.g. /machines?machine=<id>
    const [params, setParams] = useSearchParams();
    const [selectedId, setSelectedId] = useState<string | null>(params.get('machine'));
    const [spec, setSpec] = useState<FormSpec | null>(null);
    const navigate = useNavigate();
    if (query.isPending)
        return <Loading />;
    if (query.error)
        return <ErrorState error={query.error} retry={() => void query.refetch()}/>;
    const machines = query.data!;
    const selectedMachine = machines.find((m) => m.id === selectedId);
    const filteredMachines = machines
        .filter((m) => (filter === 'ALL' ? true : m.status === filter))
        .filter((m) => (typeFilter === 'ALL' ? true : m.type === typeFilter));
    return (<>
      <PageHeader eyebrow="LIVE FACTORY BOARD" title="Machine floor" description="See machine availability, today’s output and maintenance needs.">
        <span className="reported-pill">
          <Radio size={14}/>
          Operator-reported data
        </span>
        <Button onClick={() => navigate('/production')}>
          <Plus size={16}/>
          Assign production
        </Button>
      </PageHeader>

      <div className="kpi-grid">
        <Kpi label="Total machines" value={machines.length} icon={<Factory size={19}/>} meta={['SPINNING', 'WEAVING', 'DYEING'].map((t) => `${machines.filter((m) => m.type === t).length} ${t.toLowerCase()}`).join(' · ')}/>
        <Kpi label="Running now" value={machines.filter((m) => m.status === 'RUNNING').length} unit={`of ${machines.length}`} icon={<Activity size={19}/>} meta={`${number(machines.reduce((s, m) => s + Number(m.todayOutput), 0))} m produced today`} accent/>
        <Kpi label="Idle" value={machines.filter((m) => m.status === 'IDLE').length} icon={<PauseCircle size={19}/>} meta="Free for the next job"/>
        <Kpi label="Breakdown / maintenance" value={machines.filter((m) => ['BREAKDOWN', 'MAINTENANCE', 'OFFLINE'].includes(m.status)).length} icon={<TriangleAlert size={19}/>} meta={machines.filter((m) => ['BREAKDOWN', 'MAINTENANCE', 'OFFLINE'].includes(m.status)).map((m) => m.code).join(', ') || 'All machines available'}/>
      </div>

      <div className="machine-filters">
        {[
            ['ALL', 'All machines'],
            ['RUNNING', 'Running'],
            ['IDLE', 'Idle'],
            ['BREAKDOWN', 'Breakdown'],
            ['MAINTENANCE', 'Maintenance'],
        ].map(([value, text]) => (<button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>
            <span className={`status-dot status-${value.toLowerCase()}`}/>
            {text}
            <b>
              {value === 'ALL'
                ? machines.length
                : machines.filter((m) => m.status === value).length}
            </b>
          </button>))}
      </div>

      <div className="floor-section-heading" style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
        }}>
        <h2>
          <Factory size={18}/>
          Everest Textile Mills <span>/ Shop floor</span>
        </h2>
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          {[
            ['ALL', 'All Units'],
            ['SPINNING', 'Spinning'],
            ['WEAVING', 'Weaving'],
            ['DYEING', 'Dyeing'],
        ].map(([val, txt]) => (<button key={val} onClick={() => setTypeFilter(val)} style={{
                padding: '3px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                background: typeFilter === val ? 'var(--accent)' : 'transparent',
                color: typeFilter === val ? '#fff' : 'var(--text-secondary)',
                fontSize: '0.75rem',
                fontWeight: typeFilter === val ? 600 : 400,
                cursor: 'pointer',
            }}>
              {txt}
            </button>))}
        </div>
      </div>

      <div className="machine-grid">
        {filteredMachines.map((machine) => {
            const job = machine.jobs[0];
            return (<PreviewButton key={machine.id} label={`Open ${machine.code} ${machine.name}`} className={`machine-card machine-${machine.status.toLowerCase()}`} preview={<MachinePreview machine={machine}/>} onClick={() => setSelectedId(machine.id)}>
              <div className="machine-card-top">
                <span className="machine-avatar">
                  <MachineIcon type={machine.type} size={22}/>
                </span>
                <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                  <Badge value={machine.type}/>
                  <Badge value={machine.status}/>
                </div>
              </div>

              <div className="machine-name">
                <h3>
                  {machine.code}
                  <ArrowUpRight size={16}/>
                </h3>
                <p>{machine.name}</p>
              </div>

              <div className="machine-job">
                <small>CURRENT WORK ORDER</small>
                <strong>
                  {job?.production?.number ??
                    (machine.status === 'BREAKDOWN'
                        ? 'Production paused'
                        : 'Ready for the next thread')}
                </strong>
                <p>{job?.production?.fabric ?? machine.location}</p>
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
                  <UserRound size={13}/>
                  {job?.worker?.name ?? 'No operator assigned'}
                </span>
                <span className="tiny-dot"/>
              </div>

              {machine.status === 'BREAKDOWN' && (<div className="machine-breakdown">
                  <Wrench size={13}/>
                  {machine.downtime[0]?.reason ?? 'Maintenance attention needed'}
                </div>)}
            </PreviewButton>);
        })}
      </div>

      {selectedMachine && (<MachineDetails machine={selectedMachine} onClose={() => { setSelectedId(null); if (params.has('machine')) setParams({}); }} onForm={setSpec}/>)}

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)}/>}
    </>);
}
function MachineDetails({ machine, onClose, onForm, }: {
    machine: MachineSummary;
    onClose: () => void;
    onForm: (s: FormSpec) => void;
}) {
    const query = useData<{
        entries: {
            id: string;
            quantity: string;
            createdAt: string;
            hours: string;
        }[];
        downtime: {
            id: string;
            reason: string;
            startedAt: string;
            endedAt: string | null;
        }[];
    }>(`/machines/${machine.id}/history`);
    const navigate = useNavigate();
    return (<Modal open onClose={onClose} title={`${machine.code} · ${machine.name}`} description={`${machine.location} · Last reported ${new Date(machine.reportedAt).toLocaleString('en-IN')}`}>
      <div className="machine-detail-summary">
        <Badge value={machine.status}/>
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
        <Button size="sm" variant="outline" onClick={() => {
            onClose();
            navigate('/production');
        }}>
          Open production board
          <ArrowUpRight size={14}/>
        </Button>
      </div>
      <div className="detail-section">
        <h3>Recent output</h3>
        <div className="ledger">
          {query.data?.entries.slice(0, 5).map((e) => (<div key={e.id}>
              <span>
                {date(e.createdAt)} · {number(e.hours, 1)} h
              </span>
              <strong>{number(e.quantity)} m</strong>
            </div>))}
          {!query.data?.entries.length && (<p className="muted">No output recorded yet.</p>)}
        </div>
      </div>
      <div className="detail-section">
        <h3>Downtime history</h3>
        {query.data?.downtime.map((d) => (<p className="downtime-entry" key={d.id}>
            <Wrench size={15}/>
            {d.reason}
            <small>{d.endedAt ? 'Resolved' : 'Open'}</small>
          </p>))}
        {!query.data?.downtime.length && (<p className="muted">No reported downtime.</p>)}
      </div>
      <div className="dialog-footer">
        <Button variant={['BREAKDOWN', 'MAINTENANCE', 'OFFLINE'].includes(machine.status)
            ? 'default'
            : 'danger'} onClick={() => {
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
        }}>
          <Wrench size={15}/>
          {['BREAKDOWN', 'MAINTENANCE', 'OFFLINE'].includes(machine.status)
            ? 'Return to service'
            : 'Report breakdown'}
        </Button>
      </div>
    </Modal>);
}
