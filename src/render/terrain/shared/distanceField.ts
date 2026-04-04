export const buildDistanceField = (
  sampleTypes: Uint8Array,
  sampleCols: number,
  sampleRows: number,
  targetType: number
): Int16Array => {
  const total = sampleCols * sampleRows;
  const dist = new Int16Array(total);
  dist.fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i += 1) {
    if (sampleTypes[i] !== targetType) {
      continue;
    }
    dist[i] = 0;
    queue[tail] = i;
    tail += 1;
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const d = dist[idx];
    const x = idx % sampleCols;
    const y = Math.floor(idx / sampleCols);
    const nextD = (d + 1) as number;
    if (x > 0) {
      const n = idx - 1;
      if (dist[n] === -1) {
        dist[n] = nextD;
        queue[tail] = n;
        tail += 1;
      }
    }
    if (x < sampleCols - 1) {
      const n = idx + 1;
      if (dist[n] === -1) {
        dist[n] = nextD;
        queue[tail] = n;
        tail += 1;
      }
    }
    if (y > 0) {
      const n = idx - sampleCols;
      if (dist[n] === -1) {
        dist[n] = nextD;
        queue[tail] = n;
        tail += 1;
      }
    }
    if (y < sampleRows - 1) {
      const n = idx + sampleCols;
      if (dist[n] === -1) {
        dist[n] = nextD;
        queue[tail] = n;
        tail += 1;
      }
    }
  }
  return dist;
};
