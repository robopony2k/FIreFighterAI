import * as THREE from "three";

export type TowerScaffoldCorner = {
  bottom: THREE.Vector3;
  top: THREE.Vector3;
};

export type TowerScaffoldFrame = {
  corners: TowerScaffoldCorner[];
  height: number;
};

export type TowerScaffoldOptions = {
  height: number;
  baseWidth: number;
  topWidth: number;
  legRadius: number;
  strutRadius: number;
  panelCount: number;
  legMaterial: THREE.Material;
  strutMaterial: THREE.Material;
};

const UP = new THREE.Vector3(0, 1, 0);
const CORNER_SIGNS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1]
] as const;

export const addCylinderBetween = (
  group: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  radialSegments = 6,
  name = "tower-cylinder"
): THREE.Mesh | null => {
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length <= 0.001) {
    return null;
  }
  const geometry = new THREE.CylinderGeometry(radius, radius, length, radialSegments);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
};

export const addBoxPart = (
  group: THREE.Group,
  position: THREE.Vector3,
  size: THREE.Vector3,
  material: THREE.Material,
  name = "tower-box"
): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
  mesh.name = name;
  mesh.position.copy(position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
};

const pointAtHeight = (cornerIndex: number, height: number, baseWidth: number, topWidth: number, y: number): THREE.Vector3 => {
  const t = height <= 0 ? 0 : THREE.MathUtils.clamp(y / height, 0, 1);
  const width = THREE.MathUtils.lerp(baseWidth, topWidth, t);
  const [sx, sz] = CORNER_SIGNS[cornerIndex];
  return new THREE.Vector3(sx * width * 0.5, y, sz * width * 0.5);
};

export const createFourLegTowerScaffold = (group: THREE.Group, options: TowerScaffoldOptions): TowerScaffoldFrame => {
  const corners = CORNER_SIGNS.map((_, index) => ({
    bottom: pointAtHeight(index, options.height, options.baseWidth, options.topWidth, 0),
    top: pointAtHeight(index, options.height, options.baseWidth, options.topWidth, options.height)
  }));
  corners.forEach((corner) => {
    addCylinderBetween(group, corner.bottom, corner.top, options.legRadius, options.legMaterial, 7, "tower-leg");
  });

  const panels = Math.max(1, Math.floor(options.panelCount));
  for (let panel = 0; panel < panels; panel += 1) {
    const y0 = (options.height * panel) / panels;
    const y1 = (options.height * (panel + 1)) / panels;
    for (let cornerIndex = 0; cornerIndex < 4; cornerIndex += 1) {
      const nextIndex = (cornerIndex + 1) % 4;
      const lowerA = pointAtHeight(cornerIndex, options.height, options.baseWidth, options.topWidth, y0);
      const lowerB = pointAtHeight(nextIndex, options.height, options.baseWidth, options.topWidth, y0);
      const upperA = pointAtHeight(cornerIndex, options.height, options.baseWidth, options.topWidth, y1);
      const upperB = pointAtHeight(nextIndex, options.height, options.baseWidth, options.topWidth, y1);
      addCylinderBetween(group, lowerA, upperB, options.strutRadius, options.strutMaterial, 5, "tower-cross-strut");
      addCylinderBetween(group, lowerB, upperA, options.strutRadius, options.strutMaterial, 5, "tower-cross-strut");
    }
  }

  for (let ring = 0; ring <= panels; ring += 1) {
    const y = (options.height * ring) / panels;
    for (let cornerIndex = 0; cornerIndex < 4; cornerIndex += 1) {
      const nextIndex = (cornerIndex + 1) % 4;
      addCylinderBetween(
        group,
        pointAtHeight(cornerIndex, options.height, options.baseWidth, options.topWidth, y),
        pointAtHeight(nextIndex, options.height, options.baseWidth, options.topWidth, y),
        options.strutRadius * 0.9,
        options.strutMaterial,
        5,
        "tower-ring-strut"
      );
    }
  }

  return { corners, height: options.height };
};

export const addFootingPads = (
  group: THREE.Group,
  corners: TowerScaffoldCorner[],
  material: THREE.Material,
  padSize = 0.34
): void => {
  corners.forEach((corner) => {
    addBoxPart(
      group,
      new THREE.Vector3(corner.bottom.x, 0.035, corner.bottom.z),
      new THREE.Vector3(padSize, 0.07, padSize),
      material,
      "tower-footing"
    );
  });
};
