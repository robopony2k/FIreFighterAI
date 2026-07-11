import * as THREE from "three";

export type SparseRoadOverlaySample = {
  cols: number;
  rows: number;
  tileTypes?: ArrayLike<number>;
  roadEdges?: ArrayLike<number>;
  roadBridgeMask?: ArrayLike<number>;
};

const markRoadCoverage = (
  sample: SparseRoadOverlaySample,
  roadId: number,
  baseId: number,
  haloTiles: number
): Uint8Array => {
  const { cols, rows } = sample;
  const mask = new Uint8Array(Math.max(0, cols * rows));
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const index = y * cols + x;
      const type = sample.tileTypes?.[index] ?? -1;
      const active = type === roadId || type === baseId || (sample.roadEdges?.[index] ?? 0) > 0 || (sample.roadBridgeMask?.[index] ?? 0) > 0;
      if (!active) {
        continue;
      }
      for (let offsetY = -haloTiles; offsetY <= haloTiles; offsetY += 1) {
        const targetY = y + offsetY;
        if (targetY < 0 || targetY >= rows) continue;
        for (let offsetX = -haloTiles; offsetX <= haloTiles; offsetX += 1) {
          const targetX = x + offsetX;
          if (targetX >= 0 && targetX < cols) {
            mask[targetY * cols + targetX] = 1;
          }
        }
      }
    }
  }
  return mask;
};

export const buildSparseRoadOverlayGeometry = (
  source: THREE.BufferGeometry,
  sample: SparseRoadOverlaySample,
  roadId: number,
  baseId: number,
  haloTiles = 1
): THREE.BufferGeometry | null => {
  const positions = source.getAttribute("position");
  const normals = source.getAttribute("normal");
  const uvs = source.getAttribute("uv");
  if (!positions || !uvs || sample.cols <= 0 || sample.rows <= 0) {
    return null;
  }
  const coverage = markRoadCoverage(sample, roadId, baseId, Math.max(0, Math.floor(haloTiles)));
  if (!coverage.some((value) => value > 0)) {
    return null;
  }
  const indices = source.getIndex();
  const triangleCount = Math.floor((indices?.count ?? positions.count) / 3);
  const outPositions: number[] = [];
  const outNormals: number[] = [];
  const outUvs: number[] = [];
  const sourceIndexAt = (offset: number): number => indices ? indices.getX(offset) : offset;
  const isCoveredUv = (u: number, v: number): boolean => {
    const x = Math.max(0, Math.min(sample.cols - 1, Math.floor(u * sample.cols)));
    const y = Math.max(0, Math.min(sample.rows - 1, Math.floor((1 - v) * sample.rows)));
    return coverage[y * sample.cols + x] > 0;
  };
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = sourceIndexAt(triangle * 3);
    const b = sourceIndexAt(triangle * 3 + 1);
    const c = sourceIndexAt(triangle * 3 + 2);
    const centroidU = (uvs.getX(a) + uvs.getX(b) + uvs.getX(c)) / 3;
    const centroidV = (uvs.getY(a) + uvs.getY(b) + uvs.getY(c)) / 3;
    if (
      !isCoveredUv(centroidU, centroidV) &&
      !isCoveredUv(uvs.getX(a), uvs.getY(a)) &&
      !isCoveredUv(uvs.getX(b), uvs.getY(b)) &&
      !isCoveredUv(uvs.getX(c), uvs.getY(c))
    ) {
      continue;
    }
    for (const vertex of [a, b, c]) {
      outPositions.push(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex));
      outUvs.push(uvs.getX(vertex), uvs.getY(vertex));
      if (normals) {
        outNormals.push(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex));
      }
    }
  }
  if (outPositions.length === 0) {
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(outPositions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(outUvs, 2));
  if (outNormals.length > 0) {
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(outNormals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.sparseRoadOverlay = true;
  geometry.userData.sourceTriangleCount = triangleCount;
  geometry.userData.sparseTriangleCount = outPositions.length / 9;
  return geometry;
};
