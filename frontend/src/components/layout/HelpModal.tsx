import { Modal } from '../ui/dialog';

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function HelpModal({ open, onClose }: HelpModalProps) {
  const steps = [
    'Receive & reserve yarn',
    'Plan and record production',
    'Inspect and trace fabric rolls',
    'Verify dispatch and track payments',
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Welcome to LoomOS"
      description="Your entire mill, beautifully connected."
    >
      <div className="help-content">
        <p>
          Start with an order, plan its production route, then reserve yarn. Assign an
          available machine and worker to begin each stage.
        </p>
        <div className="help-steps">
          {steps.map((s, i) => (
            <div key={s}>
              <span>{i + 1}</span>
              {s}
            </div>
          ))}
        </div>
        <p>
          Machine statuses are entered by your team. Live updates share committed
          changes across authorized dashboards.
        </p>
        <small>
          Everest Textile Mills · INR · Asia/Kolkata
          <br />
          Demo data is stored locally. This workspace does not connect to physical
          machines.
        </small>
      </div>
    </Modal>
  );
}
