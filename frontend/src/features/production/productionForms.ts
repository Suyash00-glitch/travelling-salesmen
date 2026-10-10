import { defectTypes, issueTypes, productionPurposes, type Lookups } from '@loomos/shared';
import type { FormSpec } from '../../components/shared/ActionForm';
import { label } from '../../lib/utils';

// Form definitions for production actions, shared by the batch manager, the floor board
// and the quality page. Each one posts straight to the matching API endpoint.

const options = (values: readonly string[]) => values.map((v) => ({ value: v, label: label(v) }));

const machineOptions = (lookups: Lookups | undefined, stage?: string, idleOnly = false) =>
  (lookups?.machines ?? [])
    .filter((m) => !stage || m.type === stage)
    .filter((m) => !idleOnly || m.status === 'IDLE')
    .map((m) => ({ value: m.id, label: `${String(m.code)} · ${m.name}${m.status !== 'IDLE' ? ` (${label(String(m.status))})` : ''}` }));

const workerOptions = (lookups: Lookups | undefined) =>
  (lookups?.workers ?? []).map((w) => ({ value: w.id, label: w.name }));

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
      { name: 'workerId', label: 'Assign to worker', type: 'select', required: false, options: workerOptions(lookups) },
    ],
    transform: (d) => ({ ...d, rollIds: rolls?.ids ?? [] }),
    submit: 'Send back for rework',
  };
}

export function issueForm(batch: { id: string; number: string }, jobId?: string): FormSpec {
  return {
    title: `Report a problem on ${batch.number}`,
    description: 'Managers and supervisors are notified straight away.',
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

export function reassignForm(job: { id: string; stage: string }, batchNumber: string, lookups: Lookups | undefined): FormSpec {
  return {
    title: `Move ${label(job.stage).toLowerCase()} for ${batchNumber}`,
    description: 'Pick a new machine, a new worker, or both. Running work moves immediately.',
    path: `/production/jobs/${job.id}/reassign`,
    fields: [
      { name: 'machineId', label: 'New machine', type: 'select', required: false, options: machineOptions(lookups, job.stage, true) },
      { name: 'workerId', label: 'New worker', type: 'select', required: false, options: workerOptions(lookups) },
      { name: 'reason', label: 'Reason', span: true, hint: 'For example: machine breakdown, worker on leave' },
    ],
    submit: 'Reassign',
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
      { name: 'workerId', label: 'First-stage worker', type: 'select', required: false, options: workerOptions(lookups) },
      { name: 'notes', label: 'Notes', type: 'textarea', required: false, span: true },
    ],
    transform: ({ stageChoice, ...d }) => ({ ...d, stages: stageChoice ? stageChoice.split(',') : undefined }),
    submit: 'Create batch',
  };
}
