/**
 * FactoryInsights — shared chart components for factory dashboards.
 * Provides StatusDonut, BreakdownBars, and the FactoryInsights summary panel,
 * plus helpers (chartColors, groupCounts) for building chart data.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartNoAxesCombined, CircleDot } from 'lucide-react';
import type { Dashboard } from '@loomos/shared';
import { Panel } from './common';
import { number, label } from '../../lib/utils';

export const chartColors = [
  '#087f6b',
  '#bf8014',
  '#b83940',
  '#406ea0',
  '#7056a3',
  '#596b64',
];

export interface ChartItem {
  name: string;
  value: number;
  color?: string;
}

// One colour per meaning, used by every chart: green = done/good, blue = moving,
// amber = waiting, purple = rework, red = problem, grey = not started.
const statusColors: Record<string, string> = {
  PASSED: '#087f6b', RUNNING: '#087f6b', COMPLETED: '#087f6b', PRESENT: '#087f6b', RECEIVED: '#087f6b', PAID: '#087f6b',
  IN_PROGRESS: '#3567a3', IN_PRODUCTION: '#3567a3', DISPATCHED: '#3567a3', QUALITY: '#3567a3',
  PENDING: '#b7791f', READY: '#b7791f', IDLE: '#b7791f', PARTIAL: '#b7791f', DRAFT: '#b7791f', PENDING_REVIEW: '#b7791f', OPEN: '#b7791f',
  REWORK: '#7056a3', LEAVE: '#7056a3', PAUSED: '#7056a3',
  REJECTED: '#b83940', BREAKDOWN: '#b83940', BLOCKED: '#b83940', ABSENT: '#b83940', CANCELLED: '#b83940', VOID: '#b83940',
  PLANNED: '#5b6b64', NOT_RECORDED: '#5b6b64', ORDERED: '#5b6b64', CONFIRMED: '#5b6b64',
};

export const statusColor = (status: string) => statusColors[status] ?? '#5b6b64';

export function groupCounts(values: string[]): ChartItem[] {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts].map(([name, value]) => ({ name: label(name), value, color: statusColor(name) }));
}

export function StatusDonut({
  title,
  description,
  items,
  unit = 'records',
  onSelect,
}: {
  title: string;
  description: string;
  items: ChartItem[];
  unit?: string;
  onSelect?: (name: string) => void;
}) {
  const safeItems = items.map((item) => ({
    ...item,
    value: Math.max(0, Number(item.value) || 0),
  }));
  const total = safeItems.reduce((sum, item) => sum + item.value, 0);

  return (
    <Panel
      title={title}
      subtitle={description}
      action={<CircleDot size={19} className="panel-symbol" />}
    >
      <div className="insight-body">
        <div
          className="donut-visual"
          role="img"
          aria-label={safeItems.map((i) => `${i.name}: ${number(i.value)} ${unit}`).join(', ')}
        >
          {total > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={safeItems}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={59}
                  outerRadius={78}
                  paddingAngle={2}
                  stroke="none"
                >
                  {safeItems.map((item, i) => (
                    <Cell
                      key={item.name}
                      fill={item.color ?? chartColors[i % chartColors.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) =>
                    `${number(Number(value), Number(value) % 1 ? 1 : 0)} ${unit}`
                  }
                  contentStyle={{
                    borderRadius: 12,
                    borderColor: '#cfdcd6',
                    color: '#172d27',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="donut-empty" />
          )}
          <div className="donut-total">
            <strong>{number(total, total % 1 ? 1 : 0)}</strong>
            <span>{unit}</span>
          </div>
        </div>

        <div className="insight-legend">
          {safeItems.map((item, i) => {
            const content = (
              <>
                <i
                  style={{
                    background: item.color ?? chartColors[i % chartColors.length],
                  }}
                />
                <span>{item.name}</span>
                <strong>{number(item.value, item.value % 1 ? 1 : 0)}</strong>
                <small>{total ? Math.round((item.value / total) * 100) : 0}%</small>
              </>
            );
            return onSelect ? (
              <button
                key={item.name}
                onClick={() => onSelect(item.name)}
                aria-label={`Show ${item.name}`}
              >
                {content}
              </button>
            ) : (
              <div key={item.name}>{content}</div>
            );
          })}
          {!total && <p className="chart-empty-note">No records to display yet.</p>}
        </div>
      </div>
    </Panel>
  );
}

export function BreakdownBars({
  title,
  description,
  items,
  unit = 'm',
}: {
  title: string;
  description: string;
  items: ChartItem[];
  unit?: string;
}) {
  const maxValue = Math.max(1, ...items.map((i) => i.value));

  return (
    <Panel
      title={title}
      subtitle={description}
      action={<ChartNoAxesCombined size={19} className="panel-symbol" />}
    >
      <div
        className="breakdown-bars"
        role="img"
        aria-label={items.map((item) => `${item.name}: ${number(item.value)} ${unit}`).join(', ')}
      >
        {items.length ? (
          items.map((item, i) => (
            <div className="breakdown-row" key={item.name}>
              <div>
                <span>{item.name}</span>
                <strong>
                  {number(item.value, item.value % 1 ? 1 : 0)} <small>{unit}</small>
                </strong>
              </div>
              <div className="breakdown-track">
                <span
                  style={{
                    width: `${(Math.max(0, item.value) / maxValue) * 100}%`,
                    background: item.color ?? chartColors[i % chartColors.length],
                  }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="chart-empty-note">No records to compare yet.</p>
        )}
      </div>
    </Panel>
  );
}

export function FactoryInsights({
  data,
  report = false,
}: {
  data: Dashboard;
  report?: boolean;
}) {
  return (
    <div className="insights-grid">
      <StatusDonut
        title="Machine availability"
        description="Current reported state"
        unit="machines"
        items={[
          { name: 'Running', value: data.running },
          { name: 'Idle', value: data.idle },
          { name: 'Breakdown', value: data.breakdown },
          {
            name: 'Other',
            value: Math.max(
              0,
              data.totalMachines - data.running - data.idle - data.breakdown
            ),
          },
        ]}
      />
      <StatusDonut
        title="Roll quality"
        description="Current inspection results"
        unit="rolls"
        items={[
          { name: 'Passed', value: data.passed },
          { name: 'Awaiting inspection', value: data.pendingQuality },
          { name: 'Rejected', value: data.rejected },
        ]}
      />
      {report && (
        <Panel
          title="Production by day"
          subtitle="Reported stage throughput in metres · last 7 days"
        >
          <div className="report-bars">
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={data.series}>
                <CartesianGrid vertical={false} stroke="#e1e8e4" />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#40594f', fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#40594f', fontSize: 12 }}
                />
                <Tooltip />
                <Bar
                  isAnimationActive={false}
                  dataKey="output"
                  name="Output (m)"
                  fill="#087f6b"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}
    </div>
  );
}
