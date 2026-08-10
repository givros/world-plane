import * as THREE from 'three';
import {
  BIOME_CHUNK_SIZE,
  createInfiniteBiomeWorldForReview,
  type InfiniteBiomeWorldDiagnostics,
} from './InfiniteBiomeWorld';

export type WorldReviewView =
  | 'top'
  | 'north-west'
  | 'north-east'
  | 'south-east'
  | 'south-west'
  | 'low-x'
  | 'low-z'
  | 'seam-east'
  | 'seam-south'
  | 'landing-approach';

export type WorldReviewHarness = Readonly<{
  canvas: HTMLCanvasElement;
  diagnostics: Readonly<InfiniteBiomeWorldDiagnostics>;
  renderer: Readonly<{
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  }>;
  render: () => void;
  dispose: () => void;
}>;

function configureCamera(
  camera: THREE.PerspectiveCamera,
  view: WorldReviewView,
  chunkX: number,
  chunkZ: number,
  terrainHeight: (worldX: number, worldZ: number) => number,
): void {
  const centerX = chunkX * BIOME_CHUNK_SIZE;
  const centerZ = chunkZ * BIOME_CHUNK_SIZE;
  const centerY = terrainHeight(centerX, centerZ);
  const target = new THREE.Vector3(centerX, centerY + 4, centerZ);
  camera.up.set(0, 1, 0);

  switch (view) {
    case 'top':
      camera.position.set(centerX, centerY + 1260, centerZ + 0.01);
      camera.up.set(0, 0, -1);
      break;
    case 'north-west':
      camera.position.set(centerX - 720, centerY + 430, centerZ - 720);
      break;
    case 'north-east':
      camera.position.set(centerX + 720, centerY + 430, centerZ - 720);
      break;
    case 'south-east':
      camera.position.set(centerX + 720, centerY + 430, centerZ + 720);
      break;
    case 'south-west':
      camera.position.set(centerX - 720, centerY + 430, centerZ + 720);
      break;
    case 'low-x':
      camera.position.set(centerX - 510, centerY + 18, centerZ - 70);
      target.set(centerX + 250, centerY + 12, centerZ + 35);
      break;
    case 'low-z':
      camera.position.set(centerX + 55, centerY + 20, centerZ - 520);
      target.set(centerX - 60, centerY + 11, centerZ + 250);
      break;
    case 'seam-east': {
      const seamX = centerX + BIOME_CHUNK_SIZE * 0.5;
      const seamY = terrainHeight(seamX, centerZ);
      camera.position.set(seamX - 330, seamY + 180, centerZ - 330);
      target.set(seamX, seamY + 3, centerZ);
      break;
    }
    case 'seam-south': {
      const seamZ = centerZ + BIOME_CHUNK_SIZE * 0.5;
      const seamY = terrainHeight(centerX, seamZ);
      camera.position.set(centerX - 330, seamY + 180, seamZ - 330);
      target.set(centerX, seamY + 3, seamZ);
      break;
    }
    case 'landing-approach': {
      const corridorX = centerX - 368;
      const corridorZ = centerZ - 144;
      const corridorY = terrainHeight(corridorX, corridorZ);
      camera.position.set(corridorX, corridorY + 12, corridorZ - 205);
      target.set(corridorX, corridorY + 3, corridorZ + 95);
      break;
    }
  }
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

export function mountWorldReview(options: {
  source: 'compiled' | 'procedural';
  chunkX: number;
  chunkZ: number;
  view: WorldReviewView;
  width?: number;
  height?: number;
  parent?: HTMLElement;
}): WorldReviewHarness {
  const width = options.width ?? 960;
  const height = options.height ?? 600;
  const canvas = document.createElement('canvas');
  canvas.dataset.worldReview = options.source;
  canvas.style.display = 'block';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  (options.parent ?? document.body).append(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9fc8d8');
  scene.fog = new THREE.Fog('#9fc8d8', 900, 2200);
  const hemisphere = new THREE.HemisphereLight('#e7f6ff', '#557047', 2.2);
  const sun = new THREE.DirectionalLight('#fff0cf', 3.1);
  sun.position.set(-520, 920, -380);
  scene.add(hemisphere, sun);

  const world = createInfiniteBiomeWorldForReview({ source: options.source });
  scene.add(world.group);
  const centerX = options.chunkX * BIOME_CHUNK_SIZE;
  const centerZ = options.chunkZ * BIOME_CHUNK_SIZE;
  world.recenterNow(new THREE.Vector3(centerX, 0, centerZ));

  const camera = new THREE.PerspectiveCamera(48, width / height, 0.5, 6000);
  configureCamera(
    camera,
    options.view,
    options.chunkX,
    options.chunkZ,
    world.getTerrainHeight,
  );

  const render = (): void => {
    scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
  };
  render();

  return {
    canvas,
    get diagnostics() {
      return world.diagnostics;
    },
    get renderer() {
      return {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
      };
    },
    render,
    dispose: () => {
      world.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
