import { useState } from "react";
import type { Distribution } from "./engine/templates/accuracy";

const W = 640, H = 200, PAD = { top: 12, right: 12, bottom: 34, left: 44 };
const INSIDE = "#3b82f6";
const OUTSIDE = "#dc2626";
const formatValue = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 });

/** Histogram of a number column with the usual range marked; bars outside it are the flagged values. */
export function DistributionDetail({ distribution, column }: { distribution: Distribution; column: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const { bins } = distribution;
  const max = Math.max(...bins.map((b) => b.count), 1);
  const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom;
  const step = plotW / bins.length;
  const y = (count: number) => PAD.top + plotH - (count / max) * plotH;
  // Bounds are positioned on the bins' own (possibly logarithmic) scale.
  const positionOf = (value: number) => {
    const i = bins.findIndex((b) => value >= b.from && value <= b.to);
    if (i < 0) return value < bins[0].from ? PAD.left : PAD.left + plotW;
    const b = bins[i];
    const within = distribution.scale === "log" ? (Math.log10(value) - Math.log10(b.from)) / (Math.log10(b.to) - Math.log10(b.from)) : (value - b.from) / (b.to - b.from || 1);
    return PAD.left + (i + within) * step;
  };
  const active = hover !== null ? bins[hover] : null;

  return (
    <figure className="dq-dist">
      <figcaption className="dq-dist-legend">
        <span><i style={{ background: INSIDE }} /> Within the usual range</span>
        <span><i style={{ background: OUTSIDE }} /> Outside — flagged</span>
        <span className="muted">{distribution.scale === "log" ? "Logarithmic scale" : "Linear scale"}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Distribution of ${column}: usual range ${formatValue(distribution.lower)} to ${formatValue(distribution.upper)}`} onMouseLeave={() => setHover(null)}>
        <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="#cbd5e1" />
        <text x={PAD.left - 6} y={PAD.top + 4} textAnchor="end" className="dq-dist-axis">{max.toLocaleString()}</text>
        <text x={PAD.left - 6} y={PAD.top + plotH} textAnchor="end" className="dq-dist-axis">0</text>
        {bins.map((b, i) => {
          const x = PAD.left + i * step + 1;
          const top = y(b.count);
          const height = PAD.top + plotH - top;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={PAD.left + i * step} y={PAD.top} width={step} height={plotH} fill="transparent" />
              {b.count ? <path d={roundedTop(x, top, Math.max(step - 2, 1), Math.max(height, 1.5))} fill={b.outside ? OUTSIDE : INSIDE} opacity={hover === null || hover === i ? 1 : 0.55} /> : null}
            </g>
          );
        })}
        {[distribution.lower, distribution.upper].map((bound, i) => {
          const x = positionOf(bound);
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={PAD.top} y2={PAD.top + plotH} stroke="#475569" strokeDasharray="4 3" />
              <text x={x} y={H - 18} textAnchor="middle" className="dq-dist-axis">{formatValue(bound)}</text>
            </g>
          );
        })}
        {/* Data extent, unless a bound label already sits at that edge. */}
        {positionOf(distribution.lower) - PAD.left > 40 ? <text x={PAD.left} y={H - 4} className="dq-dist-axis">{formatValue(bins[0].from)}</text> : null}
        {W - PAD.right - positionOf(distribution.upper) > 40 ? <text x={W - PAD.right} y={H - 4} textAnchor="end" className="dq-dist-axis">{formatValue(bins[bins.length - 1].to)}</text> : null}
      </svg>
      <p className="muted dq-hint dq-dist-readout">
        {active ? `${formatValue(active.from)} – ${formatValue(active.to)}: ${active.count.toLocaleString()} value${active.count === 1 ? "" : "s"}${active.outside ? " (outside the usual range)" : ""}` : "Hover a bar to see its range and count. Dashed lines mark the usual range."}
      </p>
    </figure>
  );
}

/** Bar with 4px rounded top corners anchored on the baseline. */
function roundedTop(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
