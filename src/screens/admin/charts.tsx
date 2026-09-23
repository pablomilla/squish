/**
 * The dashboard's charts: drawn here in SVG rather than with a library, for
 * the same reason the privacy page has its own markdown renderer — three
 * shapes do not need a dependency.
 *
 * The rules they follow (docs: the dataviz notes in admin.css):
 *   - Colour follows the thing, in a fixed order: meal analyses, nutritionist,
 *     recipes. A single series is the brand colour and needs no legend.
 *   - Thin marks: 2px lines, bars no wider than 24px with a rounded data end,
 *     a 2px gap between stacked pieces, a quiet grid.
 *   - Every chart can be hovered (or stepped through with the arrow keys) for
 *     exact values, and every chart can be read as a table instead.
 *   - Text is always in the ink colours, never the series colour.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';

export interface Series {
  key: string;
  label: string;
  color: string;
}

interface ChartProps {
  /** Names the chart for a screen reader and heads the table. */
  title: string;
  /** One per column: days as yyyy-mm-dd, or months as yyyy-mm. */
  labels: string[];
  series: Series[];
  /** values[column][series] */
  values: number[][];
  kind: 'line' | 'bars' | 'stacked';
  format: (value: number) => string;
  /** Short form for the axis. */
  axisFormat?: (value: number) => string;
  xFormat: (label: string) => string;
  /** The label in the tooltip, where it wants more than the axis does. */
  xLong?: (label: string) => string;
  height?: number;
  /** Columns to call out as not over yet, drawn hatched in the first series' colour. */
  partial?: (label: string) => boolean;
}

const PAD = { top: 12, right: 8, bottom: 26, left: 48 };

/** Round numbers for the axis: 0 and up to four steps of 1, 2 or 5 × 10ⁿ. */
function ticks(min: number, max: number): number[] {
  const span = max - min || 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 4) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** A bar with its data end rounded: the top for a positive value, the bottom for a negative one. */
function barPath(x: number, w: number, from: number, to: number, round: boolean): string {
  const h = Math.abs(to - from);
  if (h < 0.5) return '';
  const r = round ? Math.min(4, w / 2, h) : 0;
  if (to <= from) {
    // Upward: `to` is the top.
    return `M${x},${from}V${to + r}Q${x},${to} ${x + r},${to}H${x + w - r}Q${x + w},${to} ${x + w},${to + r}V${from}Z`;
  }
  return `M${x},${from}V${to - r}Q${x},${to} ${x + r},${to}H${x + w - r}Q${x + w},${to} ${x + w},${to - r}V${from}Z`;
}

/** An element's width, kept up to date. A callback ref, so it follows the element when the table view swaps it out. */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width];
}

export function Chart(props: ChartProps) {
  const { title, labels, series, values, kind, format, xFormat, xLong = xFormat, height = 190, partial } = props;
  const axisFormat = props.axisFormat ?? format;
  const [box, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const hatch = useId().replace(/:/g, '');

  const n = labels.length;
  const totals = values.map((row) => (kind === 'stacked' ? row.reduce((s, v) => s + v, 0) : Math.max(...row)));
  const lows = values.map((row) => (kind === 'stacked' ? 0 : Math.min(...row)));
  const ys = ticks(Math.min(0, ...lows), Math.max(0, ...totals, kind === 'line' ? 1 : 0.0001));
  const yMin = ys[0];
  const yMax = ys[ys.length - 1];

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
  // Bars sit in bands; a line runs edge to edge.
  const band = n > 0 ? plotW / n : 0;
  const xCenter = (i: number) => (kind === 'line' ? PAD.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2) : PAD.left + band * (i + 0.5));
  const barW = Math.max(1, Math.min(24, band * 0.72));

  const pick = useCallback(
    (clientX: number, rect: DOMRect) => {
      const x = clientX - rect.left - PAD.left;
      const i = kind === 'line' ? Math.round((x / (plotW || 1)) * (n - 1)) : Math.floor(x / (band || 1));
      setAt(Math.max(0, Math.min(n - 1, i)));
    },
    [kind, plotW, n, band],
  );

  const onMove = (event: PointerEvent<SVGSVGElement>) => pick(event.clientX, event.currentTarget.getBoundingClientRect());
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') setAt((i) => Math.min(n - 1, (i ?? -1) + 1));
    else if (event.key === 'ArrowLeft') setAt((i) => Math.max(0, (i ?? n) - 1));
    else if (event.key === 'Escape') setAt(null);
    else return;
    event.preventDefault();
  };

  // Label every few columns so they never collide: about one per 70px.
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 70))));
  const zero = y(0);

  return (
    <div className="chart">
      <div className="chart-top">
        {series.length > 1 ? (
          <ul className="chart-legend" aria-label="Key">
            {series.map((s) => (
              <li key={s.key}>
                <span className="chart-swatch" style={{ background: s.color }} />
                {s.label}
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        <button type="button" className="chart-toggle tiny" aria-pressed={table} onClick={() => setTable((t) => !t)}>
          {table ? 'Chart' : 'Table'}
        </button>
      </div>

      {table ? (
        <div className="chart-table-wrap">
          <table className="chart-table">
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                <th scope="col" />
                {series.map((s) => (
                  <th scope="col" key={s.key}>
                    {s.label}
                  </th>
                ))}
                {kind === 'stacked' && <th scope="col">Total</th>}
              </tr>
            </thead>
            <tbody>
              {labels
                .map((label, i) => ({ label, i }))
                .reverse()
                .map(({ label, i }) => (
                  <tr key={label}>
                    <th scope="row">{xLong(label)}</th>
                    {series.map((s, k) => (
                      <td key={s.key}>{format(values[i][k])}</td>
                    ))}
                    {kind === 'stacked' && <td>{format(totals[i])}</td>}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-plot" ref={box} style={{ height }}>
          {width > 0 && (
            <svg
              width={width}
              height={height}
              role="img"
              aria-label={`${title}. Use the arrow keys for each value, or switch to the table.`}
              tabIndex={0}
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setAt(null)}
              onKeyDown={onKey}
              onBlur={() => setAt(null)}
            >
              <defs>
                <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" style={{ fill: 'var(--surface)' }} />
                  <rect width="3" height="6" style={{ fill: series[0]?.color }} />
                </pattern>
              </defs>

              {ys.map((v) => (
                <g key={v}>
                  <line
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={y(v)}
                    y2={y(v)}
                    className={v === 0 ? 'chart-zero' : 'chart-grid'}
                  />
                  <text x={PAD.left - 8} y={y(v)} className="chart-axis" textAnchor="end" dominantBaseline="middle">
                    {axisFormat(v)}
                  </text>
                </g>
              ))}

              {labels.map((label, i) =>
                i % every === 0 || (i === n - 1 && (n - 1) % every > every / 2) ? (
                  <text key={label} x={xCenter(i)} y={height - 8} className="chart-axis" textAnchor="middle">
                    {xFormat(label)}
                  </text>
                ) : null,
              )}

              {kind === 'line' &&
                series.map((s, k) => {
                  const points = values.map((row, i) => `${xCenter(i).toFixed(1)},${y(row[k]).toFixed(1)}`);
                  return (
                    <g key={s.key}>
                      {series.length === 1 && (
                        <path
                          d={`M${xCenter(0)},${zero}L${points.join('L')}L${xCenter(n - 1)},${zero}Z`}
                          style={{ fill: s.color }}
                          className="chart-area"
                        />
                      )}
                      <path d={`M${points.join('L')}`} style={{ stroke: s.color }} className="chart-line" />
                    </g>
                  );
                })}

              {kind !== 'line' &&
                values.map((row, i) => {
                  const x = xCenter(i) - barW / 2;
                  const faded = at !== null && at !== i;
                  const hatched = partial?.(labels[i]);
                  if (kind === 'bars') {
                    return row.map((v, k) => (
                      <path
                        key={`${labels[i]}-${k}`}
                        d={barPath(x, barW, zero, y(v), true)}
                        style={{ fill: hatched ? `url(#${hatch})` : series[k].color }}
                        className={faded ? 'chart-bar chart-bar--faded' : 'chart-bar'}
                      />
                    ));
                  }
                  // Stacked: a 2px gap between pieces, so they read as pieces, and
                  // only the top one rounded.
                  let base = 0;
                  const shown = row.map((v, k) => (v > 0 ? k : -1)).filter((k) => k >= 0);
                  return row.map((v, k) => {
                    if (v <= 0) return null;
                    const bottom = y(base) - (k === shown[0] ? 0 : 1);
                    base += v;
                    const top = y(base) + (k === shown[shown.length - 1] ? 0 : 1);
                    if (bottom - top < 0.5) return null;
                    return (
                      <path
                        key={`${labels[i]}-${k}`}
                        d={barPath(x, barW, bottom, top, k === shown[shown.length - 1])}
                        style={{ fill: series[k].color }}
                        className={faded ? 'chart-bar chart-bar--faded' : 'chart-bar'}
                      />
                    );
                  });
                })}

              {at !== null && kind === 'line' && (
                <g pointerEvents="none">
                  <line x1={xCenter(at)} x2={xCenter(at)} y1={PAD.top} y2={PAD.top + plotH} className="chart-cross" />
                  {series.map((s, k) => (
                    <circle key={s.key} cx={xCenter(at)} cy={y(values[at][k])} r={4.5} style={{ fill: s.color }} className="chart-dot" />
                  ))}
                </g>
              )}
            </svg>
          )}

          {at !== null && width > 0 && (
            <div
              className="chart-tip"
              role="status"
              // Beside the column, on whichever side has the room, so it never
              // hides the one being read.
              style={
                xCenter(at) > width / 2
                  ? { left: xCenter(at) - 14, top: PAD.top, transform: 'translateX(-100%)' }
                  : { left: xCenter(at) + 14, top: PAD.top }
              }
            >
              <b>{xLong(labels[at])}</b>
              {partial?.(labels[at]) && <span className="muted"> · so far</span>}
              {series.map((s, k) => (
                <div key={s.key} className="chart-tip-row">
                  {series.length > 1 && <span className="chart-swatch" style={{ background: s.color }} />}
                  <span className="muted">{s.label}</span>
                  <b>{format(values[at][k])}</b>
                </div>
              ))}
              {kind === 'stacked' && series.length > 1 && (
                <div className="chart-tip-row chart-tip-total">
                  <span className="muted">Total</span>
                  <b>{format(totals[at])}</b>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A tile's little trend line: no axes, no hover — the tile's number is the reading. */
export function Sparkline({ values, color = 'var(--dv-single)' }: { values: number[]; color?: string }) {
  const w = 120;
  const h = 32;
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`);
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`M0,${h}L${pts.join('L')}L${w},${h}Z`} style={{ fill: color }} className="chart-area" />
      <path d={`M${pts.join('L')}`} style={{ stroke: color }} className="chart-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A share of a whole, as one bar split into pieces, with the numbers written beside it. */
export function SplitBar({ parts, label }: { parts: { key: string; label: string; value: number; color: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="split">
      <div className="split-bar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.value}`).join(', ')}`}>
        {total === 0 ? (
          <span className="split-empty" />
        ) : (
          parts
            .filter((p) => p.value > 0)
            .map((p) => <span key={p.key} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${p.value}`} />)
        )}
      </div>
      <ul className="chart-legend split-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className="chart-swatch" style={{ background: p.color }} />
            {p.label} <b>{p.value.toLocaleString('en-GB')}</b>
            {total > 0 && <span className="muted"> · {Math.round((p.value / total) * 100)}%</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Steps where people fall away, each as a bar of the first, with the drop written in. */
export function Funnel({ steps }: { steps: { label: string; value: number; note?: string }[] }) {
  const first = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ol className="funnel">
      {steps.map((step, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        return (
          <li key={step.label}>
            <div className="funnel-text">
              <span className="small">{step.label}</span>
              <b className="small">{step.value.toLocaleString('en-GB')}</b>
            </div>
            <div className="funnel-track">
              <span style={{ width: `${Math.max(step.value > 0 ? 1.5 : 0, (step.value / first) * 100)}%` }} />
            </div>
            <p className="tiny muted">
              {prev !== null && prev > 0 ? `${Math.round((step.value / prev) * 100)}% of the step before` : step.note ?? ' '}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** Re-run `load` every `seconds` while the page is visible, and when it comes back into view. */
export function useEvery(load: () => void, seconds: number): void {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = window.setInterval(tick, seconds * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load, seconds]);
}
