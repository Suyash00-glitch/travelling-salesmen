import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Factory,
  Play,
  Pause,
  Check,
  Plus,
  UserRound,
  Clock,
  ClipboardList,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  ArrowLeftRight,
  Settings2,
  Users,
} from 'lucide-react';
import { hasPermission, jobStatusLabels, stageForRole, type BatchRef, type JobSummary, type PageResponse } from '@loomos/shared';
import { useData, useLookups, useAction } from '../../hooks/useFactory';
import { useAuth } from '../auth/Auth';
import { Button } from '../../components/ui/button';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import { PageHeader, Loading, ErrorState, Badge, Progress, SearchBox, Kpi } from '../../components/shared/common';
import { number, label } from '../../lib/utils';
import { assignForm, finishForm, handoverForm, issueForm, outputForm, reworkForm, standaloneBatchForm } from './productionForms';

interface Job extends Omit<JobSummary, 'production'> {
  shift?: { name: string } | null;
  production: BatchRef & {
    status: string;
    priority: string;
    reservations: { lotId: string; quantity: string; consumed: string; lot: { code: string } }[];
    jobs: { sequence: number; stage: string; status: string }[];
  };
}

const stageMeta = {
  SPINNING: { title: 'Spinning', subtitle: 'Ring spinning frames' },
  WEAVING: { title: 'Weaving', subtitle: 'Looms' },
  DYEING: { title: 'Dyeing', subtitle: 'Dyeing machines' },
} as const;

// The floor board. Every stage of every batch is a card; each card shows exactly the next action
// the signed-in person may take:
//   production manager  → assign / move, and everything an operator can do
//   operator            → start, output, finish, pause, report a problem (own jobs only)
//   shift supervisor    → hand a running job to the next shift's operator
//   everyone else       → read only
export function ProductionPage() {
  const query = useData<PageResponse<Job>>('/production?pageSize=100');
  const lookup = useLookups();
  const action = useAction();
  const { user } = useAuth();
  const navigate = useNavigate();

  const ownStage = stageForRole(user.role);
  const canRun = hasPermission(user, 'production', 'update');
  const canPlan = hasPermission(user, 'production', 'approve');
  const canCreate = hasPermission(user, 'production', 'create');
  const canHandover = hasPermission(user, 'attendance', 'manage') || canPlan;
  const canRework = canPlan || hasPermission(user, 'quality', 'manage');
  const [search, setSearch] = useState('');
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [view, setView] = useState<'Pipeline' | 'List'>('Pipeline');
  const [showCompleted, setShowCompleted] = useState(false);

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const allJobs = query.data?.data ?? [];
  const completedCount = allJobs.filter((j) => j.status === 'COMPLETED').length;
  const jobs = allJobs
    .filter((j) => showCompleted || j.status !== 'COMPLETED')
    .filter((j) =>
      `${j.production.number} ${j.production.fabric} ${j.production.order?.buyer.name ?? 'stock'} ${j.production.order?.number ?? ''} ${j.stage}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );

  const nextStageOf = (job: Job) => job.production.jobs.find((j) => j.sequence === job.sequence + 1)?.stage;
  // Rework can go back to this stage or any earlier stage the batch has already run.
  const reachedStages = (job: Job) => {
    const started = ['IN_PROGRESS', 'BLOCKED', 'PAUSED'].includes(job.status);
    return job.production.jobs.filter((j) => j.sequence < job.sequence || (started && j.sequence === job.sequence)).map((j) => j.stage);
  };
  // Operators act only on jobs assigned to them; managers on any.
  const mine = (job: Job) => !ownStage || job.workerId === user.workerId;
  const post = (job: Job, verb: string) => action.mutate({ path: `/production/jobs/${job.id}/${verb}` });

  const renderJobCard = (job: Job) => {
    const percent = Math.min(100, Math.round((Number(job.output) / Number(job.target)) * 100));
    const next = nextStageOf(job);
    const busy = action.isPending;
    const stopped = ['PAUSED', 'BLOCKED'].includes(job.status);
    const running = job.status === 'IN_PROGRESS';
    const assigned = job.status === 'ASSIGNED';
    const noAction = job.status === 'READY' && !canPlan;

    return (
      <article key={job.id} className={`job-card ${job.status === 'BLOCKED' ? 'job-blocked' : ''}`}>
        <div className="job-card-top">
          <div className="job-card-title">
            <strong>{job.production.number}</strong>
            <span className="muted">{job.production.order?.number ?? label(job.production.purpose)}</span>
          </div>
          <Badge value={job.status}>{jobStatusLabels[job.status]}</Badge>
        </div>
        {(job.production.status === 'REWORK' || job.production.priority !== 'NORMAL') && (
          <div className="batch-flags">
            {job.production.status === 'REWORK' && <span className="flag rework">Rework run</span>}
            {job.production.priority !== 'NORMAL' && <span className="flag urgent">{label(job.production.priority)}</span>}
          </div>
        )}

        <h3>{job.production.fabric}</h3>
        <p className="muted job-card-sub">{job.production.order?.buyer.name ?? 'Finished stock'} · {job.production.color}</p>

        <Progress value={percent} />
        <div className="job-quantity">
          <strong>{number(job.output)} <small>/ {number(job.target)} m</small></strong>
          <span>{percent}%</span>
        </div>

        <div className="job-meta">
          <span><Factory size={13} />{job.machine ? `${job.machine.code} · ${job.machine.name}` : 'No machine yet'}</span>
          <span><UserRound size={13} />{job.worker?.name ?? 'No operator yet'}{job.shift ? ` · ${job.shift.name}` : ''}</span>
        </div>

        <div className="job-card-actions">
          {job.status === 'PLANNED' && (
            <span className="muted job-note">
              <Clock size={13} /> Waiting for {label(job.production.jobs.find((j) => j.sequence === job.sequence - 1)?.stage ?? 'previous stage').toLowerCase()}
            </span>
          )}
          {noAction && (
            <span className="muted job-note"><Settings2 size={13} /> Waiting for the production manager to assign a machine and operator</span>
          )}

          {job.status === 'READY' && canPlan && (
            <Button size="sm" disabled={!lookup.data} onClick={() => setSpec(assignForm(job, job.production.number, lookup.data))}>
              <Settings2 size={13} /> Assign machine & operator
            </Button>
          )}

          {(assigned || stopped) && canRun && mine(job) && (
            <Button size="sm" disabled={busy} onClick={() => post(job, 'start')} title="Checks the machine, the operator's check-in and the yarn, then starts">
              <Play size={13} /> {stopped ? 'Start again' : 'Start production'}
            </Button>
          )}
          {(assigned || stopped) && canPlan && (
            <Button size="sm" variant="outline" disabled={!lookup.data} onClick={() => setSpec(assignForm(job, job.production.number, lookup.data))}>
              <ArrowLeftRight size={13} /> {stopped ? 'Move' : 'Change'}
            </Button>
          )}

          {running && canRun && mine(job) && (
            <>
              <Button size="sm" variant="outline" onClick={() => setSpec(outputForm(job, lookup.data))}>
                <Plus size={13} /> Output
              </Button>
              <Button size="sm" className="button-lime" onClick={() => setSpec(finishForm(job, next, lookup.data))} title="Confirm the final output and hand over">
                {next ? <ArrowRight size={13} /> : <ShieldCheck size={13} />} Finish · to {next ? label(next) : 'Quality'}
              </Button>
              <Button size="icon" variant="outline" title="Pause" aria-label="Pause" disabled={busy} onClick={() => post(job, 'pause')}>
                <Pause size={13} />
              </Button>
            </>
          )}
          {(running || job.status === 'PAUSED') && canHandover && job.machineId && (
            <Button size="sm" variant="outline" title="Shift change: another checked-in operator continues on the same machine" onClick={() => setSpec(handoverForm({ ...job, workerName: job.worker?.name, machineCode: job.machine?.code }, job.production.number, lookup.data))}>
              <Users size={13} /> Hand over
            </Button>
          )}

          {canRun && mine(job) && ['IN_PROGRESS', 'BLOCKED', 'PAUSED', 'ASSIGNED'].includes(job.status) && (
            <Button size="sm" variant="outline" title="Report a problem" onClick={() => setSpec(issueForm(job.production, job.id))}>
              <AlertTriangle size={13} /> Problem
            </Button>
          )}
          {canRework && reachedStages(job).length > 0 && job.production.status !== 'REWORK' && ['IN_PROGRESS', 'BLOCKED', 'PAUSED'].includes(job.status) && (
            <Button size="sm" variant="outline" title="Send back to an earlier stage" onClick={() => setSpec(reworkForm(job.production, reachedStages(job), lookup.data, undefined, job.stage))}>
              <RotateCcw size={13} /> Rework
            </Button>
          )}

          {job.status === 'COMPLETED' && (
            <span className="green-text job-note">
              <Check size={13} /> {label(job.stage)} complete
            </span>
          )}
        </div>
      </article>
    );
  };

  const columns = (Object.keys(stageMeta) as (keyof typeof stageMeta)[])
    .filter((s) => !ownStage || s === ownStage)
    .map((id) => ({ id, ...stageMeta[id], jobs: jobs.filter((j) => j.stage === id) }));

  const description = ownStage
    ? 'Your jobs. The manager assigns you a machine; you start, record output and finish.'
    : canPlan
      ? 'Assign a machine and operator to each stage; the operator starts, records output and hands over.'
      : canHandover
        ? 'What every stage is doing now. Use Hand over when the next shift takes a running machine.'
        : 'What every stage is doing right now.';

  return (
    <>
      <PageHeader
        eyebrow={ownStage ? `${label(ownStage).toUpperCase()} TEAM` : 'MANUFACTURING'}
        title="Production floor"
        description={description}
      >
        {!ownStage && (
          <Button variant="outline" onClick={() => navigate('/batches')}>
            <ClipboardList size={16} /> Batches & rework
          </Button>
        )}
        {canCreate && (
          <Button disabled={!lookup.data} onClick={() => setSpec(standaloneBatchForm(lookup.data))}>
            <Plus size={16} /> New batch
          </Button>
        )}
      </PageHeader>

      <div className="kpi-grid">
        <Kpi label="Needs machine & operator" value={allJobs.filter((j) => j.status === 'READY').length} unit="jobs" icon={<Settings2 size={19} />} meta="Handed over, nobody assigned yet" accent />
        <Kpi label="Ready to start" value={allJobs.filter((j) => j.status === 'ASSIGNED').length} unit="jobs" icon={<Play size={19} />} meta="Assigned · press Start production" />
        <Kpi label="Running" value={allJobs.filter((j) => j.status === 'IN_PROGRESS').length} unit="jobs" icon={<Factory size={19} />} meta={`${number(allJobs.filter((j) => j.status === 'IN_PROGRESS').reduce((s, j) => s + Number(j.output), 0))} m recorded so far`} />
        <Kpi label="Stopped" value={allJobs.filter((j) => ['BLOCKED', 'PAUSED'].includes(j.status)).length} unit="jobs" icon={<Pause size={19} />} meta="Blocked or paused · move or start again" />
      </div>

      <div className="production-toolbar">
        <div className="segmented-control">
          {(['Pipeline', 'List'] as const).map((t) => (
            <button key={t} className={view === t ? 'active' : ''} onClick={() => setView(t)}>{t === 'Pipeline' ? 'By stage' : 'List'}</button>
          ))}
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder="Search batch, fabric or buyer…" />
        <label className="muted toolbar-check">
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          Show completed ({completedCount})
        </label>
      </div>

      {view === 'Pipeline' ? (
        <div className="kanban-board" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
          {columns.map((col) => (
            <section key={col.id} className="kanban-column">
              <div className="kanban-heading">
                <div>
                  <h2>{col.title}</h2>
                  <span className="muted">{col.subtitle}</span>
                </div>
                <Badge value={String(col.jobs.length)} />
              </div>
              <div className="kanban-cards">
                {col.jobs.map(renderJobCard)}
                {col.jobs.length === 0 && (
                  <div className="kanban-empty">
                    <ClipboardList size={22} />
                    <p>Nothing waiting in {col.title.toLowerCase()}</p>
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="card-grid">
          {jobs.map(renderJobCard)}
          {jobs.length === 0 && (
            <div className="kanban-empty" style={{ padding: 40 }}>
              <ClipboardList size={28} />
              <p>No jobs match</p>
            </div>
          )}
        </div>
      )}

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}
