import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ScanLine, CheckCircle2, TriangleAlert, Layers, ArrowUpRight, RotateCcw, } from 'lucide-react';
import { can, defectChoices, type RollSummary, type PageResponse } from '@loomos/shared';
import { useAuth } from '../auth/Auth';
import { useData, useLookups } from '../../hooks/useFactory';
import { FilterBar, useFilters } from '../../components/shared/FilterBar';
import { reworkForm } from '../production/productionForms';
import { Button } from '../../components/ui/button';
import { ActionForm, type FormSpec } from '../../components/shared/ActionForm';
import { PageHeader, Panel, Loading, ErrorState, Badge, SearchBox, Kpi, } from '../../components/shared/common';
import { DataTable } from '../../components/tables/DataTable';
import { number, label } from '../../lib/utils';
import { ScanDialog } from './ScanDialog';
export { ScanDialog } from './ScanDialog';
export { RollPassportPage } from './RollPassportPage';
export function QualityPage({ finished = false }: {
    finished?: boolean;
}) {
    const filters = useFilters(['buyerId', 'source']);
    const lookups = useLookups();
    const query = useData<PageResponse<RollSummary>>(`/rolls?pageSize=100${filters.query ? `&${filters.query}` : ''}`);
    const { user } = useAuth();
    const [filter, setFilter] = useState('ALL');
    const [search, setSearch] = useState('');
    const [spec, setSpec] = useState<FormSpec | null>(null);
    const [scan, setScan] = useState(false);
    const navigate = useNavigate();
    if (query.isPending)
        return <Loading />;
    if (query.error)
        return <ErrorState error={query.error} retry={() => void query.refetch()}/>;
    const all = query.data!.data;
    const rows = all.filter((r) => (!finished || r.quality === 'PASSED') &&
        (filter === 'ALL' || r.quality === filter) &&
        `${r.code} ${r.production.fabric} ${r.production.number} ${r.production.order?.number ?? ''} ${r.production.order?.buyer.name ?? ''}`
            .toLowerCase()
            .includes(search.toLowerCase()));
    return (<>
      <PageHeader eyebrow={finished ? 'FINISHED GOODS WAREHOUSE' : 'QUALITY & TRACEABILITY'} title={finished ? 'Finished fabric rolls' : 'Quality inspection'} description={finished
            ? 'Find approved rolls, check availability and open their traceability records.'
            : 'Review inspection results, record defects and approve rolls for dispatch.'}>
        <Button variant="outline" onClick={() => setScan(true)}>
          <ScanLine size={17}/>
          Scan roll passport
        </Button>
      </PageHeader>

      {finished ? (
      <div className="kpi-grid">
        <Kpi label="On the shelf" value={number(all.filter((r) => r.quality === 'PASSED' && !r.activeShipmentId).reduce((s, r) => s + Number(r.length), 0))} unit="m" icon={<Layers size={19}/>} meta={`${all.filter((r) => r.quality === 'PASSED' && !r.activeShipmentId).length} rolls passed and not loaded`} accent/>
        <Kpi label="Loaded on trucks" value={number(all.filter((r) => r.activeShipmentId && r.location !== 'Dispatched' && r.location !== 'Delivered').reduce((s, r) => s + Number(r.length), 0))} unit="m" icon={<ShieldCheck size={19}/>} meta="Reserved for a shipment, not yet gone"/>
        <Kpi label="Gone out" value={number(all.filter((r) => ['Dispatched', 'Delivered'].includes(r.location)).reduce((s, r) => s + Number(r.length), 0))} unit="m" icon={<CheckCircle2 size={19}/>} meta={`${all.filter((r) => ['Dispatched', 'Delivered'].includes(r.location)).length} rolls dispatched or delivered`}/>
        <Kpi label="Finished stock" value={all.filter((r) => r.quality === 'PASSED' && !r.production.order && !r.activeShipmentId).length} unit="rolls" icon={<TriangleAlert size={19}/>} meta="Made for stock, free for any order"/>
      </div>
      ) : (
      <div className="kpi-grid">
        <Kpi label="Awaiting inspection" value={all.filter((r) => r.quality === 'PENDING').length} unit="rolls" icon={<ShieldCheck size={19}/>} meta="Ready for your quality team"/>
        <Kpi label="Quality approved" value={all.filter((r) => r.quality === 'PASSED').length} unit="rolls" icon={<CheckCircle2 size={19}/>} meta="Checked, recorded, and approved" accent/>
        <Kpi label="Needs rework" value={all.filter((r) => r.quality === 'REWORK').length} unit="rolls" icon={<TriangleAlert size={19}/>} meta="A second chance to get it right"/>
        <Kpi label="Available to ship" value={all.filter((r) => r.quality === 'PASSED' && !r.activeShipmentId).length} unit="rolls" icon={<Layers size={19}/>} meta="Unreserved finished inventory"/>
      </div>
      )}

      <Panel>
        <div className="table-toolbar">
          <div className="tabs">
            {(finished
            ? ['ALL']
            : ['ALL', 'PENDING', 'PASSED', 'REWORK', 'REJECTED']).map((t) => (<button className={filter === t ? 'active' : ''} onClick={() => setFilter(t)} key={t}>
                {t === 'ALL' ? 'All rolls' : label(t)}
              </button>))}
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="Find a roll, batch or order…"/>
        </div>
        <FilterBar filters={[
            { name: 'buyerId', label: 'Customer', options: (lookups.data?.buyers ?? []).map((b) => ({ value: b.id, label: b.name })) },
            { name: 'source', label: 'Made for', options: [{ value: 'ORDER', label: 'Customer orders' }, { value: 'STOCK', label: 'Finished stock' }] },
        ]} values={filters.values} onChange={filters.setValue} onClear={filters.clear} active={filters.active}/>

        <DataTable data={rows} columns={[
            {
                accessorKey: 'code',
                header: 'Fabric roll',
                cell: ({ row }) => (<button className="roll-link" onClick={() => navigate(`/rolls/${row.original.id}`)}>
                  <span className="roll-icon">
                    <Layers size={20}/>
                  </span>
                  <div className="cell-stack">
                    <strong>{row.original.code}</strong>
                    <span>{row.original.production.fabric}</span>
                  </div>
                </button>),
            },
            { accessorKey: 'production.color', header: 'Colour' },
            {
                id: 'order',
                header: 'Buyer order',
                cell: ({ row }) => row.original.production.order ? (<div className="cell-stack">
                  <strong>{row.original.production.order.number}</strong>
                  <span>{row.original.production.order.buyer.name}</span>
                </div>) : (<div className="cell-stack">
                  <strong>Finished stock</strong>
                  <span>{row.original.production.number}</span>
                </div>),
            },
            {
                accessorKey: 'length',
                header: 'Length',
                cell: ({ row }) => `${number(row.original.length)} m`,
            },
            {
                accessorKey: 'quality',
                header: 'Quality',
                cell: ({ row }) => <Badge value={row.original.quality}/>,
            },
            {
                accessorKey: 'location',
                header: 'Location',
                cell: ({ row }) => (<span className="muted">{row.original.location}</span>),
            },
            {
                id: 'actions',
                header: '',
                cell: ({ row }) => can(user.role, 'quality') && row.original.quality === 'PENDING' ? (<Button size="sm" variant="outline" onClick={() => setSpec({
                        title: `Inspect ${row.original.code}`,
                        description: 'Inspection records are permanent. Record the observed result and any defects.',
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
                                label: 'Defects found',
                                type: 'checkboxes',
                                required: false,
                                span: true,
                                options: defectChoices.map((d) => ({ value: d, label: d })),
                                hint: 'Tick every defect you saw. Rework and rejection need at least one.',
                            },
                            {
                                name: 'notes',
                                label: 'Inspection notes',
                                type: 'textarea',
                                required: false,
                                span: true,
                            },
                        ],
                        transform: (d) => {
                            const raw = d.defects as unknown;
                            const defects = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
                            return { ...d, defects };
                        },
                        submit: 'Save inspection',
                    })}>
                    <ShieldCheck size={14}/>
                    Inspect
                  </Button>) : row.original.quality === 'REWORK' && row.original.location.startsWith('Rework · back to') ? (<span className="muted">{row.original.location.replace('Rework · back', 'Back')}</span>) : can(user.role, 'quality') && row.original.quality === 'REWORK' ? (<div style={{ display: 'flex', gap: 6 }}>
                  <Button variant="outline" size="sm" title="Send the roll back to spinning, weaving or dyeing" onClick={() => setSpec(reworkForm(row.original.production, lookups.data?.recipes.find((r) => r.id === row.original.production.recipeId)?.route ?? ['SPINNING', 'WEAVING', 'DYEING'], lookups.data, { ids: [row.original.id], codes: [row.original.code] }))}>
                    <RotateCcw size={14}/>
                    Send back to stage
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setSpec({
                        title: 'Repair at rework bay',
                        description: 'Return this roll to the inspection queue. Previous inspections stay in its passport.',
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
                    })}>
                    Repair at bay
                  </Button>
                  </div>) : (<button className="icon-button" onClick={() => navigate(`/rolls/${row.original.id}`)} aria-label="View roll passport">
                    <ArrowUpRight size={17}/>
                  </button>),
            },
        ]}/>
      </Panel>

      {spec && <ActionForm spec={spec} onClose={() => setSpec(null)}/>}

      {scan && (<ScanDialog onClose={() => setScan(false)} onScan={(code) => {
                setScan(false);
                navigate(`/rolls/${encodeURIComponent(code)}`);
            }}/>)}
    </>);
}
