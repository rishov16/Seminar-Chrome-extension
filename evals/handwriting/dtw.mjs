// Shape comparison for online-ink glyphs via Dynamic Time Warping.
//
// Our own ink (handwriting-agent-transcripts.js's hand-authored waypoints,
// resampled through the production Catmull-Rom spline — see
// glyph-geometry.mjs) and MathWriting's human ink (raw touchscreen samples,
// arbitrary device scale/origin — see ../README.md) live in completely
// unrelated coordinate systems. DTW compares SHAPE, not position/scale, so
// both are normalized to a common frame first: translate to origin, scale
// to fit a unit square (preserving aspect ratio), then arc-length-resample
// to a fixed point count so point density differences (our hand-authored
// bank has far fewer native points than a real touchscreen trace) don't
// bias the alignment.

const RESAMPLE_POINTS = 64;

function bboxNormalize(points) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  points.forEach(([x, y]) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  });
  const scale = Math.max(maxX - minX, maxY - minY) || 1;
  return points.map(([x, y]) => [(x - minX) / scale, (y - minY) / scale]);
}

/** Resamples an ordered point path to exactly n points, evenly spaced by
 * cumulative arc length (not by original point index) — the standard
 * technique for comparing paths sampled at different, uneven rates. */
function resampleByArcLength(points, n) {
  if (points.length < 2) return points.length ? Array(n).fill(points[0]) : [];
  const cumLen = [0];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    cumLen.push(cumLen[i - 1] + Math.hypot(x1 - x0, y1 - y0));
  }
  const totalLen = cumLen[cumLen.length - 1] || 1e-6;

  const out = [];
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * totalLen;
    let i = 1;
    while (i < cumLen.length - 1 && cumLen[i] < target) i++;
    const segLen = cumLen[i] - cumLen[i - 1] || 1e-6;
    const w = (target - cumLen[i - 1]) / segLen;
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    out.push([x0 + (x1 - x0) * w, y0 + (y1 - y0) * w]);
  }
  return out;
}

/** Normalizes a raw point path (any coordinate system, any density) into a
 * fixed-length, unit-square-scaled sequence ready for DTW comparison. */
export function normalizeForComparison(points, n = RESAMPLE_POINTS) {
  return bboxNormalize(resampleByArcLength(points, n));
}

/** Standard DTW: cumulative min-cost alignment between two 2D point
 * sequences, unit cost = Euclidean distance. @returns the total path cost
 * (NOT normalized by path length — divide by Math.max(a.length,b.length)
 * for a per-step-comparable number across glyph pairs of different length,
 * though normalizeForComparison already fixes both to the same length). */
export function dtwDistance(a, b) {
  const n = a.length; const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
  dp[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = Math.hypot(a[i - 1][0] - b[j - 1][0], a[i - 1][1] - b[j - 1][1]);
      dp[i][j] = cost + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[n][m];
}
