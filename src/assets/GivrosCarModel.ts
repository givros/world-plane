import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type GivrosCarModelOptions = {
  castShadow?: boolean;
  receiveShadow?: boolean;
  wireframe?: boolean;
};

export type GivrosCarLoadState = 'loading' | 'ready' | 'failed' | 'disposed';

export type GivrosCarCollider = {
  shape: 'box' | 'sphere';
  center: [number, number, number];
  halfExtents?: [number, number, number];
  radius?: number;
  node: THREE.Object3D;
};

export type GivrosCarRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, GivrosCarCollider>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

export type GivrosCarDiagnostics = {
  name: string;
  source: 'blender-glb';
  loadState: GivrosCarLoadState;
  dimensions: {
    length: number;
    paintedWidth: number;
    overallWidth: number;
    height: number;
    wheelbase: number;
    wheelRadius: number;
    trackWidth: number;
  };
  plate: '@givros';
  partCount: number;
  triangleCount: number;
  colliderCount: number;
};

export type GivrosCarModel = {
  root: THREE.Group;
  runtime: GivrosCarRuntime;
  wheelPivots: readonly THREE.Group[];
  diagnostics: GivrosCarDiagnostics;
  ready: Promise<boolean>;
  dispose(): void;
};

const CAR_ASSET_URL = new URL('./car/GivrosCarRuntime.glb', import.meta.url).href;
const SOURCE_DIMENSIONS = Object.freeze({
  length: 4.24,
  overallWidth: 2.079544,
  height: 1.661704,
  wheelRadius: 0.379796,
});
// Calibrated against the 1.70 m playable character and the 9.80 m airplane.
// The slightly oversized stylized footprint keeps the car readable beside
// both playable entities without returning to the source's exaggerated height.
const TARGET_DIMENSIONS = Object.freeze({
  length: 4.58,
  paintedWidth: 1.92,
  overallWidth: 1.97,
  height: 1.46,
  wheelbase: 2.637641,
  wheelRadius: 0.335,
  trackWidth: 1.587876,
});
const WIDTH_SCALE = TARGET_DIMENSIONS.overallWidth / SOURCE_DIMENSIONS.overallWidth;
const HEIGHT_SCALE = TARGET_DIMENSIONS.height / SOURCE_DIMENSIONS.height;
const LENGTH_SCALE = TARGET_DIMENSIONS.length / SOURCE_DIMENSIONS.length;
const WHEEL_SCALE = TARGET_DIMENSIONS.wheelRadius / SOURCE_DIMENSIONS.wheelRadius;
const WHEEL_PIVOT_NAMES = [
  'wheel-pivot-front-left',
  'wheel-pivot-front-right',
  'wheel-pivot-rear-left',
  'wheel-pivot-rear-right',
] as const;

function disposeHierarchy(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
    nodeMaterials.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
    });
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  root.removeFromParent();
}

function tuple3(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => !Number.isFinite(entry))) {
    return undefined;
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function scaleNodePosition(
  node: THREE.Object3D | undefined,
  scaleX = WIDTH_SCALE,
  scaleY = HEIGHT_SCALE,
  scaleZ = LENGTH_SCALE,
): void {
  if (!node) return;
  node.position.x *= scaleX;
  node.position.y *= scaleY;
  node.position.z *= scaleZ;
}

function calibrateRuntimeProportions(
  runtime: GivrosCarRuntime,
  wheelPivots: readonly THREE.Group[],
): void {
  const authoredRoot = runtime.nodes.BlueCometGivrosCar;
  const authoredDimensions = tuple3(authoredRoot?.userData.dimensionsMeters);
  const alreadyCalibrated = authoredDimensions
    && Math.abs(authoredDimensions[0] - TARGET_DIMENSIONS.length) < 0.01
    && Math.abs(authoredDimensions[1] - TARGET_DIMENSIONS.overallWidth) < 0.01
    && Math.abs(authoredDimensions[2] - TARGET_DIMENSIONS.height) < 0.01;
  if (alreadyCalibrated) return;

  const visual = runtime.nodes['car-visual'];
  if (visual) {
    visual.scale.x *= WIDTH_SCALE;
    visual.scale.y *= HEIGHT_SCALE;
    visual.scale.z *= LENGTH_SCALE;
    visual.position.y *= HEIGHT_SCALE;
    visual.position.z *= LENGTH_SCALE;
  }

  for (const pivot of wheelPivots) {
    pivot.position.x *= WIDTH_SCALE;
    pivot.position.y = TARGET_DIMENSIONS.wheelRadius;
    pivot.position.z *= LENGTH_SCALE;
    pivot.scale.multiplyScalar(WHEEL_SCALE);
  }
  for (const [name, node] of Object.entries(runtime.nodes)) {
    if (name.startsWith('socket-')) scaleNodePosition(node);
    if (name.startsWith('collider-wheel-')) {
      node.position.x *= WIDTH_SCALE;
      node.position.y = TARGET_DIMENSIONS.wheelRadius;
      node.position.z *= LENGTH_SCALE;
      node.userData.radius = TARGET_DIMENSIONS.wheelRadius;
    }
  }

  for (const name of ['rear-plate-givros', 'rear-plate-text-givros']) {
    const node = runtime.nodes[name];
    if (!node) continue;
    scaleNodePosition(node);
    node.scale.x *= WIDTH_SCALE;
    node.scale.y *= HEIGHT_SCALE;
    node.scale.z *= LENGTH_SCALE;
  }

  for (const name of ['collider-body', 'collider-cabin']) {
    const node = runtime.nodes[name];
    if (!node) continue;
    scaleNodePosition(node);
    node.scale.x *= WIDTH_SCALE;
    node.scale.y *= HEIGHT_SCALE;
    node.scale.z *= LENGTH_SCALE;
    const halfExtents = tuple3(node.userData.halfExtents);
    if (halfExtents) {
      node.userData.halfExtents = [
        halfExtents[0] * WIDTH_SCALE,
        halfExtents[1] * HEIGHT_SCALE,
        halfExtents[2] * LENGTH_SCALE,
      ];
    }
  }

  if (authoredRoot) {
    authoredRoot.userData.dimensionsMeters = [
      TARGET_DIMENSIONS.length,
      TARGET_DIMENSIONS.overallWidth,
      TARGET_DIMENSIONS.height,
    ];
    authoredRoot.userData.wheelbaseMeters = TARGET_DIMENSIONS.wheelbase;
    authoredRoot.userData.wheelRadiusMeters = TARGET_DIMENSIONS.wheelRadius;
    authoredRoot.userData.trackWidthMeters = TARGET_DIMENSIONS.trackWidth;
    authoredRoot.userData.runtimeProportionCalibration = 'character-and-aircraft-scale-v1';
  }
}

export function createGivrosCarModel(options: GivrosCarModelOptions = {}): GivrosCarModel {
  const root = new THREE.Group();
  root.name = 'givros-car-root';
  root.userData.assetId = 'givros-blue-comet';
  root.userData.source = 'blender-glb';
  root.userData.plateText = '@givros';

  const runtime: GivrosCarRuntime = {
    nodes: {},
    meshes: {},
    sockets: {},
    colliders: {},
    destructionGroups: {},
  };
  const wheelPivots: THREE.Group[] = [];
  const diagnostics: GivrosCarDiagnostics = {
    name: 'Sally @givros Sports Car',
    source: 'blender-glb',
    loadState: 'loading',
    dimensions: {
      ...TARGET_DIMENSIONS,
    },
    plate: '@givros',
    partCount: 0,
    triangleCount: 0,
    colliderCount: 0,
  };
  let loadedScene: THREE.Object3D | null = null;
  let disposed = false;

  const ready = new GLTFLoader().loadAsync(CAR_ASSET_URL).then((gltf) => {
    if (disposed) {
      disposeHierarchy(gltf.scene);
      return false;
    }
    loadedScene = gltf.scene;
    loadedScene.name ||= 'BlueCometGivrosCar';
    root.add(loadedScene);
    root.updateMatrixWorld(true);

    let partCount = 0;
    let triangleCount = 0;
    loadedScene.traverse((node) => {
      if (node.name) {
        runtime.nodes[node.name] = node;
        partCount += 1;
      }
      if (node.name.startsWith('socket-')) runtime.sockets[node.name] = node;
      if (node instanceof THREE.Mesh) {
        runtime.meshes[node.name] = node;
        node.castShadow = options.castShadow ?? true;
        node.receiveShadow = options.receiveShadow ?? true;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((material) => {
          if ('wireframe' in material) material.wireframe = options.wireframe ?? false;
        });
        const indexCount = node.geometry.index?.count;
        const vertexCount = node.geometry.getAttribute('position')?.count ?? 0;
        triangleCount += (indexCount ?? vertexCount) / 3;
      }
    });

    for (const name of WHEEL_PIVOT_NAMES) {
      const pivot = runtime.nodes[name];
      if (pivot) wheelPivots.push(pivot as THREE.Group);
    }
    calibrateRuntimeProportions(runtime, wheelPivots);
    root.updateMatrixWorld(true);
    Object.entries(runtime.nodes).forEach(([name, node]) => {
      if (!name.startsWith('collider-')) return;
      const isWheel = name.includes('wheel');
      const center: [number, number, number] = [node.position.x, node.position.y, node.position.z];
      runtime.colliders[name] = isWheel
        ? { shape: 'sphere', center, radius: Number(node.userData.radius ?? 0.35), node }
        : { shape: 'box', center, halfExtents: tuple3(node.userData.halfExtents), node };
    });
    runtime.destructionGroups = {
      chassis: ['body-shell']
        .map((name) => runtime.nodes[name])
        .filter((node): node is THREE.Object3D => Boolean(node)),
      glass: Object.entries(runtime.nodes)
        .filter(([name]) => name.includes('glass') || name.includes('window'))
        .map(([, node]) => node),
      wheels: [...wheelPivots],
    };
    root.userData.sculptRuntime = runtime;
    const authoredRoot = loadedScene.getObjectByName('BlueCometGivrosCar');
    const authoredPartCount = Number(authoredRoot?.userData.authoredPartCount);
    const dimensions = tuple3(authoredRoot?.userData.dimensionsMeters);
    if (dimensions) {
      diagnostics.dimensions.length = dimensions[0];
      diagnostics.dimensions.overallWidth = dimensions[1];
      diagnostics.dimensions.height = dimensions[2];
    }
    const wheelbase = Number(authoredRoot?.userData.wheelbaseMeters);
    const wheelRadius = Number(authoredRoot?.userData.wheelRadiusMeters);
    const trackWidth = Number(authoredRoot?.userData.trackWidthMeters);
    if (Number.isFinite(wheelbase)) diagnostics.dimensions.wheelbase = wheelbase;
    if (Number.isFinite(wheelRadius)) diagnostics.dimensions.wheelRadius = wheelRadius;
    if (Number.isFinite(trackWidth)) diagnostics.dimensions.trackWidth = trackWidth;
    diagnostics.partCount = Number.isFinite(authoredPartCount) ? authoredPartCount : partCount;
    diagnostics.triangleCount = Math.round(triangleCount);
    diagnostics.colliderCount = Object.keys(runtime.colliders).length;
    diagnostics.loadState = 'ready';
    return true;
  }).catch((error: unknown) => {
    if (!disposed) {
      diagnostics.loadState = 'failed';
      root.userData.loadError = error instanceof Error ? error.message : String(error);
    }
    return false;
  });

  return {
    root,
    runtime,
    wheelPivots,
    diagnostics,
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      diagnostics.loadState = 'disposed';
      if (loadedScene) disposeHierarchy(loadedScene);
      delete root.userData.sculptRuntime;
      root.clear();
      root.removeFromParent();
      wheelPivots.length = 0;
      Object.keys(runtime.nodes).forEach((key) => delete runtime.nodes[key]);
      Object.keys(runtime.meshes).forEach((key) => delete runtime.meshes[key]);
      Object.keys(runtime.sockets).forEach((key) => delete runtime.sockets[key]);
      Object.keys(runtime.colliders).forEach((key) => delete runtime.colliders[key]);
      Object.keys(runtime.destructionGroups).forEach((key) => delete runtime.destructionGroups[key]);
    },
  };
}
