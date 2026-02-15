export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

export type HudCameraSnapshot = {
  kind: "perspective";
  position: Vec3;
  invViewProj: number[];
};

export type WorldBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

const EPS = 1e-5;

const multiplyMat4Vec4 = (m: number[], x: number, y: number, z: number, w: number): [number, number, number, number] => {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w
  ];
};

const unproject = (invViewProj: number[], ndcX: number, ndcY: number, ndcZ: number): Vec3 | null => {
  const [x, y, z, w] = multiplyMat4Vec4(invViewProj, ndcX, ndcY, ndcZ, 1);
  if (Math.abs(w) < EPS) {
    return null;
  }
  const invW = 1 / w;
  return { x: x * invW, y: y * invW, z: z * invW };
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const computeViewportCenterOnPlane = (
  snapshot: HudCameraSnapshot | null,
  planeY: number,
  bounds: WorldBounds
): Vec2 | null => {
  if (!snapshot || snapshot.kind !== "perspective") {
    return null;
  }
  const farPoint = unproject(snapshot.invViewProj, 0, 0, 1);
  if (!farPoint) {
    return null;
  }
  const origin = snapshot.position;
  const dir = {
    x: farPoint.x - origin.x,
    y: farPoint.y - origin.y,
    z: farPoint.z - origin.z
  };
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= len;
  dir.y /= len;
  dir.z /= len;
  if (Math.abs(dir.y) < EPS) {
    return null;
  }
  const t = (planeY - origin.y) / dir.y;
  if (t <= 0) {
    return null;
  }
  const hitX = origin.x + dir.x * t;
  const hitZ = origin.z + dir.z * t;
  return {
    x: clamp(hitX, bounds.minX, bounds.maxX),
    y: clamp(hitZ, bounds.minZ, bounds.maxZ)
  };
};
