import { StatusDonut, BreakdownBars, groupCounts } from '../../components/shared/FactoryInsights';
import { useState, type DragEvent } from 'react';
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
  Sparkles,
  Droplets,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { jobStatusLabels, stageForRole, type JobSummary, type PageResponse } from '@loomos/shared';
import { useData, useLookups, useAction } from '../../hooks/useFactory';
import { useAuth } from '../auth/Auth';
import { api } from '../../services/api';
import { Button } from '../../components/ui/button';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import {
  PageHeader,
  Loading,
  ErrorState,
  Badge,
  Progress,
  SearchBox,
} from '../../components/shared/common';
import { number, label } from '../../lib/utils';
import { toast } from 'sonner';

interface Job extends Omit<JobSummary, 'production'> {
  production: {
    number: string;
    item: {
      fabric: string;
      color: string;
      recipeId: string;
      order: {
        id: string;
        number: string;
        buyer: {
          name: string;
        };
      };
    };
    reservations: {
      lotId: string;
      quantity: string;
      consumed: string;
      lot: {
        code: string;
      };
    }[];
    jobs: {
      sequence: number;
      stage: string;
      status: string;
    }[];
  };
}

export function ProductionPage() {
  const query = useData<PageResponse<Job>>('/production?pageSize=100');
  const lookup = useLookups();
  const action = useAction();
  const { user } = useAuth();
  const navigate = useNavigate();

  const isOperator = [
    'OPERATOR',
    'SPINNING_OPERATOR',
    'WEAVING_OPERATOR',
    'DYEING_OPERATOR',
  ].includes(user.role);

  const ownStage = stageForRole(user.role);
  const stageFilter = ownStage ?? 'ALL';
  const [search, setSearch] = useState('');
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [view, setView] = useState<'Pipeline' | 'Board' | 'List'>('Pipeline');

  // Drag and drop state
  const [draggingJobId, setDraggingJobId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [isAdvancing, setIsAdvancing] = useState<string | null>(null);

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const allJobs = query.data?.data ?? [];

  // Filter jobs by stage and search term
  const filteredJobs = allJobs
    .filter((j) => (stageFilter === 'ALL' ? true : j.stage === stageFilter))
    .filter((j) =>
      `${j.production.number} ${j.production.item.fabric} ${j.production.item.order.buyer.name} ${j.stage}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );

  // Stage that receives this job when it is finished (undefined = quality check)
  const nextStageOf = (job: Job) =>
    job.production.jobs.find((j) => j.sequence === job.sequence + 1)?.stage;

  // One tap: accept a waiting job, or finish a running one and hand it to the next team
  const handleQuickAdvance = async (job: Job) => {
    setIsAdvancing(job.id);
    try {
      await api(`/production/jobs/${job.id}/advance`, {});
      const next = nextStageOf(job);
      toast.success(
        job.status === 'IN_PROGRESS'
          ? `${job.production.number} sent to ${next ? label(next) : 'Quality Check'}`
          : `${label(job.stage)} started for ${job.production.number}`
      );
      void query.refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsAdvancing(null);
    }
  };

  // Drag handlers
  const handleDragStart = (e: DragEvent<HTMLElement>, jobId: string) => {
    e.dataTransfer.setData('text/plain', jobId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingJobId(jobId);
  };

  const handleDragEnd = () => {
    setDraggingJobId(null);
    setDragOverColumn(null);
  };

  const handleStageDrop = async (e: DragEvent<HTMLElement>, targetStage: string) => {
    e.preventDefault();
    const jobId = e.dataTransfer.getData('text/plain') || draggingJobId;
    setDragOverColumn(null);
    setDraggingJobId(null);
    if (!jobId) return;

    // Dropping a running job on the next stage finishes it and hands it over.
    const job = allJobs.find((j) => j.id === jobId);
    if (!job || job.stage === targetStage) return;
    if (job.status === 'IN_PROGRESS' && nextStageOf(job) === targetStage) {
      await handleQuickAdvance(job);
    } else {
      toast.info('Jobs move one stage at a time: finish the running stage first.');
    }
  };

  const handleStatusDrop = async (e: DragEvent<HTMLElement>, targetStatus: string) => {
    e.preventDefault();
    const jobId = e.dataTransfer.getData('text/plain') || draggingJobId;
    setDragOverColumn(null);
    setDraggingJobId(null);
    if (!jobId) return;

    // Only the next step is allowed: Ready → In Progress → Completed.
    const job = allJobs.find((j) => j.id === jobId);
    if (!job) return;
    const canStart = targetStatus === 'IN_PROGRESS' && ['READY', 'PAUSED', 'BLOCKED'].includes(job.status);
    const canFinish = targetStatus === 'COMPLETED' && job.status === 'IN_PROGRESS';
    if (canStart || canFinish) {
      await handleQuickAdvance(job);
    } else if (job.status !== targetStatus) {
      toast.info('That move is not allowed yet. Use the button on the card.');
    }
  };

  // Traditional modal forms for detailed manual override
  function start(job: Job) {
    setSpec({
      title: `Start ${label(job.stage).toLowerCase()}`,
      description: `${job.production.number} · ${job.production.item.fabric}`,
      path: `/production/jobs/${job.id}/start`,
      fields: [
        {
          name: 'machineId',
          label: 'Available machine',
          type: 'select',
          options: lookup.data?.machines
            .filter((m) => m.type === job.stage && m.status === 'IDLE')
            .map((m) => ({ value: m.id, label: `${String(m.code)} · ${m.name}` })),
        },
        {
          name: 'workerId',
          label: 'Operator',
          type: 'select',
          options: lookup.data?.workers.map((w) => ({ value: w.id, label: w.name })),
        },
        {
          name: 'shiftId',
          label: 'Shift',
          type: 'select',
          options: lookup.data?.shifts.map((s) => ({ value: s.id, label: s.name })),
        },
      ],
      submit: 'Start production',
    });
  }

  function output(job: Job) {
    const last = job.sequence === Math.max(...job.production.jobs.map((j) => j.sequence));
    const recipe = lookup.data?.recipes.find((r) => r.id === job.production.item.recipeId);
    setSpec({
      title: 'Record production output',
      description: `${job.production.number} · ${label(job.stage)}. Report work and material consumed.`,
      path: `/production/jobs/${job.id}/output`,
      fields: [
        {
          name: 'quantity',
          label: 'Output (metres)',
          type: 'number',
          min: 0.001,
          value: Math.min(200, Number(job.target) - Number(job.output)),
        },
        {
          name: 'hours',
          label: 'Machine run hours',
          type: 'number',
          min: 0.001,
          max: 16,
          value: 2,
        },
        {
          name: 'waste',
          label: 'Fabric wastage (metres)',
          type: 'number',
          min: 0,
          value: 0,
        },
        ...(job.sequence === 0
          ? [
              {
                name: 'lotId',
                label: 'Reserved yarn lot',
                type: 'select' as const,
                options: job.production.reservations.map((r) => ({
                  value: r.lotId,
                  label: `${r.lot.code} · ${number(Number(r.quantity) - Number(r.consumed), 2)} kg remaining`,
                })),
              },
              {
                name: 'consumedKg',
                label: 'Actual yarn used (kg)',
                type: 'number' as const,
                min: 0.001,
                value:
                  Number(recipe?.kgPerMetre ?? 0.2) *
                  Math.min(200, Number(job.target) - Number(job.output)),
              },
            ]
          : []),
        ...(last
          ? [
              {
                name: 'rolls',
                label: 'Roll lengths (metres, comma separated)',
                value: String(Math.min(200, Number(job.target) - Number(job.output))),
                hint: 'Lengths must total the recorded output.',
                span: true,
              },
            ]
          : []),
      ],
      transform: (d) => ({
        ...d,
        consumedKg: Number(d.consumedKg ?? 0),
        rollLengths: last ? (d.rolls as string).split(',').map(Number) : [],
      }),
      submit: 'Save production entry',
    });
  }

  // Stages for the Pipeline View: SPINNING -> WEAVING -> DYEING -> QA
  const stageColumns = [
    {
      id: 'SPINNING',
      title: 'Spinning Shed',
      subtitle: 'Ring spinning frames & twist',
      color: 'blue',
      icon: <Sparkles size={16} color="#60a5fa" />,
      jobs: filteredJobs.filter((j) => j.stage === 'SPINNING'),
    },
    {
      id: 'WEAVING',
      title: 'Weaving Shed',
      subtitle: 'Air-jet & rapier looms',
      color: 'amber',
      icon: <Layers size={16} color="#f59e0b" />,
      jobs: filteredJobs.filter((j) => j.stage === 'WEAVING'),
    },
    {
      id: 'DYEING',
      title: 'Dyeing & Processing',
      subtitle: 'Jet dyeing & soft flow vessels',
      color: 'purple',
      icon: <Droplets size={16} color="#a855f7" />,
      jobs: filteredJobs.filter((j) => j.stage === 'DYEING'),
    },
  ];

  // Status groups for the Kanban Status view
  const statusGroups = [
    { title: 'Pending', statuses: ['PLANNED'], color: 'gray' },
    { title: 'Ready to Accept', statuses: ['READY', 'PAUSED', 'BLOCKED'], color: 'amber' },
    { title: 'In Progress', statuses: ['IN_PROGRESS'], color: 'green' },
    { title: 'Completed', statuses: ['COMPLETED'], color: 'blue' },
  ];

  const renderJobCard = (job: Job) => {
    const isAdv = isAdvancing === job.id;
    const isDragging = draggingJobId === job.id;
    const percent = Math.min(100, Math.round((Number(job.output) / Number(job.target)) * 100));

    return (
      <article
        key={job.id}
        draggable
        onDragStart={(e) => handleDragStart(e, job.id)}
        onDragEnd={handleDragEnd}
        className={`job-card ${job.status === 'BLOCKED' ? 'job-blocked' : ''}`}
        style={{
          opacity: isDragging ? 0.45 : 1,
          border: isDragging ? '2px dashed var(--accent)' : undefined,
          cursor: 'grab',
          transition: 'all 0.15s ease',
        }}
      >
        <div className="job-card-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <strong style={{ fontSize: '0.8125rem' }}>{job.production.number}</strong>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', marginLeft: '6px' }}>
              {job.production.item.order.number}
            </span>
          </div>
          <Badge value={job.status}>{jobStatusLabels[job.status]}</Badge>
        </div>

        <h3 style={{ margin: '8px 0 4px', fontSize: '0.9375rem', fontWeight: 650 }}>
          {job.production.item.fabric}
        </h3>
        <p style={{ margin: '0 0 10px', fontSize: '0.8125rem', color: 'var(--muted)' }}>
          {job.production.item.order.buyer.name} <span>·</span> {job.production.item.color}
        </p>

        <Progress value={percent} />
        <div className="job-quantity" style={{ margin: '6px 0 10px' }}>
          <strong>
            {number(job.output)} <small>/ {number(job.target)} m</small>
          </strong>
          <span>{percent}%</span>
        </div>

        <div className="job-meta" style={{ marginBottom: '12px' }}>
          <span>
            <Factory size={13} />
            {job.machine?.code ? `${job.machine.code} · ${job.machine.name}` : `${label(job.stage)} Machine`}
          </span>
          <span>
            <UserRound size={13} />
            {job.worker?.name ?? 'Assigned Operator'}
          </span>
        </div>

        {/* 1-CLICK EASY STAGE ACTION BUTTONS */}
        <div className="job-card-actions" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {/* Waiting for the previous team */}
          {job.status === 'PLANNED' && (
            <span className="muted text-xs" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={13} />
              Waiting for the previous stage
            </span>
          )}

          {/* Handed over: accept with one tap (picks a free machine), or choose one */}
          {['READY', 'PAUSED', 'BLOCKED'].includes(job.status) && (
            <>
              <Button size="sm" disabled={isAdv} onClick={() => handleQuickAdvance(job)} style={{ fontWeight: 600 }}>
                <Play size={13} />
                {job.status === 'PAUSED' ? 'Resume' : job.status === 'BLOCKED' ? 'Restart on free machine' : 'Accept & start'}
              </Button>
              <Button size="sm" variant="outline" disabled={isAdv} onClick={() => start(job)}>
                Choose machine
              </Button>
            </>
          )}

          {/* Running: finish and hand over to the next team */}
          {job.status === 'IN_PROGRESS' && (
            <Button
              size="sm"
              disabled={isAdv}
              onClick={() => handleQuickAdvance(job)}
              style={{ background: '#059669', color: '#fff', fontWeight: 600 }}
              title="Records any remaining output and notifies the next team"
            >
              {nextStageOf(job) ? <ArrowRight size={13} /> : <ShieldCheck size={13} />}
              Finish · send to {nextStageOf(job) ? label(nextStageOf(job)!) : 'Quality Check'}
            </Button>
          )}

          {/* Auxiliary actions when In Progress */}
          {job.status === 'IN_PROGRESS' && (
            <>
              <Button
                size="sm"
                variant="outline"
                title="Record custom manual output"
                onClick={() => output(job)}
              >
                <Plus size={13} />
                Output
              </Button>
              <Button
                size="icon"
                variant="outline"
                title="Pause job"
                onClick={() => action.mutate({ path: `/production/jobs/${job.id}/pause` })}
              >
                <Pause size={13} />
              </Button>
            </>
          )}

          {/* If Completed */}
          {job.status === 'COMPLETED' && (
            <span className="green-text text-xs" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Check size={13} />
              {label(job.stage)} complete
            </span>
          )}
        </div>
      </article>
    );
  };

  return (
    <>
      <PageHeader
        eyebrow="MANUFACTURING WORKSPACE"
        title="Production floor & stage pipeline"
        description="Effortlessly move jobs across Spinning, Weaving, and Dyeing with 1-click buttons or drag & drop."
      >
        <Button variant="outline" onClick={() => navigate('/machines')}>
          <Factory size={16} />
          Machine floor
        </Button>
        {!isOperator && (
          <Button onClick={() => navigate('/orders')}>
            <Plus size={16} />
            Plan from order
          </Button>
        )}
      </PageHeader>

      {/* Operator role console indicator */}
      {isOperator && (
        <div
          style={{
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            {user.role === 'SPINNING_OPERATOR' ? (
              <Sparkles size={18} color="#60a5fa" />
            ) : user.role === 'DYEING_OPERATOR' ? (
              <Droplets size={18} color="#60a5fa" />
            ) : (
              <Layers size={18} color="#60a5fa" />
            )}
            <div>
              <strong style={{ fontSize: '0.875rem' }}>{label(user.role)} Console</strong>
              <span style={{ fontSize: '0.8125rem', color: 'var(--muted)', marginLeft: '0.5rem' }}>
                You see only {ownStage ? label(ownStage).toLowerCase() : 'floor'} jobs · New work appears here automatically
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Factory Insights Summary */}
      <div className="insights-grid">
        <StatusDonut
          title="Job status"
          description="Current status distribution of jobs"
          unit="jobs"
          items={groupCounts(filteredJobs.map((j) => j.status))}
        />
        <BreakdownBars
          title="Throughput by process"
          description="Recorded output across textile stages"
          unit="m"
          items={['SPINNING', 'WEAVING', 'DYEING'].map((stage) => ({
            name: label(stage),
            value: filteredJobs
              .filter((j) => j.stage === stage)
              .reduce((sum, j) => sum + Number(j.output), 0),
          }))}
        />
      </div>

      {/* Production Toolbar */}
      <div className="production-toolbar">
        <div className="segmented-control">
          {(['Pipeline', 'Board', 'List'] as const).map((t) => (
            <button key={t} className={view === t ? 'active' : ''} onClick={() => setView(t)}>
              {t === 'Pipeline' ? 'Stage Pipeline' : t === 'Board' ? 'Status Board' : 'List'}
            </button>
          ))}
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder="Search order, fabric, or buyer…" />
        <span className="muted" style={{ fontSize: '0.8125rem' }}>
          {filteredJobs.length} work items · Drag or click to update
        </span>
      </div>

      {/* 1. STAGE PIPELINE VIEW: SPINNING -> WEAVING -> DYEING */}
      {view === 'Pipeline' && (
        <div className="kanban-board" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px' }}>
          {stageColumns.map((col) => {
            const isOver = dragOverColumn === col.id;
            return (
              <section
                key={col.id}
                className="kanban-column"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverColumn(col.id);
                }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={(e) => handleStageDrop(e, col.id)}
                style={{
                  background: isOver ? 'rgba(59, 130, 246, 0.08)' : undefined,
                  border: isOver ? '2px dashed #3b82f6' : '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '14px',
                  transition: 'all 0.15s ease',
                  minHeight: '400px',
                }}
              >
                <div className="kanban-heading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {col.icon}
                    <div>
                      <h2 style={{ fontSize: '0.9375rem', fontWeight: 650, margin: 0 }}>{col.title}</h2>
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{col.subtitle}</span>
                    </div>
                  </div>
                  <Badge value={String(col.jobs.length)} />
                </div>

                <div className="kanban-cards" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {col.jobs.map((job) => renderJobCard(job))}

                  {/* Clean empty state without inserting dummy data */}
                  {col.jobs.length === 0 && (
                    <div
                      className="kanban-empty"
                      style={{
                        padding: '32px 16px',
                        textAlign: 'center',
                        color: 'var(--muted)',
                        background: 'rgba(0,0,0,0.02)',
                        borderRadius: '8px',
                        border: '1px dashed var(--border)',
                      }}
                    >
                      <ClipboardList size={22} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                      <p style={{ margin: 0, fontSize: '0.8125rem' }}>No jobs in {col.title}</p>
                      <small style={{ fontSize: '0.75rem', opacity: 0.7 }}>Drag a card here to advance stage</small>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* 2. STATUS BOARD VIEW: PLANNED -> READY -> IN_PROGRESS -> COMPLETED */}
      {view === 'Board' && (
        <div className="kanban-board">
          {statusGroups.map((group) => {
            const isOver = dragOverColumn === group.title;
            const groupJobs = filteredJobs.filter((j) => group.statuses.includes(j.status));

            return (
              <section
                key={group.title}
                className="kanban-column"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverColumn(group.title);
                }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={(e) => handleStatusDrop(e, group.statuses[0])}
                style={{
                  background: isOver ? 'rgba(59, 130, 246, 0.08)' : undefined,
                  border: isOver ? '2px dashed #3b82f6' : undefined,
                  minHeight: '400px',
                }}
              >
                <div className="kanban-heading">
                  <span className={`tiny-dot ${group.color}`} />
                  <h2>{group.title}</h2>
                  <span>{groupJobs.length}</span>
                </div>

                <div className="kanban-cards">
                  {groupJobs.map((job) => renderJobCard(job))}

                  {groupJobs.length === 0 && (
                    <div className="kanban-empty">
                      <ClipboardList size={21} />
                      <p>No jobs in this status</p>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* 3. LIST VIEW */}
      {view === 'List' && (
        <div className="job-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredJobs.map((job) => renderJobCard(job))}
          {filteredJobs.length === 0 && (
            <div className="kanban-empty" style={{ padding: '40px' }}>
              <ClipboardList size={28} />
              <p>No production jobs match the current filters</p>
            </div>
          )}
        </div>
      )}

      {/* Optional Detailed Form Spec */}
      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}
