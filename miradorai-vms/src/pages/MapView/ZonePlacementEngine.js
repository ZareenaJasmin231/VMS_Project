// ── Greedy no-blind-spot placement engine ─────────────────────────────────────

export function autoPlaceCamerasInZone({
  zone,         // { polygon: [{x,y}…], name, id, color }
  cameraModels, // array from DB filtered by selectedTypes
  coverageTarget = 1.0,
  ppm = 22,
}) {
  const poly = zone.polygon;
  if (poly.length < 3 || !cameraModels.length) return [];

  const CELL = ppm * 0.5;               // 0.5m grid resolution
  const zoneCells = buildZoneCells(poly, CELL);
  if (!zoneCells.length) return [];

  const cellSet = new Set(zoneCells.map(([gx, gy]) => `${gx},${gy}`));
  const totalCells = zoneCells.length;

  // Build candidate positions: polygon corners + interior grid
  const candidates = buildCandidates(poly, ppm);

  // Pick the single best camera model per type for this zone
  // (best = largest coverage area)
  const bestModels = selectBestModels(cameraModels);

  const coveredSet = new Set();
  const placed = [];
  let iterations = 0;

  while (coveredSet.size / totalCells < coverageTarget && iterations < 40) {
    iterations++;
    let bestScore = 0, bestPos = null, bestAngle = 0, bestModel = null, bestCells = new Set();

    for (const cam of bestModels) {
      const rangePx = cam.rangeDay * ppm;
      const halfFovRad = (cam.hfov / 2) * Math.PI / 180;

      for (const [cx, cy, hint] of candidates) {
        // Aim angles to try
        const angles = cam.hfov >= 160
          ? [0]
          : buildAngles(cx, cy, poly, hint);

        for (const angle of angles) {
          const newCells = computeCoverage(cx, cy, angle, halfFovRad, rangePx, zoneCells, cellSet);
          const gain = [...newCells].filter(k => !coveredSet.has(k)).length;
          if (gain > bestScore) {
            bestScore = gain;
            bestPos = [cx, cy];
            bestAngle = angle;
            bestModel = cam;
            bestCells = newCells;
          }
        }
      }
    }

    if (!bestPos || bestScore === 0) break;

    placed.push({
      id: `auto_${zone.id}_${Date.now()}_${placed.length}`,
      x: bestPos[0],
      y: bestPos[1],
      direction: (bestAngle * 180 / Math.PI + 360) % 360,
      camera: bestModel,
    });

    for (const k of bestCells) coveredSet.add(k);

    // Remove used candidate
    const idx = candidates.findIndex(c => c[0] === bestPos[0] && c[1] === bestPos[1]);
    if (idx >= 0) candidates.splice(idx, 1);
  }

  return placed;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildZoneCells(poly, CELL) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const cols = Math.ceil((maxX - minX) / CELL);
  const rows = Math.ceil((maxY - minY) / CELL);
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = minX + col * CELL + CELL / 2;
      const cy = minY + row * CELL + CELL / 2;
      if (pointInPolygon(cx, cy, poly)) cells.push([col, row]);
    }
  }
  return cells;
}

function buildCandidates(poly, ppm) {
  const candidates = [];
  // Polygon corners (cameras face inward)
  for (const pt of poly) candidates.push([pt.x, pt.y, "corner"]);
  // Interior grid at ~range/2 spacing
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const step = ppm * 8; // ~8m grid
  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      if (pointInPolygon(x, y, poly)) candidates.push([x, y, "interior"]);
    }
  }
  return candidates;
}

function buildAngles(cx, cy, poly, hint) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const angles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4,
                  Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4];
  if (hint === "corner") {
    const toCenter = Math.atan2(
      (minY + maxY) / 2 - cy,
      (minX + maxX) / 2 - cx
    );
    angles.unshift(toCenter);
  }
  return angles;
}

function computeCoverage(camX, camY, angle, halfFovRad, rangePx, zoneCells, cellSet) {
  const covered = new Set();
  const CELL = rangePx / 30; // approximation
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  // We need the poly bounds — compute from cell keys
  for (const [gx, gy] of zoneCells) {
    if (gx * CELL < minX) minX = gx * CELL;
    if (gx * CELL > maxX) maxX = gx * CELL;
    if (gy * CELL < minY) minY = gy * CELL;
    if (gy * CELL > maxY) maxY = gy * CELL;
  }

  for (const [gx, gy] of zoneCells) {
    const cx = gx * CELL + CELL / 2;
    const cy = gy * CELL + CELL / 2;
    const dx = cx - camX, dy = cy - camY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > rangePx) continue;
    let diff = Math.atan2(dy, dx) - angle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) <= halfFovRad) covered.add(`${gx},${gy}`);
  }
  return covered;
}

function selectBestModels(models) {
  // Group by type, pick highest rangeDay per type
  const byType = {};
  for (const m of models) {
    if (!byType[m.type] || m.rangeDay > byType[m.type].rangeDay) byType[m.type] = m;
  }
  return Object.values(byType);
}

function pointInPolygon(px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}