import * as THREE from "three";
import type { CommandFormation, FormationTarget } from "../../../core/types.js";
import { resolveFormationProjection } from "../sim/formationProjection.js";

export type FormationProjectionSurface = {
  heightScale: number;
  heightAtTileCoord: (tileX: number, tileY: number) => number;
  toWorldX: (tileX: number) => number;
  toWorldZ: (tileY: number) => number;
};

export type FormationProjectionLayer = {
  group: THREE.Group;
  update: (
    surface: FormationProjectionSurface | null,
    target: FormationTarget | null,
    formation: CommandFormation,
    count: number
  ) => void;
  dispose: () => void;
};

const PREVIEW_LIFT = 0.16;
const SLOT_RADIUS = 0.34;
const ANCHOR_RADIUS = 0.46;

const disposeObject = (object: THREE.Object3D): void => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material?.dispose();
    }
  });
};

export const createFormationProjectionLayer = (): FormationProjectionLayer => {
  const group = new THREE.Group();
  group.name = "formation-projection-preview";
  group.visible = false;
  group.renderOrder = 14;

  const toWorldPoint = (surface: FormationProjectionSurface, tileX: number, tileY: number): THREE.Vector3 => {
    const centeredX = tileX + 0.5;
    const centeredY = tileY + 0.5;
    return new THREE.Vector3(
      surface.toWorldX(centeredX),
      surface.heightAtTileCoord(centeredX, centeredY) * surface.heightScale + PREVIEW_LIFT,
      surface.toWorldZ(centeredY)
    );
  };

  const addLine = (points: THREE.Vector3[], color: number, opacity: number): void => {
    if (points.length < 2) {
      return;
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = group.renderOrder;
    group.add(line);
  };

  const addDisc = (position: THREE.Vector3, radius: number, color: number, opacity: number): void => {
    const geometry = new THREE.RingGeometry(radius * 0.68, radius, 28);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = group.renderOrder;
    group.add(mesh);
  };

  const addFormationOutline = (
    formation: CommandFormation,
    slotPoints: THREE.Vector3[],
    color: number,
    opacity: number
  ): void => {
    if (formation !== "wedge") {
      addLine(slotPoints, color, opacity);
      return;
    }
    const leader = slotPoints[0];
    if (!leader) {
      return;
    }
    const rightArm = [leader];
    const leftArm = [leader];
    for (let index = 1; index < slotPoints.length; index += 1) {
      if (index % 2 === 0) {
        leftArm.push(slotPoints[index]);
      } else {
        rightArm.push(slotPoints[index]);
      }
    }
    addLine(rightArm, color, opacity);
    addLine(leftArm, color, opacity);
  };

  const clear = (): void => {
    group.children.forEach(disposeObject);
    group.clear();
  };

  const update: FormationProjectionLayer["update"] = (surface, target, formation, count) => {
    clear();
    if (!surface || !target) {
      group.visible = false;
      return;
    }
    const projection = resolveFormationProjection(target, formation, Math.max(1, count));
    const anchor = toWorldPoint(surface, projection.anchor.x, projection.anchor.y);
    const facingEnd = toWorldPoint(
      surface,
      projection.anchor.x + projection.facing.x * Math.min(6, projection.widthTiles * 0.5),
      projection.anchor.y + projection.facing.y * Math.min(6, projection.widthTiles * 0.5)
    );
    const slotPoints = projection.slots.map((slot) => toWorldPoint(surface, slot.x, slot.y));

    addLine([anchor, facingEnd], 0x98f0e5, 0.86);
    addFormationOutline(
      formation,
      slotPoints,
      formation === "arc" ? 0xf2b36d : formation === "wedge" ? 0xcdf27a : 0x98f0e5,
      0.78
    );
    addDisc(anchor, ANCHOR_RADIUS, 0xffffff, 0.82);
    slotPoints.forEach((point) => addDisc(point, SLOT_RADIUS, 0x98f0e5, 0.64));
    group.visible = true;
  };

  const dispose = (): void => {
    clear();
  };

  return { group, update, dispose };
};
