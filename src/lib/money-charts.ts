// Pure chart builders for the money tools. No DOM access; each function
// returns an HTML string the tool injects. Everything is solid colors and
// hairlines on purpose: no gradients, no glow, no brand hues.

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export interface HBar {
  label: string;
  /** Right-hand caption, e.g. "$32.50 of $40.00". */
  caption: string;
  /** Fill width as 0-100. */
  pct: number;
  /** Marker position as 0-100; drawn as a thin tick on the track. */
  markerPct?: number;
  /** True when this row is over budget (renders the fill red). */
  over?: boolean;
}

/**
 * Horizontal bars on a shared scale. Each row: label row on top, track
 * below with the fill and an optional marker tick.
 */
export function hbarChart(rows: HBar[]): string {
  const html = rows
    .map((r) => {
      const pct = Math.max(0, Math.min(100, r.pct));
      const marker =
        r.markerPct === undefined
          ? ''
          : `<span class="hbar-marker" style="left:${Math.max(0, Math.min(100, r.markerPct)).toFixed(2)}%"></span>`;
      return `<div class="hbar-row">
        <div class="hbar-top"><span class="hbar-label">${esc(r.label)}</span><span class="hbar-cap">${esc(r.caption)}</span></div>
        <div class="hbar-track" role="img" aria-label="${esc(`${r.label}: ${r.caption}`)}">
          <span class="hbar-fill${r.over ? ' over' : ''}" style="width:${pct.toFixed(2)}%"></span>${marker}
        </div>
      </div>`;
    })
    .join('');
  return `<div class="hbars">${html}</div>`;
}

export interface TrendPoint {
  /** Short x-axis label, e.g. "Sep". */
  label: string;
  incomeCents: number;
  spentCents: number;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09" -> "Sep 26". Anything else passes through unchanged. */
export function shortMonthLabel(key: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (!m) return key;
  return `${SHORT_MONTHS[parseInt(m[2], 10) - 1]} ${m[1].slice(2)}`;
}

/**
 * A compact two-line SVG chart: solid line for income, dashed for spending.
 * Needs at least two points; renders nothing for fewer.
 */
export function trendSvg(points: TrendPoint[], formatDollars: (cents: number) => string): string {
  if (points.length < 2) return '';
  const W = 560;
  const H = 220;
  const PAD_L = 52;
  const PAD_R = 12;
  const PAD_T = 14;
  const PAD_B = 30;
  const iw = W - PAD_L - PAD_R;
  const ih = H - PAD_T - PAD_B;
  const max = Math.max(1, ...points.map((p) => Math.max(p.incomeCents, p.spentCents)));
  const x = (i: number) => PAD_L + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD_T + ih - (v / max) * ih;
  const line = (get: (p: TrendPoint) => number) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(get(p)).toFixed(1)}`).join(' ');
  // Three gridlines with dollar labels.
  let grid = '';
  for (let g = 0; g <= 2; g++) {
    const v = (max * g) / 2;
    const gy = y(v).toFixed(1);
    grid += `<line x1="${PAD_L}" y1="${gy}" x2="${W - PAD_R}" y2="${gy}" class="trend-grid"/>` +
      `<text x="${PAD_L - 6}" y="${Number(gy) + 4}" text-anchor="end" class="trend-axis">${esc(formatDollars(Math.round(v)))}</text>`;
  }
  const dots = (get: (p: TrendPoint) => number, cls: string) =>
    points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(get(p)).toFixed(1)}" r="3.5" class="${cls}"/>`).join('');
  const labels = points
    .map((p, i) => {
      const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
      return `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="${anchor}" class="trend-axis">${esc(p.label)}</text>`;
    })
    .join('');
  const summary = points
    .map((p) => `${p.label}: income ${formatDollars(p.incomeCents)}, spent ${formatDollars(p.spentCents)}`)
    .join('; ');
  return `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly trend. ${esc(summary)}">
    ${grid}
    <path d="${line((p) => p.incomeCents)}" class="trend-income" fill="none"/>
    <path d="${line((p) => p.spentCents)}" class="trend-spent" fill="none"/>
    ${dots((p) => p.incomeCents, 'trend-income-dot')}
    ${dots((p) => p.spentCents, 'trend-spent-dot')}
    ${labels}
  </svg>`;
}

/** Legend for the trend chart: solid swatch = income, dashed = spending. */
export function trendLegend(): string {
  return `<div class="chart-legend"><span><span class="legend-swatch legend-swatch-solid"></span>Income</span><span><span class="legend-swatch legend-swatch-dashed"></span>Spent</span></div>`;
}

/** Legend for the budget category bars: tick = planned, bar = actual, red = over. */
export function categoryLegend(): string {
  return `<div class="chart-legend"><span><span class="legend-swatch legend-swatch-tick"></span>Planned</span><span><span class="legend-swatch legend-swatch-actual"></span>Actual</span><span><span class="legend-swatch legend-swatch-over"></span>Over budget</span></div>`;
}
