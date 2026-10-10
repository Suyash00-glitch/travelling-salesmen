import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  ScanLine,
  CheckCircle2,
  TriangleAlert,
  Layers,
  ArrowUpRight,
} from 'lucide-react';
import { can, type RollSummary, type PageResponse } from '@loomos/shared';
import { useAuth } from '../auth/Auth';
import { useData } from '../../hooks/useFactory';
import { Button } from '../../components/ui/button';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import {
  PageHeader,
  Panel,
  Loading,
  ErrorState,
  Badge,
  SearchBox,
  Kpi,
} from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { number, label } from '../../lib/utils';
import { ScanDialog } from './ScanDialog';

export { ScanDialog } from './ScanDialog';
export { RollPassportPage } from './RollPassportPage';

export function QualityPage({ finished = false }: { finished?: boolean }) {
  const query = useData<PageResponse<RollSummary>>('/rolls?pageSize=100');
  const { user } = useAuth();
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [spec, setSpec] = useState<FormSpec | null>(null);
  const [scan, setScan] = useState(false);
  const navigate = useNavigate();

  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const all = query.data!.data;
  const rows = all.filter(
    (r) =>
      (!finished || r.quality === 'PASSED') &&
      (filter === 'ALL' || r.quality === filter) &&
      `${r.code} ${r.production.item.fabric} ${r.production.item.order.number}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        eyebrow={finished ? 'FINISHED GOODS WAREHOUSE' : 'QUALITY & TRACEABILITY'}
        title={finished ? 'Every roll has a story.' : 'Quality in every thread.'}
        description={
          finished
            ? 'Trace its journey. Know its status. Ship with confidence.'
            : 'Inspect with care. Keep a clear record from the loom to the buyer.'
        }
      >
        <Button variant="outline" onClick={() => setScan(true)}>
          <ScanLine size={17} />
          Scan roll passport
        </Button>
      </PageHeader>

      <div className="kpi-grid">
        <Kpi
          label="Awaiting inspection"
          value={all.filter((r) => r.quality === 'PENDING').length}
          unit="rolls"
          icon={<ShieldCheck size={19} />}
          meta="Ready for your quality team"
        />
        <Kpi
          label="Quality approved"
          value={all.filter((r) => r.quality === 'PASSED').length}
          unit="rolls"
          icon={<CheckCircle2 size={19} />}
          meta="Checked, recorded, and approved"
          accent
        />
        <Kpi
          label="Needs rework"
          value={all.filter((r) => r.quality === 'REWORK').length}
          unit="rolls"
          icon={<TriangleAlert size={19} />}
          meta="A second chance to get it right"
        />
        <Kpi
          label="Available to ship"
          value={all.filter((r) => r.quality === 'PASSED' && !r.activeShipmentId).length}
          unit="rolls"
          icon={<Layers size={19} />}
          meta="Unreserved finished inventory"
        />
      </div>

      <Panel>
        <div className="table-toolbar">
          <div className="tabs">
            {(finished
              ? ['ALL']
              : ['ALL', 'PENDING', 'PASSED', 'REWORK', 'REJECTED']
            ).map((t) => (
              <button
                className={filter === t ? 'active' : ''}
                onClick={() => setFilter(t)}
                key={t}
              >
                {t === 'ALL' ? 'All rolls' : label(t)}
              </button>
            ))}
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="Find a roll or order…" />
        </div>

        <DataTable
          data={rows}
          columns={[
            {
              accessorKey: 'code',
              header: 'Fabric roll',
              cell: ({ row }) => (
                <button
                  className="roll-link"
                  onClick={() => navigate(`/rolls/${row.original.id}`)}
                >
                  <span className="roll-icon">
                    <Layers size={20} />
                  </span>
                  <div className="cell-stack">
                    <strong>{row.original.code}</strong>
                    <span>{row.original.production.item.fabric}</span>
                  </div>
                </button>
              ),
            },
            { accessorKey: 'production.item.color', header: 'Colour' },
            {
              accessorKey: 'production.item.order.number',
              header: 'Buyer order',
              cell: ({ row }) => (
                <div className="cell-stack">
                  <strong>{row.original.production.item.order.number}</strong>
                  <span>{row.original.production.item.order.buyer.name}</span>
                </div>
              ),
            },
            {
              accessorKey: 'length',
              header: 'Length',
              cell: ({ row }) => `${number(row.original.length)} m`,
            },
            {
              accessorKey: 'quality',
              header: 'Quality',
              cell: ({ row }) => <Badge value={row.original.quality} />,
            },
            {
              accessorKey: 'location',
              header: 'Location',
              cell: ({ row }) => (
                <span className="muted">
                  {row.original.activeShipmentId
                    ? 'Reserved / dispatched'
                    : row.original.location}
                </span>
              ),
            },
            {
              id: 'actions',
              header: '',
              cell: ({ row }) =>
                can(user.role, 'quality') && row.original.quality === 'PENDING' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSpec({
                        title: `Inspect ${row.original.code}`,
                        description:
                          'Inspection records are permanent. Record the observed result and any defects.',
                        path: `/rolls/${row.original.id}/inspections`,
                        fields: [
                          {
                            name: 'result',
                            label: 'Inspection result',
                            type: 'select',
                            options: [
                              {
                                value: 'PASSED',
                                label: 'Passed — ready for finished stock',
                              },
                              { value: 'REWORK', label: 'Rework required' },
                              { value: 'REJECTED', label: 'Rejected' },
                            ],
                          },
                          {
                            name: 'defects',
                            label: 'Defects (comma separated)',
                            required: false,
                            hint: 'Examples: holes, colour mismatch, uneven weaving',
                          },
                          {
                            name: 'notes',
                            label: 'Inspection notes',
                            type: 'textarea',
                            required: false,
                            span: true,
                          },
                        ],
                        transform: (d) => ({
                          ...d,
                          defects: d.defects
                            .split(',')
                            .map((s: string) => s.trim())
                            .filter(Boolean),
                        }),
                        submit: 'Save inspection',
                      })
                    }
                  >
                    <ShieldCheck size={14} />
                    Inspect
                  </Button>
                ) : can(user.role, 'quality') && row.original.quality === 'REWORK' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSpec({
                        title: 'Complete rework',
                        description:
                          'Return this roll to the inspection queue. Previous inspections stay in its passport.',
                        path: `/rolls/${row.original.id}/rework`,
                        fields: [
                          {
                            name: 'cost',
                            label: 'Rework cost (₹)',
                            type: 'number',
                            min: 0,
                            value: 0,
                          },
                          {
                            name: 'notes',
                            label: 'Work performed',
                            type: 'textarea',
                            span: true,
                          },
                        ],
                        submit: 'Send for reinspection',
                      })
                    }
                  >
                    Complete rework
                  </Button>
                ) : (
                  <button
                    className="icon-button"
                    onClick={() => navigate(`/rolls/${row.original.id}`)}
                    aria-label="View roll passport"
                  >
                    <ArrowUpRight size={17} />
                  </button>
                ),
            },
          ]}
        />
      </Panel>

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)} />}

      {scan && (
        <ScanDialog
          onClose={() => setScan(false)}
          onScan={(code) => {
            setScan(false);
            navigate(`/rolls/${encodeURIComponent(code)}`);
          }}
        />
      )}
    </>
  );
}
