export const SPARK_W = 76;
export const SPARK_H = 26;

const SPARK_UP_STROKE = "#3ee6b0";
const SPARK_DOWN_STROKE = "#ff6b7a";
const SPARK_UP_FILL = "rgba(62, 230, 176, 0.22)";
const SPARK_DOWN_FILL = "rgba(255, 107, 122, 0.22)";

/**
 * @param {number[] | null | undefined} points
 * @param {boolean} up
 * @param {{ className?: string, width?: number, height?: number }} [options]
 */
export function buildSparklineSvg(points, up, options = {}) {
  const className = options.className || "sparkline";
  const width = options.width ?? SPARK_W;
  const height = options.height ?? SPARK_H;
  const values = (points || []).map(Number).filter((v) => Number.isFinite(v));

  if (values.length < 2) {
    return `<svg class="${className} ${className}--empty" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"></svg>`;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const padY = 2;
  const innerH = height - padY * 2;

  const coords = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = padY + innerH - ((v - min) / span) * innerH;
    return { x, y };
  });

  const linePoints = coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = [
    `M 0,${height}`,
    ...coords.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `L ${width},${height}`,
    "Z",
  ].join(" ");

  const stroke = up ? SPARK_UP_STROKE : SPARK_DOWN_STROKE;
  const fill = up ? SPARK_UP_FILL : SPARK_DOWN_FILL;
  const areaClass = `${className}-area`;
  const lineClass = `${className}-line`;

  return `<svg class="${className}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true"><path class="${areaClass}" d="${areaD}" fill="${fill}"/><polyline class="${lineClass}" points="${linePoints}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
