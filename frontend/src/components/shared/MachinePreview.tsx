import { Droplets, Layers, Sparkles, UserRound, Factory } from 'lucide-react';
import type { MachineSummary } from '@loomos/shared';
import { label, number } from '../../lib/utils';

// One recognisable icon per machine type, used everywhere machines appear.
export function MachineIcon({ type, size = 20 }: { type: string; size?: number }) {
  if (type === 'SPINNING') return <Sparkles size={size} />;
  if (type === 'WEAVING') return <Layers size={size} />;
  if (type === 'DYEING') return <Droplets size={size} />;
  return <Factory size={size} />;
}

// Quick-look card shown on hover or keyboard focus.
export function MachinePreview({ machine }: { machine: MachineSummary }) {
  const job = machine.jobs[0];
  return (
    <>
      <strong>
        <MachineIcon type={machine.type} size={17} />
        {machine.code} · {machine.name}
      </strong>
      <p>
        {label(machine.type)} · {label(machine.status)} · {number(machine.todayOutput)} m today
      </p>
      <p>
        {job?.production
          ? `Working on ${job.production.number}`
          : machine.downtime.find((d) => !d.endedAt)?.reason ?? 'No job on this machine'}
      </p>
      {job?.worker && (
        <p>
          <UserRound size={13} /> {job.worker.name}
        </p>
      )}
    </>
  );
}
