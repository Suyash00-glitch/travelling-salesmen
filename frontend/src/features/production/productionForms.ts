import { defectTypes, issueTypes, productionPurposes, type Lookups } from '@loomos/shared';
import type { FormSpec } from '../../components/shared/ActionForm';
import { label, number } from '../../lib/utils';

// Form definitions for production actions, shared by the floor board, the batch page and quality.
// Each one posts straight to the matching API endpoint. Who may open a form is decided by the
// screen (permissions); what is allowed is checked again by the server.

const options = (values: readonly string[]) => values.map((v) => ({ value: v, label: label(v) }));

const machineOptions = (lookups: Lookups | undefined, stage?: string, idleOnly = false) =>
  (lookups?.machines ?? [])
    .filter((m) => !stage || m.type === stage)
    .filter((m) => !idleOnly || m.status === 'IDLE')
    .map((m) => ({ value: m.id, label: `${String(m.code)} · ${m.name}${m.status !== 'IDLE' ? ` (${label(String(m.status))})` : ''}` }));

// Workers who may run a machine: same department as the machine (or as the stage's machines), or no department set.
const workerOptions = (lookups: Lookups | undefined, machineId?: string | null, stage?: string) => {
  const machines = (lookups?.machines ?? []).filter((m) => (machineId ? m.id === machineId : stage ? m.type === stage : false));
  const departments = new Set(machines.map((m) => m.departmentId).filter(Boolean));
  return (lookups?.workers ?? [])
    .filter((w) => !departments.size || !w.departmentId || departments.has(w.departmentId))
    .map((w) => ({ value: w.id, label: `${w.name}${w.designation ? ` · ${String(w.designation)}` : ''}` }));
};

interface JobLike { id: string; stage: string; status: string; machineId: string | null; workerId: string | null; target?: string; output?: string; sequence?: number }

// Step 1 of running a stage: the production manager chooses the machine and the operator. Nothing starts yet.
export function assignForm(job: JobLike, batchNumber: string, lookups: Lookups | undefined): FormSpec {
  const stopped = ['PAUSED', 'BLOCKED'].includes(job.status);
  return {
    title: stopped ? `Move ${label(job.stage).toLowerCase()} for ${batchNumber}` : `Assign ${label(job.stage).toLowerCase()} for ${batchNumber}`,
    description: stopped
      ? 'Pick the machine and operator that will continue this work, then press Start production on the card.'
      : 'Pick an idle machine and the operator who will run it, then press Start production on the card.',
    path: `/production/jobs/${job.id}/assign`,
    fields: [
      { name: 'machineId', label: 'Machine', type: 'select', value: job.machineId ?? '', options: machineOptions(lookups, job.stage, true) },
      { name: 'workerId', label: 'Operator', type: 'select', value: job.workerId ?? '', options: workerOptions(lookups, undefined, job.stage), hint: 'Only workers from this stage department are listed' },
      ...(stopped || job.machineId ? [{ name: 'reason', label: 'Reason for the change', required: false, span: true, hint: 'e.g. breakdown, operator on leave' }] : []),
    ],
    submit: 'Save assignment',
  };
}

// Shift change: the supervisor hands the job to the incoming operator. The machine stays the same.
export function handoverForm(job: JobLike & { workerName?: string | null; machineCode?: string | null }, batchNumber: string, lookups: Lookups | undefined): FormSpec {
  return {
    title: `Hand over ${batchNumber} · ${label(job.stage).toLowerCase()}`,
    description: `${job.workerName ?? 'The current operator'} stops; the new operator continues on ${job.machineCode ?? 'the same machine'}. The new operator must already be checked in.`,
    path: `/production/jobs/${job.id}/handover`,
    fields: [
      { name: 'workerId', label: 'Incoming operator', type: 'select', options: workerOptions(lookups, job.machineId).filter((w) => w.value !== job.workerId) },
      { name: 'reason', label: 'Note', required: false, span: true, hint: 'e.g. evening shift takes over' },
    ],
    submit: 'Hand over',
  };
}

// Output recorded while the job keeps running.
export function outputForm(job: JobLike & { production: { number: string; recipeId: string; reservations: { lotId: string; quantity: string; consumed: string; lot: { code: string } }[]; jobs: { sequence: number }[] } }, lookups: Lookups | undefined): FormSpec {
  const last = job.sequence === Math.max(...job.production.jobs.map((j) => j.sequence));
  const recipe = lookups?.recipes.find((r) => r.id === job.production.recipeId);
  const remaining = Math.max(0, Number(job.target) - Number(job.output));
  const suggested = Math.min(200, remaining);
  return {
    title: 'Record output',
    description: `${job.production.number} · ${label(job.stage)} · ${number(remaining)} m still to make`,
    path: `/production/jobs/${job.id}/output`,
    fields: outputFields(job.sequence === 0, last, suggested, remaining, recipe, job.production.reservations),
    transform: (d) => ({ ...d, consumedKg: Number(d.consumedKg ?? 0), rollLengths: last && d.rolls ? String(d.rolls).split(',').map(Number) : [] }),
    submit: 'Save output',
  };
}

// Finishing the stage: confirm the final output of this run, then the batch moves to the next team.
export function finishForm(job: JobLike & { production: { number: string; recipeId: string; reservations: { lotId: string; quantity: string; consumed: string; lot: { code: string } }[]; jobs: { sequence: number }[] } }, nextStage: string | undefined, lookups: Lookups | undefined): FormSpec {
  const last = job.sequence === Math.max(...job.production.jobs.map((j) => j.sequence));
  const recipe = lookups?.recipes.find((r) => r.id === job.production.recipeId);
  const remaining = Math.max(0, Number(job.target) - Number(job.output));
  return {
    title: `Finish ${label(job.stage).toLowerCase()} · ${job.production.number}`,
    description: `${number(job.output)} of ${number(job.target)} m recorded so far. Enter what this run made (0 if everything is already recorded). ${nextStage ? `The batch then goes to ${label(nextStage).toLowerCase()}.` : 'The rolls then go to quality check.'}`,
    path: `/production/jobs/${job.id}/complete`,
    fields: outputFields(job.sequence === 0, last, remaining, remaining, recipe, job.production.reservations, true),
    transform: (d) => ({ ...d, consumedKg: Number(d.consumedKg ?? 0), rollLengths: last && d.rolls ? String(d.rolls).split(',').filter(Boolean).map(Number) : [] }),
    submit: nextStage ? `Finish · send to ${label(nextStage).toLowerCase()}` : 'Finish · send to quality',
  };
}

function outputFields(
  firstStage: boolean,
  last: boolean,
  suggested: number,
  remaining: number,
  recipe: { kgPerMetre: string } | undefined,
  reservations: { lotId: string; quantity: string; consumed: string; lot: { code: string } }[],
  finishing = false,
) {
  return [
    { name: 'quantity', label: finishing ? 'Output of this run (metres)' : 'Output (metres)', type: 'number' as const, min: finishing ? 0 : 0.001, value: suggested, hint: finishing && remaining > 0 ? `${number(remaining)} m still planned. Less than that is recorded as a shortfall.` : undefined },
    { name: 'hours', label: 'Machine run hours', type: 'number' as const, min: 0, max: 24, value: 2 },
    { name: 'waste', label: 'Wastage (metres)', type: 'number' as const, min: 0, value: 0 },
    ...(firstStage
      ? [
          {
            name: 'lotId',
            label: 'Yarn lot used',
            type: 'select' as const,
            required: false,
            options: reservations.map((r) => ({ value: r.lotId, label: `${r.lot.code} · ${number(Number(r.quantity) - Number(r.consumed), 2)} kg reserved` })),
          },
          { name: 'consumedKg', label: 'Yarn used (kg)', type: 'number' as const, min: 0, required: false, value: Math.round(Number(recipe?.kgPerMetre ?? 0.2) * suggested * 1000) / 1000, hint: 'Leave 0 to use the recipe standard' },
        ]
      : []),
    ...(last
      ? [{ name: 'rolls', label: 'Roll lengths (metres, comma separated)', value: suggested ? String(suggested) : '', required: false, hint: 'Must add up to the output. Leave empty for standard 200 m rolls.', span: true }]
      : []),
  ];
}

export function reworkForm(
  batch: { id: string; number: string },
  stages: string[],
  lookups: Lookups | undefined,
  rolls?: { ids: string[]; codes: string[] },
  defaultStage?: string,
): FormSpec {
  return {
    title: `Send ${batch.number} back for rework`,
    description: rolls?.ids.length
      ? `Roll ${rolls.codes.join(', ')} will go back to the chosen stage, then return to quality check.`
      : 'The batch goes back to the chosen stage. Every stage after it runs again.',
    path: `/production/batches/${batch.id}/rework`,
    fields: [
      { name: 'returnStage', label: 'Send back to', type: 'select', options: options(stages), value: defaultStage ?? stages[stages.length - 1] },
      { name: 'defectType', label: 'Problem type', type: 'select', options: options(defectTypes) },
      { name: 'reason', label: 'What is wrong?', type: 'textarea', span: true, hint: 'For example: shade variation on the left selvedge' },
      { name: 'machineId', label: 'Machine for the rework', type: 'select', required: false, options: machineOptions(lookups), hint: 'Optional · must match the stage' },
      { name: 'workerId', label: 'Assign to operator', type: 'select', required: false, options: workerOptions(lookups) },
    ],
    transform: (d) => ({ ...d, rollIds: rolls?.ids ?? [] }),
    submit: 'Send back for rework',
  };
}

export function issueForm(batch: { id: string; number: string }, jobId?: string): FormSpec {
  return {
    title: `Report a problem on ${batch.number}`,
    description: 'The production manager is notified straight away.',
    path: `/production/batches/${batch.id}/issues`,
    fields: [
      { name: 'type', label: 'Problem', type: 'select', options: options(issueTypes) },
      { name: 'description', label: 'What happened?', type: 'textarea', span: true },
      {
        name: 'holdJob',
        label: 'Stop the running stage?',
        type: 'select',
        options: [
          { value: '', label: 'No, keep working' },
          { value: 'true', label: 'Yes, put it on hold' },
        ],
        required: false,
      },
    ],
    transform: (d) => ({ ...d, jobId, holdJob: d.holdJob === 'true' }),
    submit: 'Report problem',
  };
}

export function resolveIssueForm(issue: { id: string; type: string }): FormSpec {
  return {
    title: `Resolve: ${label(issue.type)}`,
    description: 'Write down what was done so the next shift knows.',
    path: `/production/issues/${issue.id}/resolve`,
    fields: [{ name: 'resolution', label: 'Action taken', type: 'textarea', span: true }],
    submit: 'Mark resolved',
  };
}

export function cancelBatchForm(batch: { id: string; number: string }): FormSpec {
  return {
    title: `Cancel ${batch.number}`,
    description: 'Unfinished stages stop and reserved yarn goes back to the store. This cannot be undone.',
    path: `/production/batches/${batch.id}/cancel`,
    fields: [{ name: 'reason', label: 'Reason for cancelling', type: 'textarea', span: true }],
    submit: 'Cancel batch',
  };
}

export function replacementForm(batch: { id: string; number: string; target: string }): FormSpec {
  return {
    title: `Replacement for ${batch.number}`,
    description: 'Creates a new batch for the same fabric (and the same customer order, if any).',
    path: `/production/batches/${batch.id}/replacement`,
    fields: [
      { name: 'quantity', label: 'Quantity (metres)', type: 'number', min: 0.001, value: Number(batch.target) },
      { name: 'reason', label: 'Why is a replacement needed?', type: 'textarea', span: true },
    ],
    submit: 'Create replacement batch',
  };
}

export function cancelReworkForm(rework: { id: string }): FormSpec {
  return {
    title: 'Cancel rework',
    description: 'Only possible before the floor has started the rework.',
    path: `/production/reworks/${rework.id}/cancel`,
    fields: [{ name: 'reason', label: 'Reason', type: 'textarea', span: true }],
    submit: 'Cancel rework',
  };
}

export function standaloneBatchForm(lookups: Lookups | undefined): FormSpec {
  return {
    title: 'New production batch',
    description: 'Production without a customer order: for stock, internal use, replacement or urgent needs.',
    path: '/production/batches',
    fields: [
      { name: 'recipeId', label: 'Fabric', type: 'select', options: (lookups?.recipes ?? []).map((r) => ({ value: r.id, label: `${r.name} · ${r.specification}` })) },
      { name: 'color', label: 'Colour' },
      { name: 'quantity', label: 'Quantity (metres)', type: 'number', min: 0.001 },
      { name: 'purpose', label: 'Purpose', type: 'select', options: options(productionPurposes), value: 'STOCK' },
      { name: 'priority', label: 'Priority', type: 'select', options: options(['NORMAL', 'HIGH', 'URGENT']), value: 'NORMAL' },
      { name: 'dueDate', label: 'Due date', type: 'date', required: false },
      {
        name: 'stageChoice',
        label: 'Stages',
        type: 'select',
        required: false,
        options: [
          { value: '', label: 'All stages of the recipe' },
          { value: 'SPINNING,WEAVING', label: 'Spinning and weaving only (no dyeing)' },
          { value: 'WEAVING,DYEING', label: 'Weaving and dyeing (yarn already spun)' },
          { value: 'DYEING', label: 'Dyeing only' },
        ],
      },
      { name: 'spinningMachineId', label: 'Spinning machine', type: 'select', required: false, options: machineOptions(lookups, 'SPINNING') },
      { name: 'weavingMachineId', label: 'Weaving machine', type: 'select', required: false, options: machineOptions(lookups, 'WEAVING') },
      { name: 'dyeingMachineId', label: 'Dyeing machine', type: 'select', required: false, options: machineOptions(lookups, 'DYEING') },
      { name: 'workerId', label: 'First-stage operator', type: 'select', required: false, options: workerOptions(lookups) },
      { name: 'notes', label: 'Notes', type: 'textarea', required: false, span: true },
    ],
    transform: ({ stageChoice, ...d }) => ({ ...d, stages: stageChoice ? stageChoice.split(',') : undefined }),
    submit: 'Create batch',
  };
}
