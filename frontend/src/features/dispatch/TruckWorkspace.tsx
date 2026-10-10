import { useState, type ReactNode } from 'react';
import {
  Truck,
  Camera,
  UserRound,
  Package,
  CheckCircle2,
  ScanLine,
  ArrowRight,
  ClipboardCheck,
  CircleHelp,
  Phone,
  Clock,
  Navigation,
  Headset,
} from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Modal } from '../../components/ui/dialog';
import { Badge, Panel } from '../../components/shared/common';
import { PreviewButton } from '../../components/shared/PreviewButton';
import { TruckIllustration } from './TruckIllustration';
import { number, date } from '../../lib/utils';
import type { ShipmentView } from './DispatchPage';

type Detail = 'truck' | 'driver' | 'dispatcher';

const time = (value: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(value));

const initials = (name: string) =>
  name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

// Cargo bay names: A1, A2, A3, B1 ...
const slotName = (index: number) => `${String.fromCharCode(65 + Math.floor(index / 3))}${(index % 3) + 1}`;

export function TruckWorkspace({
  shipments,
  actions,
  onScan,
}: {
  shipments: ShipmentView[];
  actions?: (shipment: ShipmentView) => ReactNode;
  onScan?: (shipmentId: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rollId, setRollId] = useState<string | null>(null);

  const shipment =
    shipments.find((s) => s.id === selected) ??
    shipments.find((s) => s.status === 'DRAFT') ??
    shipments[0];

  if (!shipment) return null;

  const verified = shipment.rolls.filter((r) => r.verified).length;
  const toVerify = shipment.rolls.length - verified;
  const loadedMetres = shipment.rolls.filter((r) => r.verified).reduce((sum, r) => sum + Number(r.roll.length), 0);
  const roll = shipment.rolls.find((r) => r.id === rollId);
  const canScan = shipment.status === 'DRAFT' && !!onScan;
  const driver = shipment.driverName || 'Driver not recorded';
  const emptySlots = Math.max(0, 6 - shipment.rolls.length);

  const previews = {
    truck: (
      <>
        <strong><Truck size={17} />{shipment.transport}</strong>
        <p>{shipment.number} · {shipment.order.buyer.name}</p>
        <p>{number(shipment.quantity)} m · {verified}/{shipment.rolls.length} rolls loaded</p>
      </>
    ),
    driver: (
      <>
        <strong><UserRound size={17} />{driver}</strong>
        <p>{shipment.driverPhone || 'No phone number recorded'}</p>
        <p>Driving {shipment.transport}</p>
      </>
    ),
    camera: (
      <>
        <strong><Camera size={17} />Dock camera</strong>
        <p>{canScan ? 'Scan roll labels as they are loaded' : 'Scanning is closed for this shipment'}</p>
        <p>{toVerify} label{toVerify === 1 ? '' : 's'} still to scan</p>
      </>
    ),
    dispatcher: (
      <>
        <strong><Headset size={17} />{shipment.dispatcher ?? 'Dispatch desk'}</strong>
        <p>Created this shipment on {time(shipment.createdAt)}</p>
        <p>{shipment.events.length} recorded loading events</p>
      </>
    ),
  };

  return (
    <section className="logistics-workspace" aria-label="Truck and cargo operations">
      <div className="fleet-heading">
        <h2><Truck size={19} />Trucks</h2>
        <span>{shipments.length} shipments · hover for a quick look, click for details</span>
      </div>

      <div className="fleet-selector">
        {shipments.map((s) => (
          <PreviewButton
            key={s.id}
            label={`Select truck ${s.transport} for ${s.number}`}
            className={`fleet-item ${shipment.id === s.id ? 'selected' : ''}`}
            preview={
              <>
                <strong><Truck size={17} />{s.transport}</strong>
                <p>{s.number} · {s.order.buyer.name}</p>
                <p>{number(s.quantity)} m · {s.rolls.length} rolls · {s.driverName || 'no driver recorded'}</p>
              </>
            }
            onClick={() => {
              setSelected(s.id);
              setRollId(null);
            }}
          >
            <span className="entity-icon"><Truck size={21} /></span>
            <span>
              <strong>{s.transport}</strong>
              <small>{s.number} · {s.order.buyer.name}</small>
            </span>
            <Badge value={s.status} />
          </PreviewButton>
        ))}
      </div>

      <div className="dispatch-visual">
        <aside className="dispatch-sidebar">
          <Panel title="Truck information" subtitle={`${shipment.transport} · ${shipment.number}`}>
            <PreviewButton
              label={`Open driver ${driver}`}
              className="driver-card"
              preview={previews.driver}
              onClick={() => setDetail('driver')}
            >
              <span className="driver-info">
                <span className="driver-avatar">{shipment.driverName ? initials(shipment.driverName) : <UserRound size={16} />}</span>
                <span className="driver-text">
                  <strong>{driver}</strong>
                  <small>{shipment.driverPhone || 'Driver'}</small>
                </span>
              </span>
              <span className="icon-btn-circle" aria-hidden><Phone size={14} /></span>
            </PreviewButton>

            <div className="truck-meta-grid">
              <div className="truck-meta-item"><small>Truck no.</small><strong>{shipment.transport}</strong></div>
              <div className="truck-meta-item"><small>Created</small><strong>{time(shipment.createdAt)}</strong></div>
              <div className="truck-meta-item"><small>Status</small><strong><Badge value={shipment.status} /></strong></div>
            </div>

            <div className="route-banner">
              <div className="route-stop"><small>From</small><strong>Everest Textile Mills</strong></div>
              <div className="route-line-connector">
                <span className="route-direction-icon"><Navigation size={10} style={{ transform: 'rotate(90deg)' }} /></span>
              </div>
              <div className="route-stop" style={{ textAlign: 'right' }}>
                <small>To</small>
                <strong>{shipment.order.buyer.name}</strong>
                {shipment.order.buyer.city && <small>{shipment.order.buyer.city}</small>}
              </div>
            </div>

            <div className="dispatch-entity-actions">
              <PreviewButton label="Open truck details" className="entity-action" preview={previews.truck} onClick={() => setDetail('truck')}>
                <Truck size={19} />
                <span>Truck details<small>{shipment.transport}</small></span>
                <ArrowRight size={16} />
              </PreviewButton>

              <PreviewButton
                label="Open dock camera to scan roll labels"
                className="entity-action"
                preview={previews.camera}
                onClick={() => (canScan ? onScan(shipment.id) : setDetail('truck'))}
              >
                <Camera size={19} />
                <span>Dock camera<small>{canScan ? 'Scan roll labels' : 'Scanning closed'}</small></span>
                <ArrowRight size={16} />
              </PreviewButton>

              <PreviewButton label="Open dispatcher details" className="entity-action" preview={previews.dispatcher} onClick={() => setDetail('dispatcher')}>
                <Headset size={19} />
                <span>Dispatcher<small>{shipment.dispatcher ?? 'Dispatch desk'}</small></span>
                <ArrowRight size={16} />
              </PreviewButton>
            </div>
          </Panel>

          <Panel title="Loading progress" subtitle="Rolls scanned onto this truck">
            <div className="capacity-card-body">
              <div className="capacity-gauge-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[{ name: 'Loaded', value: verified }, { name: 'To scan', value: Math.max(toVerify, verified ? 0 : 1) }]}
                      innerRadius={32}
                      outerRadius={42}
                      startAngle={90}
                      endAngle={-270}
                      dataKey="value"
                      stroke="none"
                      isAnimationActive={false}
                    >
                      <Cell fill="#087f6b" />
                      <Cell fill="#dbe5df" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="capacity-gauge-center">
                  <strong>{verified}/{shipment.rolls.length}</strong>
                  <small>rolls</small>
                </div>
              </div>
              <div className="capacity-stats">
                <div className="capacity-stat-row"><small>Loaded</small><strong>{number(loadedMetres)} m</strong></div>
                <div className="capacity-stat-row"><small>Total cargo</small><strong>{number(shipment.quantity)} m</strong></div>
              </div>
            </div>
          </Panel>

          <Panel title="Loading activity" subtitle="Every step recorded for this truck">
            <div className="activity-log-list">
              {shipment.events.map((e) => (
                <div key={`${e.action}-${e.createdAt}`} className="activity-log-item">
                  <span className="activity-icon"><Clock size={13} /></span>
                  <div>
                    <strong>{time(e.createdAt)}</strong>
                    <p>{e.detail} · {e.actorName}</p>
                  </div>
                </div>
              ))}
              {!shipment.events.length && <p className="chart-empty-note">No loading events recorded yet.</p>}
            </div>
          </Panel>
        </aside>

        <Panel
          title="Cargo loading plan"
          subtitle={`${shipment.number} · ${number(shipment.quantity)} metres in ${shipment.rolls.length} rolls`}
          action={
            <Badge value={toVerify === 0 && verified > 0 ? 'READY' : 'PENDING'}>
              {toVerify === 0 && verified > 0 ? 'All labels scanned' : `${toVerify} label${toVerify === 1 ? '' : 's'} to scan`}
            </Badge>
          }
          className="cargo-panel"
        >
          <div className="truck-stage">
            <TruckIllustration />

            <PreviewButton label={`Open truck ${shipment.transport}`} className="truck-hotspot" onClick={() => setDetail('truck')} preview={previews.truck}>
              <Truck size={19} />
              <span>{shipment.transport}</span>
            </PreviewButton>

            <div className="truck-cargo-overlay" aria-label="Cargo bays">
              {shipment.rolls.map((r, i) => (
                <PreviewButton
                  key={r.id}
                  className={`cargo-slot ${r.verified ? 'verified' : ''}`}
                  label={`Open roll ${r.roll.code}`}
                  onClick={() => setRollId(r.id)}
                  preview={
                    <>
                      <strong><Package size={17} />{r.roll.code}</strong>
                      <p>{r.roll.fabric} · {r.roll.color}</p>
                      <p>{number(r.roll.length)} m · {r.verified ? 'Scanned and loaded' : 'Waiting to be scanned'}</p>
                    </>
                  }
                >
                  <div className="cargo-slot-top">
                    <span><span className={`cargo-slot-dot ${r.verified ? 'green' : 'amber'}`} /> {slotName(i)}</span>
                    {r.verified ? <CheckCircle2 size={15} /> : <ScanLine size={15} />}
                  </div>
                  <Package size={20} />
                  <strong>{r.roll.code}</strong>
                  <span>{number(r.roll.length)} m</span>
                </PreviewButton>
              ))}
              {Array.from({ length: emptySlots }).map((_, idx) => (
                <div key={`empty-${idx}`} className="cargo-slot-empty" title="Empty cargo bay">
                  <div className="cargo-slot-top"><span>{slotName(shipment.rolls.length + idx)}</span></div>
                  <small>Empty</small>
                </div>
              ))}
            </div>
          </div>

          <div className="cargo-key">
            <span><i className="key-verified" />Scanned and loaded</span>
            <span><i className="key-pending" />Waiting to be scanned</span>
            <span><CircleHelp size={14} />Hover a bay for a quick look, click for details</span>
          </div>

          <div className="dispatch-checklist">
            <div>
              <ClipboardCheck size={21} />
              <span>
                <strong>{verified} of {shipment.rolls.length} rolls scanned</strong>
                <small>
                  {shipment.status === 'CANCELLED'
                    ? 'Shipment cancelled. Rolls are back in stock.'
                    : shipment.status === 'DISPATCHED'
                      ? `Dispatched${shipment.confirmedAt ? ` on ${time(shipment.confirmedAt)}` : ''} and invoiced.`
                      : 'Scan every roll, then confirm the dispatch.'}
                </small>
              </span>
            </div>
            <div className="dispatch-primary-actions">{actions?.(shipment)}</div>
          </div>

          <div className="cargo-assign-section">
            <div className="cargo-assign-header">
              <h3>Rolls on this truck</h3>
              <span className="muted">Fabric, colour and length of each roll</span>
            </div>
            <div className="cargo-cards-grid">
              {shipment.rolls.map((r, i) => (
                <button key={r.id} type="button" className="cargo-assign-card" onClick={() => setRollId(r.id)}>
                  <div className="cargo-card-top">
                    <strong><Package size={16} />{r.roll.code}</strong>
                    <Badge value={r.verified ? 'PASSED' : 'PENDING'}>{r.verified ? 'Loaded' : 'To scan'}</Badge>
                  </div>
                  <dl className="cargo-card-details">
                    <div><dt>Fabric</dt><dd>{r.roll.fabric}</dd></div>
                    <div><dt>Colour</dt><dd>{r.roll.color}</dd></div>
                    <div><dt>Length</dt><dd>{number(r.roll.length)} m</dd></div>
                    <div><dt>Bay</dt><dd>{slotName(i)}</dd></div>
                  </dl>
                </button>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      {detail && (
        <Modal
          open
          onClose={() => setDetail(null)}
          title={detail === 'truck' ? `Truck ${shipment.transport}` : detail === 'driver' ? driver : shipment.dispatcher ?? 'Dispatch desk'}
          description={`${shipment.number} · ${shipment.order.buyer.name}`}
        >
          <dl className="detail-list">
            {detail === 'truck' && (
              <>
                <div><dt>Truck number</dt><dd>{shipment.transport}</dd></div>
                <div><dt>Driver</dt><dd>{driver}</dd></div>
                <div><dt>Order</dt><dd>{shipment.order.number}</dd></div>
                <div><dt>Cargo</dt><dd>{number(shipment.quantity)} m · {shipment.rolls.length} rolls</dd></div>
                <div><dt>Scanned</dt><dd>{verified} of {shipment.rolls.length} rolls</dd></div>
                <div><dt>Status</dt><dd><Badge value={shipment.status} /></dd></div>
                {shipment.invoice && <div><dt>Invoice</dt><dd>{shipment.invoice.number}</dd></div>}
              </>
            )}
            {detail === 'driver' && (
              <>
                <div><dt>Name</dt><dd>{driver}</dd></div>
                <div><dt>Phone</dt><dd>{shipment.driverPhone || 'Not recorded'}</dd></div>
                <div><dt>Truck</dt><dd>{shipment.transport}</dd></div>
                <div><dt>Delivering to</dt><dd>{shipment.order.buyer.name}</dd></div>
              </>
            )}
            {detail === 'dispatcher' && (
              <>
                <div><dt>Dispatcher</dt><dd>{shipment.dispatcher ?? 'Not recorded'}</dd></div>
                <div><dt>Shipment created</dt><dd>{date(shipment.createdAt)}</dd></div>
                <div><dt>Loading events</dt><dd>{shipment.events.length}</dd></div>
                <div><dt>Last update</dt><dd>{shipment.events[0] ? `${shipment.events[0].detail} · ${time(shipment.events[0].createdAt)}` : 'None yet'}</dd></div>
              </>
            )}
          </dl>
        </Modal>
      )}

      {roll && (
        <Modal open onClose={() => setRollId(null)} title={roll.roll.code} description={`On truck ${shipment.transport}`}>
          <dl className="detail-list">
            <div><dt>Fabric</dt><dd>{roll.roll.fabric}</dd></div>
            <div><dt>Colour</dt><dd>{roll.roll.color}</dd></div>
            <div><dt>Length</dt><dd>{number(roll.roll.length)} m</dd></div>
            <div><dt>Quality</dt><dd><Badge value={roll.roll.quality} /></dd></div>
            <div><dt>Loading</dt><dd>{roll.verified ? 'Scanned and loaded' : 'Waiting to be scanned'}</dd></div>
            <div><dt>Buyer</dt><dd>{shipment.order.buyer.name}</dd></div>
          </dl>
        </Modal>
      )}
    </section>
  );
}
