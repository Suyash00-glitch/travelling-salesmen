import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  Layers,
  ArrowLeft,
  Download,
  Factory,
  ShieldCheck,
} from 'lucide-react';
import { useData } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  Badge,
  Empty,
} from '../../components/shared/common';
import { number, date, label } from '../../lib/utils';

interface Passport {
  id: string;
  code: string;
  length: string;
  quality: string;
  location: string;
  fabric: string;
  color: string;
  order: string;
  buyer: string;
  createdAt: string;
  inspections: {
    id: string;
    result: string;
    inspector: string;
    defects: string[];
    notes: string;
    createdAt: string;
  }[];
  stages: {
    stage: string;
    status: string;
    machine?: string;
    output: string;
  }[];
  lots: {
    code: string;
    material: string;
    supplier: string;
    quantity: string;
  }[];
  shipments: {
    number: string;
    status: string;
    transport: string;
  }[];
}

export function RollPassportPage() {
  const { id } = useParams();
  const query = useData<Passport>(`/rolls/${id}`);
  const [qr, setQr] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (query.data) {
      void QRCode.toDataURL(`${window.location.origin}/rolls/${query.data.id}`, {
        width: 240,
        margin: 2,
        color: { dark: '#184e40', light: '#ffffff' },
      }).then(setQr);
    }
  }, [query.data]);

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const r = query.data!;

  return (
    <>
      <button className="back-link" onClick={() => navigate(-1)}>
        <ArrowLeft size={15} />
        Back
      </button>

      <PageHeader
        eyebrow="DIGITAL ROLL PASSPORT"
        title={r.code}
        description={`${r.fabric} · ${r.color}`}
      >
        <Badge value={r.quality} />
        <Button variant="outline" onClick={() => window.print()}>
          <Download size={16} />
          Print passport
        </Button>
      </PageHeader>

      <div className="passport-layout">
        <Panel className="passport-card">
          <span className="eyebrow">WOVEN AT EVEREST TEXTILE MILLS</span>
          <div className="passport-fabric">
            <Layers size={56} />
          </div>
          <h2>{r.code}</h2>
          <p>{r.fabric}</p>
          <strong>
            {number(r.length)} <small>metres</small>
          </strong>
          {qr && <img src={qr} alt={`QR passport for ${r.code}`} width={160} height={160} />}
          <small>Scan to follow this roll’s journey</small>
          <Badge value={r.quality} />
        </Panel>

        <div>
          <Panel
            title="From yarn to finished fabric"
            subtitle="A complete, connected production history"
          >
            <div className="passport-stages">
              {r.stages.map((s, i) => (
                <div key={i}>
                  <span className="stage-circle done">
                    <Factory size={19} />
                  </span>
                  <div>
                    <h3>{label(s.stage)}</h3>
                    <p>
                      {s.machine ?? 'Unassigned'} · {number(s.output)} m recorded
                    </p>
                  </div>
                  <Badge value={s.status} />
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Material origins" className="mt-5">
            <div className="ledger">
              {r.lots.map((l, i) => (
                <div key={i}>
                  <div>
                    <strong>
                      {l.code} · {l.material}
                    </strong>
                    <small>{l.supplier}</small>
                  </div>
                  <span>{number(l.quantity, 2)} kg</span>
                </div>
              ))}
              {!r.lots.length && (
                <p className="muted">
                  Material details are available to authorized factory staff.
                </p>
              )}
            </div>
          </Panel>

          <Panel
            title="Quality history"
            subtitle="Original inspections are always preserved"
            className="mt-5"
          >
            <div className="inspection-timeline">
              {r.inspections.map((i) => (
                <div key={i.id}>
                  <span className="inspection-icon">
                    <ShieldCheck size={20} />
                  </span>
                  <div>
                    <Badge value={i.result} />
                    <p>{i.defects.join(', ') || 'Passed all recorded checks'}</p>
                    <small>
                      {i.notes} · {i.inspector} · {date(i.createdAt)}
                    </small>
                  </div>
                </div>
              ))}
              {!r.inspections.length && (
                <Empty
                  title="Ready for a closer look"
                  description="This roll is awaiting its first inspection."
                />
              )}
            </div>
          </Panel>

          <Panel title="Order & delivery" className="mt-5">
            <dl className="detail-list">
              <div>
                <dt>Buyer order</dt>
                <dd>{r.order}</dd>
              </div>
              <div>
                <dt>Buyer</dt>
                <dd>{r.buyer}</dd>
              </div>
              <div>
                <dt>Current location</dt>
                <dd>{r.location}</dd>
              </div>
              {r.shipments.map((s) => (
                <div key={s.number}>
                  <dt>{s.number}</dt>
                  <dd>
                    {label(s.status)} · {s.transport}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
