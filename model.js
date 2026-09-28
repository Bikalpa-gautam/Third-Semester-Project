// Geographic calculations use local east/north metres in the supplied EPSG:9377 grid.
export const LAYERS = {
  buildings: { color: "#f3e2b9", label: "buildings" },
  massMovement: { color: "#bc614c", label: "massMovement" },
  flood: { color: "#479bd1", label: "flood" },
  torrential: { color: "#d49344", label: "torrential" },
  riparian: { color: "#61967a", label: "riparian" },
  river: { color: "#83c5e2", label: "river" },
  boundary: { color: "#ffffff", label: "boundary" },
  contours: { color: "#736f59", label: "contours" },
};
export const PROPOSALS = {
  drainage: { color: "#478aac", label: "drainage", icon: "water" },
  garden: { color: "#6c9474", label: "garden", icon: "leaf" },
  trees: { color: "#386954", label: "trees", icon: "tree" },
};
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function pointInRing(x, n, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > n !== yj > n && x < ((xj - xi) * (n - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

export function createModel(data) {
  const width = data.extent[2] - data.extent[0];
  const depth = data.extent[3] - data.extent[1];
  const dx = width / (data.width - 1),
    dn = depth / (data.height - 1);
  const slopes = new Float32Array(data.heights.length);
  for (let row = 0; row < data.height; row++)
    for (let col = 0; col < data.width; col++) {
      const left = Math.max(0, col - 1),
        right = Math.min(data.width - 1, col + 1);
      const up = Math.max(0, row - 1),
        down = Math.min(data.height - 1, row + 1);
      const east =
        (data.heights[row * data.width + right] -
          data.heights[row * data.width + left]) /
        ((right - left) * dx);
      const north =
        (data.heights[up * data.width + col] -
          data.heights[down * data.width + col]) /
        ((down - up) * dn);
      slopes[row * data.width + col] =
        (Math.atan(Math.hypot(east, north)) * 180) / Math.PI;
    }
  function sample(values, x, n) {
    const col = clamp((x + width / 2) / dx, 0, data.width - 1);
    const row = clamp((depth / 2 - n) / dn, 0, data.height - 1);
    const x0 = Math.floor(col),
      y0 = Math.floor(row);
    const x1 = Math.min(x0 + 1, data.width - 1),
      y1 = Math.min(y0 + 1, data.height - 1);
    const tx = col - x0,
      ty = row - y0;
    const a =
      values[y0 * data.width + x0] * (1 - tx) +
      values[y0 * data.width + x1] * tx;
    const b =
      values[y1 * data.width + x0] * (1 - tx) +
      values[y1 * data.width + x1] * tx;
    return a * (1 - ty) + b * ty;
  }
  const elevation = (x, n) => sample(data.heights, x, n);
  const slope = (x, n) => sample(slopes, x, n);
  const inside = (x, n) => Math.abs(x) <= width / 2 && Math.abs(n) <= depth / 2;
  const inspect = (x, n, year) => ({
    x,
    n,
    elevation: elevation(x, n),
    slope: slope(x, n),
    easting: data.centre[0] + x,
    northing: data.centre[1] + n,
    footprint: data.buildings[year].findIndex((ring) =>
      pointInRing(x, n, ring),
    ),
    hazards: Object.entries(data.hazards).flatMap(([key, features]) => {
      const grades = [
        ...new Set(
          features.filter((f) => pointInRing(x, n, f.ring)).map((f) => f.grade),
        ),
      ];
      return grades.length ? [{ key, grades }] : [];
    }),
  });
  return {
    data,
    width,
    depth,
    dx,
    dn,
    slopes,
    elevation,
    slope,
    inside,
    inspect,
  };
}

// Marching triangles avoids ambiguous saddle cells. Segments are in local east/north/elevation.
export function contourSegments(model, interval = 50) {
  const { data, width, depth, dx, dn } = model;
  const segments = [];
  const vertex = (x, y) => [
    x * dx - width / 2,
    depth / 2 - y * dn,
    data.heights[y * data.width + x],
  ];
  for (let y = 0; y < data.height - 1; y += 2)
    for (let x = 0; x < data.width - 1; x += 2) {
      const x1 = Math.min(x + 2, data.width - 1),
        y1 = Math.min(y + 2, data.height - 1);
      const a = vertex(x, y),
        b = vertex(x1, y),
        c = vertex(x1, y1),
        d = vertex(x, y1);
      for (const tri of [
        [a, b, c],
        [a, c, d],
      ]) {
        const low = Math.min(...tri.map((v) => v[2])),
          high = Math.max(...tri.map((v) => v[2]));
        for (
          let level = Math.ceil(low / interval) * interval;
          level < high;
          level += interval
        ) {
          const hits = [];
          for (let k = 0; k < 3; k++) {
            const p = tri[k],
              q = tri[(k + 1) % 3];
            if (
              (p[2] <= level && q[2] > level) ||
              (q[2] <= level && p[2] > level)
            ) {
              const t = (level - p[2]) / (q[2] - p[2]);
              hits.push([
                p[0] + t * (q[0] - p[0]),
                p[1] + t * (q[1] - p[1]),
                level,
              ]);
            }
          }
          if (hits.length === 2) segments.push(hits);
        }
      }
    }
  return segments;
}

export function densify(points, step = 10, closed = true) {
  const result = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step),
    );
    for (let k = 0; k < steps; k++)
      result.push([
        a[0] + ((b[0] - a[0]) * k) / steps,
        a[1] + ((b[1] - a[1]) * k) / steps,
      ]);
  }
  result.push(closed ? points[0] : points.at(-1));
  return result;
}

export function measurePoints(a, b, model) {
  return {
    distance: Math.hypot(b.x - a.x, b.n - a.n),
    rise: model.elevation(b.x, b.n) - model.elevation(a.x, a.n),
  };
}

export function serializePlan(proposals, data) {
  return {
    version: 1,
    site: "el-uvito",
    crs: data.crs,
    proposals: proposals.map((p) => ({
      id: p.id,
      type: p.type,
      easting: p.x + data.centre[0],
      northing: p.n + data.centre[1],
      note: p.note || "",
    })),
  };
}

export function parsePlan(input, model) {
  if (
    !input ||
    input.version !== 1 ||
    input.site !== "el-uvito" ||
    input.crs !== model.data.crs ||
    !Array.isArray(input.proposals) ||
    input.proposals.length > 100
  )
    throw new Error("Invalid plan");
  return input.proposals.map((p, i) => {
    if (
      !p ||
      !Object.hasOwn(PROPOSALS, p.type) ||
      !Number.isFinite(p.easting) ||
      !Number.isFinite(p.northing)
    )
      throw new Error("Invalid proposal");
    const x = p.easting - model.data.centre[0],
      n = p.northing - model.data.centre[1];
    if (!model.inside(x, n)) throw new Error("Proposal outside El Uvito");
    const id = `proposal-${i}`;
    return {
      id,
      type: p.type,
      x,
      n,
      note: typeof p.note === "string" ? p.note.slice(0, 500) : "",
    };
  });
}

export function sampleRamp(stops, t) {
  const pos = clamp(t, 0, 1) * (stops.length - 1),
    a = Math.floor(pos),
    b = Math.min(a + 1, stops.length - 1);
  return stops[a].map((v, i) => Math.round(v + (stops[b][i] - v) * (pos - a)));
}

export const RAMPS = {
  elevation: [
    [73, 110, 93],
    [142, 160, 118],
    [201, 199, 158],
    [215, 193, 159],
    [242, 234, 212],
  ],
  slope: [
    [236, 234, 218],
    [220, 206, 160],
    [204, 160, 94],
    [184, 108, 65],
    [141, 66, 51],
  ],
};
