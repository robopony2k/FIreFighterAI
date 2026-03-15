import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const CONFIG_PATH = path.join(repoRoot, "src/core/config.ts");
const THREE_TEST_ASSETS_PATH = path.join(repoRoot, "src/render/threeTestAssets.ts");
const OUTPUT_PATH = path.join(repoRoot, "src/core/buildingFootprints.ts");

const readText = async (filePath) => fs.readFile(filePath, "utf8");
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const parseNumberConst = (source, name) => {
  const pattern = new RegExp(`export const ${name} = ([0-9]+(?:\\.[0-9]+)?);`);
  const match = source.match(pattern);
  if (!match) {
    return null;
  }
  return Number(match[1]);
};

const parseStringConst = (source, name) => {
  const pattern = new RegExp(`const ${name} = [\"\']([^\"\']+)[\"\']`);
  const match = source.match(pattern);
  return match ? match[1] : null;
};

const parseArrayConst = (source, name) => {
  const startPattern = new RegExp(`const ${name} = \\[`);
  const startMatch = source.match(startPattern);
  if (!startMatch) {
    return [];
  }
  const startIndex = startMatch.index + startMatch[0].length;
  const endIndex = source.indexOf("]", startIndex);
  if (endIndex === -1) {
    return [];
  }
  const body = source.slice(startIndex, endIndex);
  const regex = /[\"\']([^\"\']+\.(?:glb|gltf))[\"\']/g;
  const results = [];
  let match;
  while ((match = regex.exec(body))) {
    results.push(match[1]);
  }
  return results;
};

const readConfig = async () => {
  const configSource = await readText(CONFIG_PATH);
  const tileSize = parseNumberConst(configSource, "TILE_SIZE") ?? 10;
  return { tileSize };
};

const readHouseAssetPaths = async () => {
  const source = await readText(THREE_TEST_ASSETS_PATH);
  const housePaths = parseArrayConst(source, "HOUSE_MODEL_PATHS");
  const firestationPath = parseStringConst(source, "FIRESTATION_MODEL_PATH");
  if (housePaths.length === 0) {
    throw new Error("Failed to parse HOUSE_MODEL_PATHS from threeTestAssets.ts");
  }
  if (!firestationPath) {
    throw new Error("Failed to parse FIRESTATION_MODEL_PATH from threeTestAssets.ts");
  }
  return { housePaths, firestationPath };
};

const COMPONENT_SIZE = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4
};

const TYPE_SIZE = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16
};

const readGLB = async (filePath) => {
  const data = await fs.readFile(filePath);
  if (data.readUInt32LE(0) !== 0x46546c67) {
    throw new Error(`Invalid GLB magic in ${filePath}`);
  }
  const version = data.readUInt32LE(4);
  if (version !== 2) {
    throw new Error(`Unsupported GLB version ${version} in ${filePath}`);
  }
  const totalLength = data.readUInt32LE(8);
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < totalLength) {
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.readUInt32LE(offset + 4);
    const chunkData = data.slice(offset + 8, offset + 8 + chunkLength);
    if (chunkType === 0x4e4f534a) {
      json = JSON.parse(chunkData.toString("utf8"));
    } else if (chunkType === 0x004e4942) {
      bin = chunkData;
    }
    offset += 8 + chunkLength;
  }
  if (!json) {
    throw new Error(`Missing JSON chunk in ${filePath}`);
  }
  if (!bin) {
    bin = Buffer.alloc(0);
  }
  return { gltf: json, bin };
};

const readComponent = (view, offset, componentType, normalized) => {
  let value;
  switch (componentType) {
    case 5120:
      value = view.getInt8(offset);
      break;
    case 5121:
      value = view.getUint8(offset);
      break;
    case 5122:
      value = view.getInt16(offset, true);
      break;
    case 5123:
      value = view.getUint16(offset, true);
      break;
    case 5125:
      value = view.getUint32(offset, true);
      break;
    case 5126:
      value = view.getFloat32(offset, true);
      break;
    default:
      value = 0;
      break;
  }
  if (!normalized || componentType === 5126) {
    return value;
  }
  switch (componentType) {
    case 5120:
      return Math.max(value / 127, -1);
    case 5121:
      return value / 255;
    case 5122:
      return Math.max(value / 32767, -1);
    case 5123:
      return value / 65535;
    case 5125:
      return value / 4294967295;
    default:
      return value;
  }
};

const getAccessorMinMax = (gltf, bin, accessorIndex) => {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor) {
    return null;
  }
  if (accessor.min && accessor.max) {
    return { min: accessor.min, max: accessor.max };
  }
  const bufferView = gltf.bufferViews?.[accessor.bufferView];
  if (!bufferView) {
    return null;
  }
  const componentSize = COMPONENT_SIZE[accessor.componentType];
  const componentCount = TYPE_SIZE[accessor.type] ?? 0;
  if (!componentSize || componentCount <= 0) {
    return null;
  }
  const stride = bufferView.byteStride ?? componentSize * componentCount;
  const baseOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(bin.buffer, bin.byteOffset + baseOffset, bufferView.byteLength - (accessor.byteOffset ?? 0));
  const min = new Array(componentCount).fill(Number.POSITIVE_INFINITY);
  const max = new Array(componentCount).fill(Number.NEGATIVE_INFINITY);
  for (let i = 0; i < accessor.count; i += 1) {
    const offset = i * stride;
    for (let c = 0; c < componentCount; c += 1) {
      const value = readComponent(view, offset + c * componentSize, accessor.componentType, accessor.normalized);
      if (value < min[c]) min[c] = value;
      if (value > max[c]) max[c] = value;
    }
  }
  return { min, max };
};

const unionBounds = (a, b) => {
  if (!a) {
    return b;
  }
  const min = [
    Math.min(a.min[0], b.min[0]),
    Math.min(a.min[1], b.min[1]),
    Math.min(a.min[2], b.min[2])
  ];
  const max = [
    Math.max(a.max[0], b.max[0]),
    Math.max(a.max[1], b.max[1]),
    Math.max(a.max[2], b.max[2])
  ];
  return { min, max };
};

const transformBounds = (bounds, matrix) => {
  if (!bounds) {
    return null;
  }
  const { min, max } = bounds;
  const corners = [
    [min[0], min[1], min[2]],
    [min[0], min[1], max[2]],
    [min[0], max[1], min[2]],
    [min[0], max[1], max[2]],
    [max[0], min[1], min[2]],
    [max[0], min[1], max[2]],
    [max[0], max[1], min[2]],
    [max[0], max[1], max[2]]
  ];
  const outMin = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const outMax = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  const temp = new THREE.Vector3();
  corners.forEach(([x, y, z]) => {
    temp.set(x, y, z).applyMatrix4(matrix);
    outMin.min(temp);
    outMax.max(temp);
  });
  return { min: [outMin.x, outMin.y, outMin.z], max: [outMax.x, outMax.y, outMax.z] };
};

const buildNodeMatrices = (gltf) => {
  const nodes = gltf.nodes ?? [];
  const world = new Array(nodes.length);
  const parent = new Array(nodes.length).fill(-1);
  const localMatrices = nodes.map((node) => {
    if (node.matrix) {
      return new THREE.Matrix4().fromArray(node.matrix);
    }
    const t = node.translation ?? [0, 0, 0];
    const r = node.rotation ?? [0, 0, 0, 1];
    const s = node.scale ?? [1, 1, 1];
    return new THREE.Matrix4().compose(
      new THREE.Vector3(t[0], t[1], t[2]),
      new THREE.Quaternion(r[0], r[1], r[2], r[3]),
      new THREE.Vector3(s[0], s[1], s[2])
    );
  });

  const visit = (nodeIndex, parentMatrix) => {
    const local = localMatrices[nodeIndex];
    const worldMatrix = parentMatrix ? parentMatrix.clone().multiply(local) : local.clone();
    world[nodeIndex] = worldMatrix;
    const children = nodes[nodeIndex].children ?? [];
    children.forEach((child) => {
      parent[child] = nodeIndex;
      visit(child, worldMatrix);
    });
  };

  const sceneIndex = gltf.scene ?? 0;
  const scene = gltf.scenes?.[sceneIndex] ?? gltf.scenes?.[0];
  const roots = scene?.nodes ?? [];
  roots.forEach((nodeIndex) => visit(nodeIndex, null));
  return { world, parent, roots };
};

const getMeshBounds = (gltf, bin) => {
  const meshes = gltf.meshes ?? [];
  return meshes.map((mesh) => {
    let bounds = null;
    const primitives = mesh.primitives ?? [];
    primitives.forEach((primitive) => {
      const positionAccessor = primitive.attributes?.POSITION;
      if (positionAccessor === undefined) {
        return;
      }
      const minMax = getAccessorMinMax(gltf, bin, positionAccessor);
      if (!minMax) {
        return;
      }
      bounds = unionBounds(bounds, { min: minMax.min.slice(0, 3), max: minMax.max.slice(0, 3) });
    });
    return bounds;
  });
};

const buildKeyPattern = /^Build_[^_]+/i;

const getBuildKey = (nodeIndex, nodes, parent) => {
  let current = nodeIndex;
  while (current !== -1) {
    const name = nodes[current]?.name;
    if (name) {
      const match = name.match(buildKeyPattern);
      if (match) {
        return match[0];
      }
    }
    current = parent[current];
  }
  return null;
};

const extractHouseVariants = (gltf, bin) => {
  const nodes = gltf.nodes ?? [];
  const meshes = gltf.meshes ?? [];
  const { world: worldMatrices, parent, roots } = buildNodeMatrices(gltf);
  const meshBounds = getMeshBounds(gltf, bin);

  const buildKeyGroups = new Map();
  nodes.forEach((node, index) => {
    if (node.mesh === undefined) {
      return;
    }
    const key = getBuildKey(index, nodes, parent);
    if (!key) {
      return;
    }
    const localBounds = meshBounds[node.mesh];
    if (!localBounds) {
      return;
    }
    const worldBounds = transformBounds(localBounds, worldMatrices[index]);
    const entry = buildKeyGroups.get(key) ?? { bounds: null };
    entry.bounds = unionBounds(entry.bounds, worldBounds);
    buildKeyGroups.set(key, entry);
  });

  if (buildKeyGroups.size > 0) {
    return Array.from(buildKeyGroups.keys())
      .sort()
      .map((key) => {
        const entry = buildKeyGroups.get(key);
        const bounds = entry.bounds;
        const size = bounds
          ? {
              x: bounds.max[0] - bounds.min[0],
              y: bounds.max[1] - bounds.min[1],
              z: bounds.max[2] - bounds.min[2]
            }
          : { x: 0, y: 0, z: 0 };
        return { name: key, size, meshCount: 0 };
      });
  }

  const candidates = [];
  const includeName = /(house|building|structure|home|cottage|villa|cabin|hut)/i;
  const excludeName = /(wall|roof|door|window|chimney|pillar|beam|trim|stairs|floor|base|prop|fence|gate|balcony|frame)/i;

  const collectMeshes = (rootIndex) => {
    const stack = [rootIndex];
    const meshNodes = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) {
        continue;
      }
      const node = nodes[current];
      if (!node) {
        continue;
      }
      if (node.mesh !== undefined) {
        meshNodes.push(current);
      }
      const children = node.children ?? [];
      children.forEach((child) => stack.push(child));
    }
    return meshNodes;
  };

  roots.forEach((rootIndex) => {
    const rootNode = nodes[rootIndex];
    if (!rootNode) {
      return;
    }
    const meshNodes = collectMeshes(rootIndex);
    if (meshNodes.length === 0) {
      return;
    }
    const rootMatrix = worldMatrices[rootIndex];
    const rootInv = rootMatrix ? rootMatrix.clone().invert() : new THREE.Matrix4();
    let bounds = null;
    let firstMeshName = "";
    meshNodes.forEach((nodeIndex) => {
      const node = nodes[nodeIndex];
      if (!node) {
        return;
      }
      if (!firstMeshName) {
        firstMeshName = node.name ?? meshes[node.mesh]?.name ?? "";
      }
      const localBounds = meshBounds[node.mesh];
      if (!localBounds) {
        return;
      }
      const worldBounds = transformBounds(localBounds, worldMatrices[nodeIndex]);
      const local = transformBounds(worldBounds, rootInv);
      bounds = unionBounds(bounds, local);
    });
    if (!bounds) {
      return;
    }
    const size = {
      x: bounds.max[0] - bounds.min[0],
      y: bounds.max[1] - bounds.min[1],
      z: bounds.max[2] - bounds.min[2]
    };
    const name = (rootNode.name || firstMeshName || "").toLowerCase();
    const footprint = Math.max(0.0001, size.x * size.z);
    candidates.push({
      name,
      size,
      footprint,
      height: Math.max(0.01, size.y),
      meshCount: meshNodes.length
    });
  });

  if (candidates.length === 0) {
    return [];
  }

  const maxFootprint = Math.max(...candidates.map((candidate) => candidate.footprint));
  const maxHeight = Math.max(...candidates.map((candidate) => candidate.height));

  const filtered = candidates.filter((candidate) => {
    if (candidate.name && includeName.test(candidate.name)) {
      return true;
    }
    if (candidate.name && excludeName.test(candidate.name)) {
      return false;
    }
    const footprintRatio = maxFootprint > 0 ? candidate.footprint / maxFootprint : 0;
    const heightRatio = maxHeight > 0 ? candidate.height / maxHeight : 0;
    const meshEnough = candidate.meshCount >= 2;
    return (footprintRatio >= 0.35 && heightRatio >= 0.25 && meshEnough) || (footprintRatio >= 0.5 && meshEnough);
  });

  const picks = filtered.length > 0 ? filtered : candidates;
  return picks.map((candidate) => ({ name: candidate.name, size: candidate.size, meshCount: candidate.meshCount }));
};

const extractAssetBounds = async (assetPath) => {
  const { gltf, bin } = await readGLB(assetPath);
  const variants = extractHouseVariants(gltf, bin);
  return variants;
};

const extractSceneBounds = async (assetPath) => {
  const { gltf, bin } = await readGLB(assetPath);
  const nodes = gltf.nodes ?? [];
  const meshes = gltf.meshes ?? [];
  const { world: worldMatrices, roots } = buildNodeMatrices(gltf);
  const meshBounds = getMeshBounds(gltf, bin);
  let bounds = null;
  const stack = [...roots];
  while (stack.length > 0) {
    const nodeIndex = stack.pop();
    if (nodeIndex === undefined) {
      continue;
    }
    const node = nodes[nodeIndex];
    if (!node) {
      continue;
    }
    if (node.mesh !== undefined) {
      const localBounds = meshBounds[node.mesh];
      if (localBounds) {
        const worldBounds = transformBounds(localBounds, worldMatrices[nodeIndex]);
        bounds = unionBounds(bounds, worldBounds);
      }
    }
    const children = node.children ?? [];
    children.forEach((child) => stack.push(child));
  }
  if (!bounds) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: bounds.max[0] - bounds.min[0],
    y: bounds.max[1] - bounds.min[1],
    z: bounds.max[2] - bounds.min[2]
  };
};

const formatNumber = (value) => {
  const rounded = Number(value.toFixed(4));
  return Number.isFinite(rounded) ? rounded : 0;
};

const run = async () => {
  const { tileSize } = await readConfig();
  const { housePaths, firestationPath } = await readHouseAssetPaths();

  const houseVariants = [];
  for (const housePath of housePaths) {
    const absPath = path.join(repoRoot, housePath);
    const variants = await extractAssetBounds(absPath);
    if (variants.length === 0) {
      continue;
    }
    variants.forEach((variant) => {
      const sizeX = variant.size.x / tileSize;
      const sizeY = variant.size.y / tileSize;
      const sizeZ = variant.size.z / tileSize;
      houseVariants.push({
        source: housePath,
        name: variant.name ?? "",
        sizeX: formatNumber(sizeX),
        sizeY: formatNumber(sizeY),
        sizeZ: formatNumber(sizeZ),
        parcelX: formatNumber(clamp(sizeX * 2.4, 1.25, 2.2)),
        parcelZ: formatNumber(clamp(sizeZ * 2.4, 1, 1.8))
      });
    });
  }

  const firestationAbs = path.join(repoRoot, firestationPath);
  const firestationSize = await extractSceneBounds(firestationAbs);

  const lines = [];
  lines.push("export type HouseVariantFootprint = {");
  lines.push("  source: string;");
  lines.push("  name: string;");
  lines.push("  sizeX: number;");
  lines.push("  sizeY: number;");
  lines.push("  sizeZ: number;");
  lines.push("  parcelX: number;");
  lines.push("  parcelZ: number;");
  lines.push("};");
  lines.push("");
  lines.push("export const HOUSE_VARIANTS: HouseVariantFootprint[] = [");
  houseVariants.forEach((variant) => {
    lines.push("  {");
    lines.push(`    source: ${JSON.stringify(variant.source)},`);
    lines.push(`    name: ${JSON.stringify(variant.name)},`);
    lines.push(`    sizeX: ${variant.sizeX},`);
    lines.push(`    sizeY: ${variant.sizeY},`);
    lines.push(`    sizeZ: ${variant.sizeZ},`);
    lines.push(`    parcelX: ${variant.parcelX},`);
    lines.push(`    parcelZ: ${variant.parcelZ}`);
    lines.push("  },");
  });
  lines.push("];");
  lines.push("");
  lines.push("export const FIRESTATION_FOOTPRINT = {");
  lines.push(`  source: ${JSON.stringify(firestationPath)},`);
  lines.push(`  sizeX: ${formatNumber(firestationSize.x / tileSize)},`);
  lines.push(`  sizeY: ${formatNumber(firestationSize.y / tileSize)},`);
  lines.push(`  sizeZ: ${formatNumber(firestationSize.z / tileSize)}`);
  lines.push("};");
  lines.push("");
  lines.push("export const BUILDING_FOOTPRINTS_META = {");
  lines.push(`  generatedAt: ${JSON.stringify(new Date().toISOString())},`);
  lines.push(`  tileSize: ${tileSize},`);
  lines.push(`  houseSources: ${JSON.stringify(housePaths)},`);
  lines.push(`  firestationSource: ${JSON.stringify(firestationPath)}`);
  lines.push("};");
  lines.push("");

  await fs.writeFile(OUTPUT_PATH, `${lines.join("\n")}`, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
