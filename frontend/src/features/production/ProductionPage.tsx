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
  Sparkles,
  Droplets,
  Layers,
} from 'lucide-react';
import type { JobSummary, PageResponse } from '@loomos/shared';
import { useData, useLookups, useAction } from '../../hooks/useFactory';
import { useAuth } from '../auth/Auth';
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

interface Job extends Omit<JobSummary, 'production'> {
  production: {
    number: string;
    item: {
      fabric: string;
      color: string;
      recipeId: string;
      order: { id: string; number: string; buyer: { name: string } };
    };
    reservations: {
      lotId: string;
      quantity: string;
      consumed: string;
      lot: { code: string };
    }[];
    jobs: { sequence: number }[];
  };
}

export function ProductionPage() {
  const query = useData<PageResponse<Job>>('/production?pageSize=100');
  const lookup = useLookups();
  const action = useAction();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Role detection
  const isOperator = [
    'OPERATOR',
    'SPINNING_OPERATOR',
    'WEAVING_OPERATOR',
    'DYEING_OPERATOR',
  ].includes(user.role);

  const defaultStage =
    user.role === 'SPINNING_OPERATOR'
      ? 'SPINNING'
      : user.role === 'WEAVING_OPERATOR'
      ? 'WEAVING'
      : user.role === 'DYEING_OPERATOR'
      ? 'DYEING'
      : 'ALL';

  const [stageFilter, setStageFilter] = useState<string>(defaultStage);
  const [search, setSearch] = useState('');
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [view, setView] = useState('Board');

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const allJobs = query.data!.data;
  const filteredJobs = allJobs
    .filter((j) =>
      stageFilter === 'ALL' ? true : j.stage === stageFilter
    )
    .filter((j) =>
      `${j.production.number} ${j.production.item.fabric} ${j.production.item.order.buyer.name}`
        .toLowerCase()
        .includes(search.toLowerCase())
    );

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
      description: `${job.production.number} · ${label(job.stage)}. Report actual work, including material consumed.`,
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

  const groups = [
    { title: 'Planned', statuses: ['PLANNED'], color: 'gray' },
    { title: 'Ready to run', statuses: ['READY', 'PAUSED'], color: 'amber' },
    { title: 'On the floor', statuses: ['IN_PROGRESS', 'BLOCKED'], color: 'green' },
    { title: 'Completed', statuses: ['COMPLETED'], color: 'blue' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="MANUFACTURING WORKSPACE"
        title="From yarn to something great."
        description="Plan the work. Connect the stages. Keep the floor moving."
      >
        <Button variant="outline" onClick={() => navigate('/machines')}>
          <Factory size={16} />
          Machine floor
        </Button>
        {!isOperator && (
          <Button onClick={() => navigate('/orders')}>
            <Plus size={16} />
            Plan from an order
          </Button>
        )}
      </PageHeader>

      {/* Operator role banner */}
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
              <strong style={{ fontSize: '0.875rem' }}>
                {label(user.role)} Console
              </strong>
              <span style={{ fontSize: '0.8125rem', color: 'var(--muted)', marginLeft: '0.5rem' }}>
                {user.departmentName ? `${user.departmentName} Department` : 'Floor Assigned'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            {['ALL', 'SPINNING', 'WEAVING', 'DYEING'].map((stg) => (
              <button
                key={stg}
                onClick={() => setStageFilter(stg)}
                style={{
                  padding: '3px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: stageFilter === stg ? 'var(--accent)' : 'transparent',
                  color: stageFilter === stg ? '#fff' : 'var(--text-secondary)',
                  fontSize: '0.75rem',
                  fontWeight: stageFilter === stg ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {stg === 'ALL' ? 'All Stages' : label(stg)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="production-toolbar">
        <div className="segmented-control">
          {['Board', 'List'].map((t) => (
            <button
              key={t}
              className={view === t ? 'active' : ''}
              onClick={() => setView(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Find a work order…"
        />
        <span className="muted">
          {filteredJobs.length} stage jobs · Operator-reported
        </span>
      </div>

      <div className={view === 'Board' ? 'kanban-board' : 'job-list'}>
        {groups.map((group) => (
          <section className="kanban-column" key={group.title}>
            <div className="kanban-heading">
              <span className={`tiny-dot ${group.color}`} />
              <h2>{group.title}</h2>
              <span>
                {filteredJobs.filter((j) => group.statuses.includes(j.status)).length}
              </span>
            </div>
            <div className="kanban-cards">
              {filteredJobs
                .filter((j) => group.statuses.includes(j.status))
                .map((job) => (
                  <article
                    className={`job-card ${job.status === 'BLOCKED' ? 'job-blocked' : ''}`}
                    key={job.id}
                  >
                    <div className="job-card-top">
                      <span>{job.production.number}</span>
                      <Badge value={job.stage} />
                    </div>
                    <h3>{job.production.item.fabric}</h3>
                    <p>
                      {job.production.item.order.buyer.name} <span>·</span>{' '}
                      {job.production.item.color}
                    </p>
                    <Progress
                      value={(Number(job.output) / Number(job.target)) * 100}
                    />
                    <div className="job-quantity">
                      <strong>
                        {number(job.output)}{' '}
                        <small>/ {number(job.target)} m</small>
                      </strong>
                      <span>
                        {Math.round((Number(job.output) / Number(job.target)) * 100)}%
                      </span>
                    </div>
                    <div className="job-meta">
                      <span>
                        <Factory size={14} />
                        {job.machine?.code ?? 'Machine unassigned'}
                      </span>
                      <span>
                        <UserRound size={14} />
                        {job.worker?.name ?? 'Operator unassigned'}
                      </span>
                    </div>
                    {job.status === 'BLOCKED' && (
                      <div className="job-warning">
                        Machine unavailable. Recover or reassign to continue.
                      </div>
                    )}
                    <div className="job-card-actions">
                      {['READY', 'PAUSED', 'BLOCKED'].includes(job.status) &&
                        !isOperator && (
                          <Button size="sm" onClick={() => start(job)}>
                            <Play size={13} />
                            Assign & start
                          </Button>
                        )}
                      {job.status === 'IN_PROGRESS' && (
                        <>
                          <Button size="sm" onClick={() => output(job)}>
                            <Plus size={13} />
                            Record output
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            title="Pause job"
                            onClick={() =>
                              action.mutate({ path: `/production/jobs/${job.id}/pause` })
                            }
                          >
                            <Pause size={14} />
                          </Button>
                          {Number(job.output) >= Number(job.target) && (
                            <Button
                              size="icon"
                              variant="outline"
                              title="Complete stage"
                              onClick={() =>
                                action.mutate({
                                  path: `/production/jobs/${job.id}/complete`,
                                })
                              }
                            >
                              <Check size={14} />
                            </Button>
                          )}
                        </>
                      )}
                      {job.status === 'PLANNED' && (
                        <span className="muted text-xs">
                          <Clock size={12} />
                          Waiting for previous stage
                        </span>
                      )}
                      {job.status === 'COMPLETED' && (
                        <span className="green-text text-xs">
                          <Check size={13} />
                          Stage complete
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              {!filteredJobs.some((j) => group.statuses.includes(j.status)) && (
                <div className="kanban-empty">
                  <ClipboardList size={21} />
                  <p>No jobs in this stage</p>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}
    </>
  );
}
