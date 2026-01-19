import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TILE_COLOR_RGB } from "../core/config.js";
import { TILE_ID_TO_TYPE, TILE_TYPE_IDS } from "../core/state.js";
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const SUN_DIR = (() => {
    const x = 0.55;
    const y = 0.78;
    const z = 0.32;
    const len = Math.hypot(x, y, z) || 1;
    return { x: x / len, y: y / len, z: z / len };
})();
const buildPalette = () => TILE_ID_TO_TYPE.map((tileType) => {
    const rgb = TILE_COLOR_RGB[tileType];
    return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
});
const noiseAt = (value) => {
    const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
};
const buildWaterMaskTexture = (sample, sampleCols, sampleRows, step, waterId) => {
    const { cols, rows } = sample;
    const tileTypes = sample.tileTypes;
    const data = new Uint8Array(sampleCols * sampleRows * 4);
    let offset = 0;
    for (let row = 0; row < sampleRows; row += 1) {
        const tileY = Math.min(rows - 1, row * step);
        for (let col = 0; col < sampleCols; col += 1) {
            const tileX = Math.min(cols - 1, col * step);
            const idx = tileY * cols + tileX;
            const typeId = tileTypes ? tileTypes[idx] ?? waterId : waterId;
            const alpha = typeId === waterId ? 255 : 0;
            data[offset] = 255;
            data[offset + 1] = 255;
            data[offset + 2] = 255;
            data[offset + 3] = alpha;
            offset += 4;
        }
    }
    const texture = new THREE.DataTexture(data, sampleCols, sampleRows, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.flipY = true;
    texture.generateMipmaps = false;
    return texture;
};
const buildTileTexture = (sample, sampleCols, sampleRows, step, palette, grassId, forestId, heightScale) => {
    const { cols, rows, elevations } = sample;
    const tileTypes = sample.tileTypes;
    const data = new Uint8Array(sampleCols * sampleRows * 4);
    const getHeight = (x, y) => {
        const clampedX = Math.max(0, Math.min(cols - 1, x));
        const clampedY = Math.max(0, Math.min(rows - 1, y));
        const idx = clampedY * cols + clampedX;
        return elevations[idx] ?? 0;
    };
    let offset = 0;
    for (let row = 0; row < sampleRows; row += 1) {
        const tileY = Math.min(rows - 1, row * step);
        for (let col = 0; col < sampleCols; col += 1) {
            const tileX = Math.min(cols - 1, col * step);
            const idx = tileY * cols + tileX;
            const typeId = tileTypes ? tileTypes[idx] ?? grassId : grassId;
            const colorType = typeId === forestId ? grassId : typeId;
            const color = palette[colorType] ?? palette[grassId];
            const height = elevations[idx] ?? 0;
            const baseNoise = noiseAt(idx + 1);
            const fineNoise = (noiseAt(idx * 3.7 + 17.7) - 0.5) * 0.04;
            const heightTone = clamp(0.88 + height * 0.08, 0.72, 1.05);
            const noise = (baseNoise - 0.5) * 0.08;
            const heightLeft = getHeight(tileX - step, tileY);
            const heightRight = getHeight(tileX + step, tileY);
            const heightUp = getHeight(tileX, tileY - step);
            const heightDown = getHeight(tileX, tileY + step);
            const dx = (heightRight - heightLeft) * heightScale;
            const dz = (heightDown - heightUp) * heightScale;
            const nx = -dx;
            const ny = 2;
            const nz = -dz;
            const nLen = Math.hypot(nx, ny, nz) || 1;
            const light = (nx / nLen) * SUN_DIR.x + (ny / nLen) * SUN_DIR.y + (nz / nLen) * SUN_DIR.z;
            const shade = clamp(0.68 + light * 0.32, 0.55, 1);
            const slope = Math.sqrt(dx * dx + dz * dz);
            const occlusion = clamp(1 - slope * 0.06, 0.7, 1);
            const tone = heightTone * shade * occlusion;
            const r = clamp((color[0] + noise) * tone + fineNoise, 0, 1) * 255;
            const g = clamp((color[1] + noise) * tone + fineNoise, 0, 1) * 255;
            const b = clamp((color[2] + noise) * tone + fineNoise, 0, 1) * 255;
            data[offset] = Math.round(r);
            data[offset + 1] = Math.round(g);
            data[offset + 2] = Math.round(b);
            data[offset + 3] = 255;
            offset += 4;
        }
    }
    const texture = new THREE.DataTexture(data, sampleCols, sampleRows, THREE.RGBAFormat);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.flipY = true;
    texture.generateMipmaps = false;
    return texture;
};
const buildTerrainMesh = (sample) => {
    const { cols, rows, elevations } = sample;
    const palette = buildPalette();
    const grassId = TILE_TYPE_IDS.grass;
    const forestId = TILE_TYPE_IDS.forest;
    const waterId = TILE_TYPE_IDS.water;
    const maxDim = Math.max(cols, rows);
    const step = Math.max(1, Math.floor(maxDim / 128));
    const sampleCols = Math.floor((cols - 1) / step) + 1;
    const sampleRows = Math.floor((rows - 1) / step) + 1;
    const width = (sampleCols - 1) * step;
    const depth = (sampleRows - 1) * step;
    const geometry = new THREE.PlaneGeometry(width, depth, sampleCols - 1, sampleRows - 1);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    const heightScale = 6;
    let minHeight = Number.POSITIVE_INFINITY;
    let maxHeight = Number.NEGATIVE_INFINITY;
    let waterHeightSum = 0;
    let waterCount = 0;
    let vertexIndex = 0;
    const trees = [];
    for (let row = 0; row < sampleRows; row += 1) {
        const tileY = Math.min(rows - 1, row * step);
        for (let col = 0; col < sampleCols; col += 1) {
            const tileX = Math.min(cols - 1, col * step);
            const idx = tileY * cols + tileX;
            const height = elevations[idx] ?? 0;
            const clampedHeight = clamp(height, -1, 1);
            const y = clampedHeight * heightScale;
            positions.setY(vertexIndex, y);
            minHeight = Math.min(minHeight, y);
            maxHeight = Math.max(maxHeight, y);
            const typeId = sample.tileTypes ? sample.tileTypes[idx] ?? grassId : grassId;
            if (typeId === waterId) {
                waterHeightSum += y;
                waterCount += 1;
            }
            if (typeId === forestId) {
                const baseScale = Math.max(0.6, step * 0.35);
                const jitterX = (noiseAt(idx + 0.27) - 0.5) * 0.6 * step;
                const jitterZ = (noiseAt(idx + 0.61) - 0.5) * 0.6 * step;
                const trunkHeight = baseScale * (0.8 + noiseAt(idx + 1.7) * 0.6);
                const trunkRadius = baseScale * 0.12 * (0.85 + noiseAt(idx + 2.3) * 0.4);
                const canopyHeight = baseScale * 1.3 * (0.8 + noiseAt(idx + 3.1) * 0.5);
                const canopyRadius = baseScale * 0.7 * (0.8 + noiseAt(idx + 4.2) * 0.6);
                const x = (col / Math.max(1, sampleCols - 1) - 0.5) * width + jitterX;
                const z = (row / Math.max(1, sampleRows - 1) - 0.5) * depth + jitterZ;
                trees.push({ x, y, z, trunkHeight, trunkRadius, canopyHeight, canopyRadius });
            }
            vertexIndex += 1;
        }
    }
    geometry.computeVertexNormals();
    const tileTexture = buildTileTexture(sample, sampleCols, sampleRows, step, palette, grassId, forestId, heightScale);
    const material = new THREE.MeshStandardMaterial({
        map: tileTexture,
        roughness: 0.88,
        metalness: 0
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    if (trees.length > 0) {
        const trunkGeometry = new THREE.CylinderGeometry(0.1, 0.14, 1, 6);
        const canopyGeometry = new THREE.ConeGeometry(0.6, 1.2, 7);
        const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.92, metalness: 0 });
        const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x2f5a34, roughness: 0.92, metalness: 0 });
        const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
        const canopyMesh = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, trees.length);
        trunkMesh.castShadow = true;
        canopyMesh.castShadow = true;
        const dummy = new THREE.Object3D();
        trees.forEach((tree, i) => {
            dummy.position.set(tree.x, tree.y + tree.trunkHeight * 0.5, tree.z);
            dummy.scale.set(tree.trunkRadius / 0.1, tree.trunkHeight, tree.trunkRadius / 0.1);
            dummy.updateMatrix();
            trunkMesh.setMatrixAt(i, dummy.matrix);
            dummy.position.set(tree.x, tree.y + tree.trunkHeight + tree.canopyHeight * 0.5, tree.z);
            dummy.scale.set(tree.canopyRadius / 0.6, tree.canopyHeight / 1.2, tree.canopyRadius / 0.6);
            dummy.updateMatrix();
            canopyMesh.setMatrixAt(i, dummy.matrix);
        });
        trunkMesh.instanceMatrix.needsUpdate = true;
        canopyMesh.instanceMatrix.needsUpdate = true;
        mesh.add(trunkMesh, canopyMesh);
    }
    mesh.position.y = -0.75 + (minHeight + maxHeight) * -0.15;
    const water = waterCount > 0
        ? {
            mask: buildWaterMaskTexture(sample, sampleCols, sampleRows, step, waterId),
            level: waterHeightSum / waterCount,
            sampleCols,
            sampleRows,
            width,
            depth
        }
        : undefined;
    return { mesh, size: { width, depth }, water };
};
export const createThreeTest = (canvas) => {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2));
    renderer.setClearColor(0x0c0d11, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1d21);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(2.6, 2.2, 3.4);
    camera.lookAt(0, 0, 0);
    const hemisphere = new THREE.HemisphereLight(0xd6d3c4, 0x2d362b, 0.55);
    scene.add(hemisphere);
    const ambient = new THREE.AmbientLight(0xffffff, 0.25);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffe6c2, 0.95);
    keyLight.position.set(4, 5, 2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.00035;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x88a9c9, 0.35);
    fillLight.position.set(-4, 2.5, -2);
    scene.add(fillLight);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.minDistance = 3;
    controls.maxDistance = 120;
    controls.target.set(0, 0, 0);
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xd34b2a, roughness: 0.55, metalness: 0.2 }));
    cube.castShadow = true;
    scene.add(cube);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.9;
    ground.receiveShadow = true;
    scene.add(ground);
    let terrainMesh = null;
    let waterMesh = null;
    let waterUniforms = null;
    let raf = 0;
    let running = false;
    const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };
    const renderFrame = (time) => {
        if (!running) {
            return;
        }
        cube.rotation.y = time * 0.0006;
        cube.rotation.x = time * 0.00035;
        if (waterUniforms) {
            waterUniforms.u_time.value = time * 0.001;
        }
        controls.update();
        renderer.render(scene, camera);
        raf = window.requestAnimationFrame(renderFrame);
    };
    const start = () => {
        if (running) {
            return;
        }
        running = true;
        controls.enabled = true;
        resize();
        raf = window.requestAnimationFrame(renderFrame);
    };
    const stop = () => {
        running = false;
        controls.enabled = false;
        if (raf) {
            window.cancelAnimationFrame(raf);
        }
    };
    const updateCameraForSize = (size) => {
        const distance = Math.max(8, size * 0.6);
        camera.near = 0.1;
        camera.far = Math.max(200, distance * 6);
        camera.position.set(distance * 0.65, distance * 0.55, distance * 0.65);
        controls.minDistance = Math.max(3, distance * 0.15);
        controls.maxDistance = Math.max(120, distance * 4);
        controls.target.set(0, 0, 0);
        keyLight.position.set(distance * 0.45, distance * 0.85, distance * 0.35);
        if (waterUniforms) {
            waterUniforms.u_lightDir.value.copy(keyLight.position).normalize();
        }
        const shadowCam = keyLight.shadow.camera;
        const shadowExtent = Math.max(10, size * 0.7);
        shadowCam.left = -shadowExtent;
        shadowCam.right = shadowExtent;
        shadowCam.top = shadowExtent;
        shadowCam.bottom = -shadowExtent;
        shadowCam.near = 0.1;
        shadowCam.far = Math.max(200, distance * 5);
        shadowCam.updateProjectionMatrix();
        camera.updateProjectionMatrix();
        controls.update();
    };
    const setTerrain = (sample) => {
        if (terrainMesh) {
            scene.remove(terrainMesh);
            terrainMesh.geometry.dispose();
            if (Array.isArray(terrainMesh.material)) {
                terrainMesh.material.forEach((material) => {
                    const textured = material;
                    if (textured.map) {
                        textured.map.dispose();
                    }
                    material.dispose();
                });
            }
            else {
                const textured = terrainMesh.material;
                if (textured.map) {
                    textured.map.dispose();
                }
                terrainMesh.material.dispose();
            }
            terrainMesh = null;
        }
        if (waterMesh) {
            scene.remove(waterMesh);
            waterMesh.geometry.dispose();
            if (waterUniforms?.u_mask.value) {
                waterUniforms.u_mask.value.dispose();
            }
            const material = waterMesh.material;
            if (Array.isArray(material)) {
                material.forEach((mat) => mat.dispose());
            }
            else {
                material.dispose();
            }
            waterMesh = null;
            waterUniforms = null;
        }
        if (sample.cols <= 1 || sample.rows <= 1 || sample.elevations.length === 0) {
            ground.visible = true;
            return;
        }
        const { mesh, size, water } = buildTerrainMesh(sample);
        terrainMesh = mesh;
        scene.add(terrainMesh);
        ground.visible = false;
        const maxSize = Math.max(size.width, size.depth);
        updateCameraForSize(maxSize);
        if (water) {
            const waterGeometry = new THREE.PlaneGeometry(water.width, water.depth, Math.max(1, water.sampleCols - 1), Math.max(1, water.sampleRows - 1));
            waterGeometry.rotateX(-Math.PI / 2);
            waterUniforms = {
                u_time: { value: 0 },
                u_mask: { value: water.mask },
                u_color: { value: new THREE.Color(0x3b7f9c) },
                u_deepColor: { value: new THREE.Color(0x143449) },
                u_opacity: { value: 0.68 },
                u_waveScale: { value: 0.28 },
                u_lightDir: { value: keyLight.position.clone().normalize() },
                u_specular: { value: 0.6 }
            };
            const waterMaterial = new THREE.ShaderMaterial({
                uniforms: waterUniforms,
                transparent: true,
                depthWrite: false,
                vertexShader: `
          varying vec2 vUv;
          varying vec3 vWorldPos;
          uniform float u_time;
          uniform float u_waveScale;
          void main() {
            vUv = uv;
            vec3 pos = position;
            float wave = sin((pos.x * 0.16 + u_time * 0.55)) * 0.2
              + sin((pos.z * 0.22 - u_time * 0.42)) * 0.16;
            pos.y += wave * u_waveScale;
            vec4 worldPos = modelMatrix * vec4(pos, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `,
                fragmentShader: `
          varying vec2 vUv;
          varying vec3 vWorldPos;
          uniform sampler2D u_mask;
          uniform vec3 u_color;
          uniform vec3 u_deepColor;
          uniform float u_opacity;
          uniform float u_time;
          uniform vec3 u_lightDir;
          uniform float u_specular;
          void main() {
            float mask = texture2D(u_mask, vUv).a;
            if (mask < 0.02) discard;
            float wave = sin((vWorldPos.x + vWorldPos.z) * 0.2 + u_time * 0.7);
            float ripple = wave * 0.035;
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            float waveX = cos((vWorldPos.x * 0.16 + u_time * 0.55)) * 0.16;
            float waveZ = cos((vWorldPos.z * 0.22 - u_time * 0.42)) * 0.22;
            vec3 normal = normalize(vec3(-waveX * u_waveScale, 1.0, -waveZ * u_waveScale));
            vec3 lightDir = normalize(u_lightDir);
            float diffuse = max(dot(normal, lightDir), 0.0);
            float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);
            vec3 halfDir = normalize(lightDir + viewDir);
            float spec = pow(max(dot(normal, halfDir), 0.0), 40.0) * u_specular;
            vec3 color = mix(u_deepColor, u_color, 0.6 + ripple + diffuse * 0.08);
            color += fresnel * 0.16 + spec;
            gl_FragColor = vec4(color, u_opacity * mask);
          }
        `
            });
            waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
            waterMesh.position.y = mesh.position.y + water.level + 0.08;
            waterMesh.renderOrder = 2;
            waterMesh.receiveShadow = false;
            scene.add(waterMesh);
        }
    };
    return { start, stop, resize, setTerrain };
};
