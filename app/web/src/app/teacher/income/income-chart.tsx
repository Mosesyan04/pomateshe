import type { IncomeChartPoint } from "../../../server/income";

const BAR_WIDTH = 14;
const BAR_GAP = 4;
const BAR_RADIUS = 3;
const PLOT_HEIGHT = 140;
const AXIS_LABEL_HEIGHT = 24;
const VALUE_LABEL_HEIGHT = 20;
const ACCENT = "#4f46e5"; // docs/DESIGN_SYSTEM.md's brand indigo — reused, not reinvented

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("ru-RU", { minimumFractionDigits: 0 }) + " ₽";
}

function formatShortDate(dateStr: string): string {
  const [, month, day] = dateStr.split("-");
  return `${day}.${month}`;
}

/** Rounded-top, square-bottom bar — SVG <rect> only supports uniform corner radii, so the
 *  shape is drawn as a path instead (dataviz skill: "4px rounded data-end, square at the
 *  baseline"). Falls back to a plain rect when too short for the radius to render sensibly. */
function roundedTopBarPath(x: number, baselineY: number, width: number, height: number, radius: number): string {
  if (height <= 0) return "";
  const r = Math.min(radius, width / 2, height);
  const top = baselineY - height;
  return `M${x},${baselineY} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} L${x + width},${baselineY} Z`;
}

/**
 * Server-rendered, plain SVG — no client JS, no charting library (the project has none and
 * this is a small internal reporting page, not a case for adding one). Hover detail comes from
 * a native <title> per bar; the same numbers are also always in the table below the chart
 * (dataviz skill: a tooltip must enhance, never gate — this chart's "gate-free" fallback is
 * that full table, not a custom tooltip layer this app's stack doesn't otherwise have).
 */
export function IncomeChart({ points }: { points: IncomeChartPoint[] }) {
  if (points.length === 0) return null;

  const maxCents = Math.max(1, ...points.map((p) => p.paidCents));
  const slot = BAR_WIDTH + BAR_GAP;
  const width = points.length * slot + BAR_GAP;
  const height = PLOT_HEIGHT + AXIS_LABEL_HEIGHT + VALUE_LABEL_HEIGHT;
  const baselineY = VALUE_LABEL_HEIGHT + PLOT_HEIGHT;

  // Label at most ~8 bars on the x-axis (dataviz skill: label selectively, never every point).
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        role="img"
        aria-label="Оплаченный доход по дням"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {/* Gridlines: 0 and max, hairline, recessive. */}
        <line x1={0} y1={baselineY} x2={width} y2={baselineY} stroke="#ddd" strokeWidth={1} />
        <line x1={0} y1={VALUE_LABEL_HEIGHT} x2={width} y2={VALUE_LABEL_HEIGHT} stroke="#eee" strokeWidth={1} />
        <text x={0} y={VALUE_LABEL_HEIGHT - 4} fontSize={10} fill="#666">
          {formatMoney(maxCents)}
        </text>

        {points.map((p, i) => {
          const x = BAR_GAP + i * slot;
          const barHeight = (p.paidCents / maxCents) * PLOT_HEIGHT;
          const path = roundedTopBarPath(x, baselineY, BAR_WIDTH, barHeight, BAR_RADIUS);
          return (
            <g key={p.date}>
              {path && <path d={path} fill={ACCENT}>
                <title>{`${formatShortDate(p.date)}: ${formatMoney(p.paidCents)}`}</title>
              </path>}
              {i % labelEvery === 0 && (
                <text
                  x={x + BAR_WIDTH / 2}
                  y={baselineY + AXIS_LABEL_HEIGHT - 8}
                  fontSize={10}
                  fill="#666"
                  textAnchor="middle"
                >
                  {formatShortDate(p.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
