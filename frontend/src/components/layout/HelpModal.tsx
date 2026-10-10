import { Modal } from '../ui/dialog';

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

// A one-screen explanation of how work moves through the factory.
export function HelpModal({ open, onClose }: HelpModalProps) {
  const steps = [
    'Orders: a buyer places an order; the office confirms it and a production batch is planned.',
    'Shift: the supervisor checks workers in at the start of their shift.',
    'Production: the production manager assigns a machine and operator to each stage. The operator presses Start, records output, then Finish to hand over.',
    'Quality: inspect each roll. Failed rolls go back to a stage for rework or are repaired at the bay.',
    'Dispatch: load passed rolls, verify labels, confirm the truck, then mark it delivered.',
    'Accounts: invoices are raised on dispatch; record payments, expenses and claims.',
  ];

  return (
    <Modal open={open} onClose={onClose} title="How LoomOS works" description="Six steps from order to payment.">
      <div className="help-content">
        <div className="help-steps">
          {steps.map((s, i) => (
            <div key={s}>
              <span>{i + 1}</span>
              {s}
            </div>
          ))}
        </div>
        <p>
          If a machine breaks down, report it from the Machine floor: the job stops, the manager moves it to another
          machine (or maintenance confirms the repair) and the operator starts again. At shift change the supervisor
          hands a running machine to the incoming operator. Problems and rework are tracked on the Batches page.
        </p>
      </div>
    </Modal>
  );
}
