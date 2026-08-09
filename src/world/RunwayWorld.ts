import * as THREE from 'three';
import {
  createAirportMaterialLibrary,
  type AirportMaterialLibrary,
} from '../assets/MaterialLibrary';

const RUNWAY_WIDTH = 24;
const PAVED_LENGTH = 360;
const SOUTH_THRESHOLD_Z = -150;
const NORTH_THRESHOLD_Z = 150;
const RUNWAY_SURFACE_Y = 0;
const SAFE_CORRIDOR_HALF_WIDTH = 18;
const WORLD_FOG_NEAR = 580;
const WORLD_FOG_FAR = 1040;
const CLOUD_WRAP_SAFETY_DISTANCE = 300;
const CLOUD_WRAP_DISTANCE = WORLD_FOG_FAR * 2 + CLOUD_WRAP_SAFETY_DISTANCE;
const CLOUD_MATRIX_SCRATCH = new THREE.Matrix4();
const CLOUD_QUATERNION_SCRATCH = new THREE.Quaternion();
const CLOUD_POSITION_SCRATCH = new THREE.Vector3();
const CLOUD_EULER_SCRATCH = new THREE.Euler();

export type RunwayEnvironmentMetadata = {
  groundElevation: number;
  landingElevation: number;
  centerlineX: number;
  runwayWidth: number;
  pavedLength: number;
  usableLength: number;
  southThresholdZ: number;
  northThresholdZ: number;
  pavedBounds: THREE.Box3;
  safeCorridorHalfWidth: number;
  preferredTakeoffDirectionZ: 1;
  parkingPosition: THREE.Vector3;
  rolloutStopPosition: THREE.Vector3;
  sunlightDirection: THREE.Vector3;
  fog: {
    color: THREE.Color;
    near: number;
    far: number;
  };
};

export type RunwayWorldDiagnostics = {
  meshes: number;
  instancedMeshes: number;
  instances: number;
  uniqueGeometries: number;
  uniqueMaterials: number;
  textures: number;
  approximateTriangles: number;
  lights: number;
  shadowCasters: number;
  shadowReceivers: number;
  scenicProps: number;
  cloudPuffs: number;
  treeCount: number;
  runwayEdgeLights: number;
};

export type RunwayWorld = {
  group: THREE.Group;
  environment: RunwayEnvironmentMetadata;
  diagnostics: RunwayWorldDiagnostics;
  update: (
    deltaSeconds: number,
    elapsedSeconds?: number,
    focusPosition?: Readonly<THREE.Vector3>,
  ) => void;
  setAirportVisible: (visible: boolean) => void;
  setSceneryVisible: (visible: boolean) => void;
  dispose: () => void;
};

type RandomSource = () => number;

type CloudPuff = {
  base: THREE.Vector3;
  scale: THREE.Vector3;
  phase: number;
  drift: number;
};

type CloudSystem = {
  mesh: THREE.InstancedMesh;
  puffs: CloudPuff[];
};

type CloudClusterSpec = Readonly<{
  center: readonly [number, number, number];
  puffs: number;
  spread: readonly [number, number, number];
  scale: readonly [number, number, number];
  crown: number;
}>;

type WorldAnimationHandles = {
  cloudSystem: CloudSystem;
  windsockPivot: THREE.Group;
  windsockSleeve: THREE.Group;
  skyDome: THREE.Mesh;
  lighting: THREE.Group;
};

function createSeededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

function setShadow(mesh: THREE.Mesh, cast: boolean, receive: boolean): void {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
}

function createGroundPolygon(
  name: string,
  points: readonly (readonly [number, number])[],
  material: THREE.Material,
  elevation: number,
): THREE.Mesh {
  const positions: number[] = [];
  for (const [x, z] of points) positions.push(x, elevation, z);

  const indices: number[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    indices.push(0, index, index + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  return mesh;
}

function buildRibbonGeometry(points: readonly THREE.Vector3[], halfWidth: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    tangent.subVectors(next, previous).setY(0).normalize();
    side.set(-tangent.z, 0, tangent.x).multiplyScalar(halfWidth);
    const point = points[index];
    positions.push(point.x + side.x, point.y, point.z + side.z);
    positions.push(point.x - side.x, point.y, point.z - side.z);
    const v = index / Math.max(1, points.length - 1);
    uvs.push(0, v, 1, v);
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const a = index * 2;
    indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createSkyDome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(2400, 48, 24);
  const material = new THREE.ShaderMaterial({
    name: 'layered-summer-sky-and-aerial-haze',
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenithColor: { value: new THREE.Color('#3f86c3') },
      upperColor: { value: new THREE.Color('#82bfe3') },
      horizonColor: { value: new THREE.Color('#c4d9df') },
      lowerColor: { value: new THREE.Color('#e6d6ba') },
      hazeColor: { value: new THREE.Color('#c4d9df') },
      sunHazeColor: { value: new THREE.Color('#f4c58e') },
      sunDirection: { value: new THREE.Vector3(-0.48, 0.58, -0.65).normalize() },
    },
    vertexShader: `
      varying vec3 vSkyDirection;
      void main() {
        vSkyDirection = normalize(position);
        vec4 clipPosition = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = clipPosition.xyww;
      }
    `,
    fragmentShader: `
      uniform vec3 zenithColor;
      uniform vec3 upperColor;
      uniform vec3 horizonColor;
      uniform vec3 lowerColor;
      uniform vec3 hazeColor;
      uniform vec3 sunHazeColor;
      uniform vec3 sunDirection;
      varying vec3 vSkyDirection;
      void main() {
        vec3 direction = normalize(vSkyDirection);
        float height = direction.y;
        float upperBlend = smoothstep(0.34, 0.88, height);
        float horizonBlend = smoothstep(-0.18, 0.055, height);
        float aerialBand = exp(-pow((height - 0.012) * 8.5, 2.0));
        vec3 sky = mix(lowerColor, horizonColor, horizonBlend);
        sky = mix(sky, upperColor, smoothstep(0.16, 0.56, height));
        sky = mix(sky, zenithColor, upperBlend);
        sky = mix(sky, hazeColor, aerialBand * 0.34);
        float sunAmount = max(dot(direction, normalize(sunDirection)), 0.0);
        float horizonScatter = pow(sunAmount, 5.0) * aerialBand * 0.22;
        float halo = pow(sunAmount, 18.0) * 0.20;
        float disc = pow(sunAmount, 460.0) * 0.78;
        sky = mix(sky, sunHazeColor, horizonScatter);
        sky += vec3(1.0, 0.77, 0.43) * halo + vec3(1.0, 0.93, 0.76) * disc;
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(geometry, material);
  dome.name = 'sky-dome-gradient-and-sun';
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  return dome;
}

function createFieldLayer(materials: AirportMaterialLibrary): THREE.Group {
  const layer = new THREE.Group();
  layer.name = 'ground-fields-and-farm-plots';

  const plots: Array<{
    name: string;
    points: readonly (readonly [number, number])[];
    material: THREE.Material;
  }> = [
    {
      name: 'west-light-meadow',
      points: [[-350, -310], [-34, -310], [-28, -126], [-43, -58], [-350, -72]],
      material: materials.grassLight,
    },
    {
      name: 'west-deep-pasture',
      points: [[-350, -68], [-44, -55], [-34, 86], [-350, 132]],
      material: materials.grassDark,
    },
    {
      name: 'west-harvest-field',
      points: [[-350, 136], [-34, 91], [-30, 310], [-350, 310]],
      material: materials.dryField,
    },
    {
      name: 'east-harvest-field',
      points: [[31, -310], [350, -310], [350, -82], [39, -62]],
      material: materials.dryField,
    },
    {
      name: 'east-light-meadow',
      points: [[40, -58], [350, -78], [350, 102], [37, 72]],
      material: materials.grassLight,
    },
    {
      name: 'east-deep-pasture',
      points: [[38, 77], [350, 107], [350, 310], [29, 310]],
      material: materials.grassDark,
    },
  ];

  for (const plot of plots) {
    layer.add(createGroundPolygon(plot.name, plot.points, plot.material, -0.195));
  }

  const furrowGeometry = new THREE.BoxGeometry(34, 0.018, 0.16);
  const furrows = new THREE.InstancedMesh(furrowGeometry, materials.earth, 28);
  furrows.name = 'harvest-field-furrows';
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < 28; index += 1) {
    const onWest = index < 14;
    const row = index % 14;
    const x = onWest ? -82 - row * 16 : 82 + row * 16;
    const z = onWest ? 214 + (row % 2) * 4 : -214 + (row % 2) * 4;
    matrix.compose(
      new THREE.Vector3(x, -0.165, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), onWest ? 0.12 : -0.08),
      new THREE.Vector3(1, 1, 1),
    );
    furrows.setMatrixAt(index, matrix);
  }
  furrows.receiveShadow = true;
  layer.add(furrows);

  return layer;
}

function createRunwayDesignator(text: string, material: THREE.Material): THREE.Mesh {
  const segmentMap: Record<string, readonly string[]> = {
    '0': ['a', 'b', 'c', 'd', 'e', 'f'],
    '1': ['b', 'c'],
    '2': ['a', 'b', 'g', 'e', 'd'],
    '3': ['a', 'b', 'c', 'd', 'g'],
    '4': ['f', 'g', 'b', 'c'],
    '5': ['a', 'f', 'g', 'c', 'd'],
    '6': ['a', 'f', 'g', 'e', 'c', 'd'],
    '7': ['a', 'b', 'c'],
    '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  };
  const segmentRectangles: Record<string, readonly [number, number, number, number]> = {
    a: [-1.1, 1.75, 1.1, 2.15],
    b: [0.8, 0.15, 1.2, 1.85],
    c: [0.8, -1.85, 1.2, -0.15],
    d: [-1.1, -2.15, 1.1, -1.75],
    e: [-1.2, -1.85, -0.8, -0.15],
    f: [-1.2, 0.15, -0.8, 1.85],
    g: [-1.1, -0.2, 1.1, 0.2],
  };
  const shapes: THREE.Shape[] = [];
  const spacing = 3.15;
  const start = -((text.length - 1) * spacing) / 2;

  for (let digitIndex = 0; digitIndex < text.length; digitIndex += 1) {
    const digit = text[digitIndex];
    const centerX = start + digitIndex * spacing;
    for (const segment of segmentMap[digit] ?? []) {
      const [minX, minY, maxX, maxY] = segmentRectangles[segment];
      const shape = new THREE.Shape();
      shape.moveTo(minX + centerX, minY);
      shape.lineTo(maxX + centerX, minY);
      shape.lineTo(maxX + centerX, maxY);
      shape.lineTo(minX + centerX, maxY);
      shape.closePath();
      shapes.push(shape);
    }
  }

  const geometry = new THREE.ShapeGeometry(shapes);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `runway-designator-${text}`;
  mesh.receiveShadow = true;
  return mesh;
}

function createRunwaySurface(materials: AirportMaterialLibrary, random: RandomSource): THREE.Group {
  const runway = new THREE.Group();
  runway.name = 'runway-18-36-authored-surface';

  const gravelGeometry = new THREE.PlaneGeometry(34, PAVED_LENGTH + 18);
  const gravel = new THREE.Mesh(gravelGeometry, materials.concrete);
  gravel.name = 'runway-compacted-shoulder-bed';
  gravel.rotation.x = -Math.PI / 2;
  gravel.position.y = -0.07;
  gravel.receiveShadow = true;
  runway.add(gravel);

  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY_WIDTH, PAVED_LENGTH),
    materials.asphalt,
  );
  asphalt.name = 'runway-asphalt';
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.y = -0.015;
  asphalt.receiveShadow = true;
  runway.add(asphalt);

  const shoulderGeometry = new THREE.BoxGeometry(1.8, 0.05, PAVED_LENGTH);
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(shoulderGeometry, materials.concrete);
    shoulder.name = side < 0 ? 'west-paved-shoulder' : 'east-paved-shoulder';
    shoulder.position.set(side * (RUNWAY_WIDTH / 2 + 0.9), -0.035, 0);
    shoulder.receiveShadow = true;
    runway.add(shoulder);
  }

  const edgeLineGeometry = new THREE.BoxGeometry(0.32, 0.026, NORTH_THRESHOLD_Z - SOUTH_THRESHOLD_Z);
  for (const side of [-1, 1]) {
    const edgeLine = new THREE.Mesh(edgeLineGeometry, materials.runwayPaint);
    edgeLine.name = side < 0 ? 'west-runway-edge-line' : 'east-runway-edge-line';
    edgeLine.position.set(side * (RUNWAY_WIDTH / 2 - 0.55), 0.013, 0);
    edgeLine.receiveShadow = true;
    runway.add(edgeLine);
  }

  const centerlineCount = 27;
  const centerline = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.34, 0.028, 4.4),
    materials.runwayPaint,
    centerlineCount,
  );
  centerline.name = 'runway-centerline-dashes';
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < centerlineCount; index += 1) {
    matrix.makeTranslation(0, 0.015, -130 + index * 10);
    centerline.setMatrixAt(index, matrix);
  }
  centerline.receiveShadow = true;
  runway.add(centerline);

  const thresholdStripeCount = 16;
  const thresholdStripes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.42, 0.03, 7.4),
    materials.runwayPaint,
    thresholdStripeCount,
  );
  thresholdStripes.name = 'runway-threshold-piano-bars';
  let thresholdIndex = 0;
  for (const z of [SOUTH_THRESHOLD_Z + 4.6, NORTH_THRESHOLD_Z - 4.6]) {
    for (let stripe = 0; stripe < 8; stripe += 1) {
      const x = (stripe - 3.5) * 2.5;
      matrix.makeTranslation(x, 0.017, z);
      thresholdStripes.setMatrixAt(thresholdIndex, matrix);
      thresholdIndex += 1;
    }
  }
  thresholdStripes.receiveShadow = true;
  runway.add(thresholdStripes);

  const touchMarkPositions: Array<readonly [number, number]> = [];
  for (const direction of [-1, 1]) {
    for (const distance of [31, 44, 57]) {
      const z = direction < 0 ? SOUTH_THRESHOLD_Z + distance : NORTH_THRESHOLD_Z - distance;
      touchMarkPositions.push([-5.2, z], [5.2, z]);
    }
  }
  const touchdownMarks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.0, 0.027, 5.4),
    materials.runwayPaint,
    touchMarkPositions.length,
  );
  touchdownMarks.name = 'touchdown-zone-markings';
  touchMarkPositions.forEach(([x, z], index) => {
    matrix.makeTranslation(x, 0.016, z);
    touchdownMarks.setMatrixAt(index, matrix);
  });
  touchdownMarks.receiveShadow = true;
  runway.add(touchdownMarks);

  const aimingPointPositions: Array<readonly [number, number]> = [
    [-5.15, SOUTH_THRESHOLD_Z + 75],
    [5.15, SOUTH_THRESHOLD_Z + 75],
    [-5.15, NORTH_THRESHOLD_Z - 75],
    [5.15, NORTH_THRESHOLD_Z - 75],
  ];
  const aimingPoints = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.75, 0.03, 11.5),
    materials.runwayPaint,
    aimingPointPositions.length,
  );
  aimingPoints.name = 'runway-aiming-point-blocks';
  aimingPointPositions.forEach(([x, z], index) => {
    matrix.makeTranslation(x, 0.017, z);
    aimingPoints.setMatrixAt(index, matrix);
  });
  aimingPoints.receiveShadow = true;
  runway.add(aimingPoints);

  const southNumber = createRunwayDesignator('36', materials.runwayPaint);
  southNumber.position.set(0, 0.019, SOUTH_THRESHOLD_Z + 18);
  runway.add(southNumber);
  const northNumber = createRunwayDesignator('18', materials.runwayPaint);
  northNumber.position.set(0, 0.019, NORTH_THRESHOLD_Z - 18);
  northNumber.rotation.y = Math.PI;
  runway.add(northNumber);

  const seamCount = 23;
  const seams = new THREE.InstancedMesh(
    new THREE.BoxGeometry(RUNWAY_WIDTH - 1.4, 0.012, 0.055),
    materials.asphaltSeam,
    seamCount,
  );
  seams.name = 'runway-expansion-seams';
  for (let index = 0; index < seamCount; index += 1) {
    matrix.makeTranslation(0, 0.004, -165 + index * 15);
    seams.setMatrixAt(index, matrix);
  }
  runway.add(seams);

  const patchCount = 24;
  const patches = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.012, 1),
    materials.asphaltPatch,
    patchCount,
  );
  patches.name = 'runway-irregular-repair-patches';
  const quaternion = new THREE.Quaternion();
  for (let index = 0; index < patchCount; index += 1) {
    const x = (random() * 2 - 1) * (RUNWAY_WIDTH * 0.38);
    const z = -162 + random() * 324;
    const scale = new THREE.Vector3(0.7 + random() * 2.3, 1, 1.8 + random() * 5.2);
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (random() - 0.5) * 0.12);
    matrix.compose(new THREE.Vector3(x, 0.0045, z), quaternion, scale);
    patches.setMatrixAt(index, matrix);
  }
  patches.receiveShadow = true;
  runway.add(patches);

  const skidCount = 32;
  const skids = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.16, 0.014, 10.5),
    materials.asphaltSeam,
    skidCount,
  );
  skids.name = 'touchdown-rubber-skid-marks';
  for (let index = 0; index < skidCount; index += 1) {
    const onNorth = index >= skidCount / 2;
    const localIndex = index % (skidCount / 2);
    const x = (localIndex % 4 - 1.5) * 0.92 + (random() - 0.5) * 0.2;
    const zBase = onNorth ? 92 : -92;
    const z = zBase + (onNorth ? -1 : 1) * Math.floor(localIndex / 4) * 5.5;
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (random() - 0.5) * 0.025);
    matrix.compose(new THREE.Vector3(x, 0.009, z), quaternion, new THREE.Vector3(1, 1, 1));
    skids.setMatrixAt(index, matrix);
  }
  runway.add(skids);

  return runway;
}

function createTaxiway(materials: AirportMaterialLibrary): THREE.Group {
  const taxiway = new THREE.Group();
  taxiway.name = 'curved-hangar-taxiway-and-apron';
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-11.9, -0.025, -24),
    new THREE.Vector3(-17, -0.025, -24),
    new THREE.Vector3(-26, -0.025, -30),
    new THREE.Vector3(-36, -0.025, -40),
    new THREE.Vector3(-48, -0.025, -47),
  ]);
  curve.curveType = 'centripetal';
  const sampled = curve.getPoints(34);

  const border = new THREE.Mesh(buildRibbonGeometry(sampled, 5.2), materials.concrete);
  border.name = 'taxiway-paved-border';
  border.receiveShadow = true;
  taxiway.add(border);

  const surfacePoints = sampled.map((point) => point.clone().setY(-0.012));
  const surface = new THREE.Mesh(buildRibbonGeometry(surfacePoints, 4.25), materials.asphalt);
  surface.name = 'taxiway-asphalt-ribbon';
  surface.receiveShadow = true;
  taxiway.add(surface);

  const centerPoints = sampled.map((point) => point.clone().setY(0.016));
  const centerLine = new THREE.Mesh(buildRibbonGeometry(centerPoints, 0.085), materials.taxiPaint);
  centerLine.name = 'taxiway-centerline';
  taxiway.add(centerLine);

  const apron = new THREE.Mesh(new THREE.CircleGeometry(24, 32), materials.concrete);
  apron.name = 'hangar-apron';
  apron.rotation.x = -Math.PI / 2;
  apron.scale.set(1.28, 0.72, 1);
  apron.position.set(-54, -0.045, -49);
  apron.receiveShadow = true;
  taxiway.add(apron);

  return taxiway;
}

function createPapiUnit(
  x: number,
  z: number,
  rotationY: number,
  materials: AirportMaterialLibrary,
): THREE.Group {
  const papi = new THREE.Group();
  papi.name = `precision-approach-path-indicator-${z > 0 ? 'north' : 'south'}`;
  papi.position.set(x, 0, z);
  papi.rotation.y = rotationY;

  const housing = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.32, 0.55), materials.darkMetal);
  housing.position.y = 0.32;
  housing.castShadow = true;
  papi.add(housing);

  const legGeometry = new THREE.CylinderGeometry(0.055, 0.07, 0.35, 8);
  for (const legX of [-1.45, 1.45]) {
    const leg = new THREE.Mesh(legGeometry, materials.galvanizedMetal);
    leg.position.set(legX, 0.14, 0);
    leg.castShadow = true;
    papi.add(leg);
  }

  const lensGeometry = new THREE.CircleGeometry(0.16, 16);
  for (let index = 0; index < 4; index += 1) {
    const lens = new THREE.Mesh(
      lensGeometry,
      index < 2 ? materials.thresholdRed : materials.edgeLight,
    );
    lens.name = `papi-lens-${index + 1}`;
    lens.position.set(-1.2 + index * 0.8, 0.36, 0.286);
    papi.add(lens);
  }

  return papi;
}

function createRunwayLights(materials: AirportMaterialLibrary): {
  group: THREE.Group;
  edgeLightCount: number;
} {
  const lights = new THREE.Group();
  lights.name = 'runway-lighting-and-approach-aids';
  const edgePositions: THREE.Vector3[] = [];
  for (let z = SOUTH_THRESHOLD_Z; z <= NORTH_THRESHOLD_Z; z += 12) {
    edgePositions.push(
      new THREE.Vector3(-RUNWAY_WIDTH / 2 - 1.05, 0, z),
      new THREE.Vector3(RUNWAY_WIDTH / 2 + 1.05, 0, z),
    );
  }

  const baseGeometry = new THREE.CylinderGeometry(0.12, 0.16, 0.18, 8);
  const bases = new THREE.InstancedMesh(baseGeometry, materials.darkMetal, edgePositions.length);
  bases.name = 'runway-edge-light-bases';
  const lensGeometry = new THREE.SphereGeometry(0.105, 10, 6);
  const lenses = new THREE.InstancedMesh(lensGeometry, materials.edgeLight, edgePositions.length);
  lenses.name = 'runway-edge-light-lenses';
  const matrix = new THREE.Matrix4();
  edgePositions.forEach((position, index) => {
    matrix.makeTranslation(position.x, 0.09, position.z);
    bases.setMatrixAt(index, matrix);
    matrix.makeTranslation(position.x, 0.225, position.z);
    lenses.setMatrixAt(index, matrix);
  });
  bases.castShadow = true;
  lights.add(bases, lenses);

  const thresholdXPositions = Array.from({ length: 11 }, (_, index) => -10 + index * 2);
  const greenGeometry = new THREE.SphereGeometry(0.12, 10, 6);
  const greenLights = new THREE.InstancedMesh(
    greenGeometry,
    materials.thresholdGreen,
    thresholdXPositions.length * 2,
  );
  greenLights.name = 'threshold-green-light-bars';
  const redLights = new THREE.InstancedMesh(
    greenGeometry,
    materials.thresholdRed,
    thresholdXPositions.length * 2,
  );
  redLights.name = 'runway-end-red-light-bars';
  let lightIndex = 0;
  for (const z of [SOUTH_THRESHOLD_Z, NORTH_THRESHOLD_Z]) {
    for (const x of thresholdXPositions) {
      matrix.makeTranslation(x, 0.13, z);
      greenLights.setMatrixAt(lightIndex, matrix);
      const outsideOffset = z < 0 ? -1.35 : 1.35;
      matrix.makeTranslation(x, 0.13, z + outsideOffset);
      redLights.setMatrixAt(lightIndex, matrix);
      lightIndex += 1;
    }
  }
  lights.add(greenLights, redLights);

  const approachPositions: THREE.Vector3[] = [];
  for (const direction of [-1, 1]) {
    for (let distance = 9; distance <= 33; distance += 6) {
      approachPositions.push(new THREE.Vector3(0, 0.105, direction * (150 + distance)));
    }
    for (const x of [-4.5, -3, -1.5, 0, 1.5, 3, 4.5]) {
      approachPositions.push(new THREE.Vector3(x, 0.105, direction * 177));
    }
  }
  const approachLights = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.095, 8, 5),
    materials.edgeLight,
    approachPositions.length,
  );
  approachLights.name = 'low-profile-approach-light-markers';
  approachPositions.forEach((position, index) => {
    matrix.makeTranslation(position.x, position.y, position.z);
    approachLights.setMatrixAt(index, matrix);
  });
  lights.add(approachLights);

  lights.add(
    createPapiUnit(-16.1, -106, 0, materials),
    createPapiUnit(16.1, 106, Math.PI, materials),
  );

  return { group: lights, edgeLightCount: edgePositions.length };
}

function createHangar(
  name: string,
  width: number,
  depth: number,
  wallHeight: number,
  roofHeight: number,
  materials: AirportMaterialLibrary,
  wallMaterial: THREE.Material = materials.hangarWall,
): THREE.Group {
  const hangar = new THREE.Group();
  hangar.name = name;

  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, wallHeight);
  shape.lineTo(0, wallHeight + roofHeight);
  shape.lineTo(-width / 2, wallHeight);
  shape.closePath();
  const shellGeometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.16,
    bevelThickness: 0.14,
  });
  shellGeometry.translate(0, 0, -depth / 2);
  const shell = new THREE.Mesh(shellGeometry, wallMaterial);
  shell.name = `${name}-gabled-shell`;
  setShadow(shell, true, true);
  hangar.add(shell);

  const doorWidth = width * 0.72;
  const doorHeight = wallHeight * 0.72;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(doorWidth, doorHeight, 0.13),
    materials.darkMetal,
  );
  door.name = `${name}-recessed-door`;
  door.position.set(0, doorHeight / 2 + 0.03, depth / 2 + 0.16);
  door.castShadow = true;
  hangar.add(door);

  const frameThickness = 0.24;
  const frameSideGeometry = new THREE.BoxGeometry(frameThickness, doorHeight + 0.4, 0.23);
  for (const side of [-1, 1]) {
    const frame = new THREE.Mesh(frameSideGeometry, materials.hangarAccent);
    frame.position.set(side * (doorWidth / 2 + frameThickness / 2), doorHeight / 2, depth / 2 + 0.27);
    frame.castShadow = true;
    hangar.add(frame);
  }
  const header = new THREE.Mesh(
    new THREE.BoxGeometry(doorWidth + frameThickness * 2, frameThickness, 0.23),
    materials.hangarAccent,
  );
  header.position.set(0, doorHeight + 0.1, depth / 2 + 0.27);
  header.castShadow = true;
  hangar.add(header);

  const doorRibGeometry = new THREE.BoxGeometry(0.08, doorHeight * 0.94, 0.06);
  for (let index = 1; index < 8; index += 1) {
    const rib = new THREE.Mesh(doorRibGeometry, materials.galvanizedMetal);
    rib.position.set(-doorWidth / 2 + (doorWidth * index) / 8, doorHeight / 2, depth / 2 + 0.245);
    hangar.add(rib);
  }

  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.18, depth + 0.55),
    materials.roofLight,
  );
  ridge.name = `${name}-roof-ridge-cap`;
  ridge.position.set(0, wallHeight + roofHeight + 0.08, 0);
  ridge.castShadow = true;
  hangar.add(ridge);

  const roofRibGeometry = new THREE.BoxGeometry(width * 0.54, 0.075, 0.11);
  for (let index = 1; index < 6; index += 1) {
    const z = -depth / 2 + (depth * index) / 6;
    for (const side of [-1, 1]) {
      const rib = new THREE.Mesh(roofRibGeometry, materials.roofLight);
      rib.position.set(side * width * 0.235, wallHeight + roofHeight * 0.52, z);
      rib.rotation.z = side * -Math.atan2(roofHeight, width / 2);
      hangar.add(rib);
    }
  }

  const windowGeometry = new THREE.BoxGeometry(1.25, 0.72, 0.06);
  for (const side of [-1, 1]) {
    const windowMesh = new THREE.Mesh(windowGeometry, materials.glass);
    windowMesh.name = `${name}-side-window-${side < 0 ? 'left' : 'right'}`;
    windowMesh.position.set(side * width * 0.36, wallHeight * 0.56, depth / 2 + 0.245);
    hangar.add(windowMesh);
  }

  return hangar;
}

function createAirportOffice(materials: AirportMaterialLibrary): THREE.Group {
  const office = new THREE.Group();
  office.name = 'airport-operations-office-and-beacon';

  const base = new THREE.Mesh(new THREE.BoxGeometry(11, 3.8, 7.5), materials.hangarWall);
  base.position.y = 1.9;
  setShadow(base, true, true);
  office.add(base);

  const eave = new THREE.Mesh(new THREE.BoxGeometry(11.7, 0.22, 8.2), materials.hangarAccent);
  eave.position.y = 3.86;
  eave.castShadow = true;
  office.add(eave);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(12.1, 0.36, 8.6), materials.roof);
  roof.position.y = 4.12;
  roof.rotation.z = -0.025;
  roof.castShadow = true;
  office.add(roof);

  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 4.2, 8), materials.hangarWall);
  tower.position.set(1.6, 6.2, 0);
  setShadow(tower, true, true);
  office.add(tower);

  const cab = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 1.8, 1.55, 8), materials.glass);
  cab.position.set(1.6, 8.45, 0);
  cab.castShadow = true;
  office.add(cab);

  const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.05, 0.32, 8), materials.roof);
  cabRoof.position.set(1.6, 9.38, 0);
  cabRoof.castShadow = true;
  office.add(cabRoof);

  const beaconStem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.7, 8), materials.darkMetal);
  beaconStem.position.set(1.6, 9.88, 0);
  office.add(beaconStem);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), materials.warningAmber);
  beacon.name = 'airport-rotating-beacon';
  beacon.position.set(1.6, 10.28, 0);
  office.add(beacon);

  const frontWindowGeometry = new THREE.BoxGeometry(1.55, 1.1, 0.08);
  for (const x of [-3.75, -1.7, 0.35, 2.4, 4.45]) {
    const windowMesh = new THREE.Mesh(frontWindowGeometry, materials.glass);
    windowMesh.position.set(x, 2.15, 3.79);
    office.add(windowMesh);
  }

  return office;
}

function createFuelDepot(materials: AirportMaterialLibrary): THREE.Group {
  const depot = new THREE.Group();
  depot.name = 'compact-airfield-fuel-depot';
  const cradleGeometry = new THREE.BoxGeometry(0.55, 0.7, 2.6);
  const tankGeometry = new THREE.CylinderGeometry(1.25, 1.25, 6.2, 20, 1, false);
  for (let index = 0; index < 2; index += 1) {
    const x = index * 3.2;
    const tank = new THREE.Mesh(tankGeometry, materials.galvanizedMetal);
    tank.name = `fuel-tank-${index + 1}`;
    tank.rotation.z = Math.PI / 2;
    tank.position.set(x, 1.65, 0);
    setShadow(tank, true, true);
    depot.add(tank);
    for (const supportX of [-2, 2]) {
      const cradle = new THREE.Mesh(cradleGeometry, materials.darkMetal);
      cradle.position.set(x + supportX, 0.4, 0);
      cradle.castShadow = true;
      depot.add(cradle);
    }
  }

  const pipeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-3.1, 1.65, 0),
    new THREE.Vector3(-4.2, 1.65, 0),
    new THREE.Vector3(-4.2, 0.6, 0),
    new THREE.Vector3(-5.6, 0.6, 0),
  ]);
  const pipe = new THREE.Mesh(new THREE.TubeGeometry(pipeCurve, 18, 0.1, 8, false), materials.darkMetal);
  pipe.name = 'fuel-transfer-pipe';
  pipe.castShadow = true;
  depot.add(pipe);
  return depot;
}

function createBuildings(materials: AirportMaterialLibrary): THREE.Group {
  const buildings = new THREE.Group();
  buildings.name = 'airport-buildings-and-farm-structures';

  const mainHangar = createHangar('main-orange-trim-hangar', 20, 25, 6.7, 3.4, materials);
  mainHangar.position.set(-63, 0, -48);
  mainHangar.rotation.y = Math.PI / 2;
  buildings.add(mainHangar);

  const maintenanceHangar = createHangar('maintenance-hangar', 15, 19, 5.4, 2.8, materials);
  maintenanceHangar.position.set(-66, 0, 4);
  maintenanceHangar.rotation.y = Math.PI / 2;
  buildings.add(maintenanceHangar);

  const farmShed = createHangar(
    'east-field-farm-shed',
    13,
    18,
    4.8,
    3.5,
    materials,
    materials.hangarAccent,
  );
  farmShed.scale.setScalar(0.9);
  farmShed.position.set(73, 0, 92);
  farmShed.rotation.y = -Math.PI / 2;
  buildings.add(farmShed);

  const office = createAirportOffice(materials);
  office.position.set(-44, 0, 29);
  office.rotation.y = Math.PI / 2;
  buildings.add(office);

  const depot = createFuelDepot(materials);
  depot.position.set(-76, 0, 31);
  depot.rotation.y = 0.18;
  buildings.add(depot);

  return buildings;
}

function createWindsock(materials: AirportMaterialLibrary): {
  group: THREE.Group;
  pivot: THREE.Group;
  sleeve: THREE.Group;
} {
  const windsock = new THREE.Group();
  windsock.name = 'animated-airfield-windsock';
  windsock.position.set(-35, 0, -76);

  const footing = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.28, 16), materials.concrete);
  footing.position.y = 0.14;
  footing.receiveShadow = true;
  windsock.add(footing);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.13, 5.5, 10), materials.galvanizedMetal);
  mast.position.y = 2.9;
  mast.castShadow = true;
  windsock.add(mast);

  const pivot = new THREE.Group();
  pivot.name = 'windsock-bearing-pivot';
  pivot.position.y = 5.6;
  pivot.rotation.y = 0.28;
  windsock.add(pivot);

  const bearing = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), materials.darkMetal);
  bearing.castShadow = true;
  pivot.add(bearing);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.72, 8), materials.darkMetal);
  boom.rotation.z = -Math.PI / 2;
  boom.position.x = 0.32;
  pivot.add(boom);

  const sleeve = new THREE.Group();
  sleeve.name = 'windsock-fabric-sleeve';
  sleeve.position.x = 0.64;
  pivot.add(sleeve);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.045, 8, 18), materials.darkMetal);
  ring.rotation.y = Math.PI / 2;
  sleeve.add(ring);

  const segmentLength = 0.62;
  const radii = [0.44, 0.36, 0.29, 0.22, 0.14];
  for (let index = 0; index < radii.length - 1; index += 1) {
    const segment = new THREE.Mesh(
      new THREE.CylinderGeometry(radii[index + 1], radii[index], segmentLength, 14, 1, true),
      index % 2 === 0 ? materials.fabricRed : materials.fabricWhite,
    );
    segment.name = `windsock-band-${index + 1}`;
    segment.rotation.z = -Math.PI / 2;
    segment.position.x = segmentLength * (index + 0.5);
    segment.castShadow = true;
    sleeve.add(segment);
  }

  return { group: windsock, pivot, sleeve };
}

function createFence(materials: AirportMaterialLibrary): THREE.Group {
  const fence = new THREE.Group();
  fence.name = 'airfield-perimeter-post-and-rail-fence';
  const postCount = 25;
  const posts = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.08, 0.1, 1.6, 6),
    materials.wood,
    postCount,
  );
  posts.name = 'west-perimeter-fence-posts';
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < postCount; index += 1) {
    matrix.makeTranslation(-26.5, 0.8, -150 + index * 12.5);
    posts.setMatrixAt(index, matrix);
  }
  posts.castShadow = true;
  fence.add(posts);

  const railGeometry = new THREE.BoxGeometry(0.09, 0.1, 300);
  for (const y of [0.55, 1.16]) {
    const rail = new THREE.Mesh(railGeometry, materials.wood);
    rail.position.set(-26.5, y, 0);
    rail.castShadow = true;
    fence.add(rail);
  }
  return fence;
}

function createTrees(
  materials: AirportMaterialLibrary,
  random: RandomSource,
): { group: THREE.Group; count: number } {
  const group = new THREE.Group();
  group.name = 'instanced-countryside-tree-belts';
  const placements: Array<{ position: THREE.Vector3; scale: number; rotation: number }> = [];

  while (placements.length < 64) {
    const angle = random() * Math.PI * 2;
    const radius = 82 + random() * 150;
    const x = Math.cos(angle) * radius * 1.22;
    const z = Math.sin(angle) * radius;
    const outsideCorridor = Math.abs(x) > 42 || Math.abs(z) > 190;
    const awayFromHangars = !(x < -34 && x > -96 && z > -85 && z < 52);
    if (!outsideCorridor || !awayFromHangars) continue;
    placements.push({
      position: new THREE.Vector3(x, 0, z),
      scale: 0.72 + random() * 0.78,
      rotation: random() * Math.PI * 2,
    });
  }

  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.22, 0.38, 2.9, 7),
    materials.trunk,
    placements.length,
  );
  trunks.name = 'tree-trunks';
  const lowerCanopies = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1.55, 0),
    materials.foliage,
    placements.length,
  );
  lowerCanopies.name = 'tree-lower-canopies';
  const upperCanopies = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1.16, 1),
    materials.foliageLight,
    placements.length,
  );
  upperCanopies.name = 'tree-sunlit-crowns';
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();

  placements.forEach((placement, index) => {
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotation);
    matrix.compose(
      placement.position.clone().setY(1.45 * placement.scale),
      quaternion,
      new THREE.Vector3(placement.scale, placement.scale, placement.scale),
    );
    trunks.setMatrixAt(index, matrix);
    matrix.compose(
      placement.position.clone().setY(3.45 * placement.scale),
      quaternion,
      new THREE.Vector3(1.25, 0.92, 1.15).multiplyScalar(placement.scale),
    );
    lowerCanopies.setMatrixAt(index, matrix);
    matrix.compose(
      placement.position.clone().add(new THREE.Vector3(0.35, 4.65 * placement.scale, -0.15)),
      quaternion,
      new THREE.Vector3(0.9, 1.06, 0.88).multiplyScalar(placement.scale),
    );
    upperCanopies.setMatrixAt(index, matrix);
  });
  trunks.castShadow = true;
  lowerCanopies.castShadow = true;
  upperCanopies.castShadow = true;
  group.add(trunks, lowerCanopies, upperCanopies);
  return { group, count: placements.length };
}

function createHayBales(materials: AirportMaterialLibrary, random: RandomSource): THREE.Group {
  const group = new THREE.Group();
  group.name = 'east-harvest-field-hay-bales';
  const count = 18;
  const bales = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.62, 0.62, 1.32, 12, 2),
    materials.hay,
    count,
  );
  bales.name = 'rolled-hay-bales';
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const rotation = new THREE.Euler(0, 0, Math.PI / 2);
  for (let index = 0; index < count; index += 1) {
    const x = 58 + random() * 150;
    const z = -282 + random() * 150;
    rotation.y = random() * Math.PI;
    quaternion.setFromEuler(rotation);
    const scale = 0.82 + random() * 0.42;
    matrix.compose(new THREE.Vector3(x, 0.58 * scale, z), quaternion, new THREE.Vector3(scale, scale, scale));
    bales.setMatrixAt(index, matrix);
  }
  bales.castShadow = true;
  bales.receiveShadow = true;
  group.add(bales);
  return group;
}

function createCloudSystem(materials: AirportMaterialLibrary, random: RandomSource): CloudSystem {
  const clusters: readonly CloudClusterSpec[] = [
    { center: [-230, 92, -410], puffs: 7, spread: [104, 18, 42], scale: [17, 7.5, 13], crown: 0.72 },
    { center: [280, 124, -535], puffs: 8, spread: [132, 24, 48], scale: [19, 8.5, 15], crown: 0.66 },
    { center: [-560, 154, -185], puffs: 8, spread: [142, 27, 62], scale: [20, 9, 15], crown: 0.78 },
    { center: [610, 142, 36], puffs: 7, spread: [116, 22, 54], scale: [18, 8, 14], crown: 0.7 },
    { center: [-390, 184, 460], puffs: 8, spread: [148, 25, 58], scale: [21, 8.5, 16], crown: 0.58 },
    { center: [350, 108, 390], puffs: 7, spread: [112, 19, 44], scale: [17, 7.5, 13], crown: 0.74 },
    { center: [-785, 218, 180], puffs: 7, spread: [176, 20, 66], scale: [24, 6.5, 18], crown: 0.3 },
    { center: [805, 226, -265], puffs: 7, spread: [184, 22, 62], scale: [25, 6.2, 18], crown: 0.26 },
    { center: [-690, 250, -690], puffs: 6, spread: [190, 16, 74], scale: [27, 4.8, 19], crown: 0.14 },
    { center: [720, 242, 650], puffs: 6, spread: [184, 17, 70], scale: [26, 5.2, 18], crown: 0.18 },
    { center: [35, 176, -805], puffs: 7, spread: [166, 23, 58], scale: [22, 7, 16], crown: 0.42 },
    { center: [-65, 158, 770], puffs: 7, spread: [154, 22, 54], scale: [21, 7.4, 16], crown: 0.48 },
  ];
  const puffs: CloudPuff[] = [];

  clusters.forEach((cluster) => {
    const [centerX, centerY, centerZ] = cluster.center;
    const [spreadX, spreadY, spreadZ] = cluster.spread;
    const [scaleX, scaleY, scaleZ] = cluster.scale;
    for (let index = 0; index < cluster.puffs; index += 1) {
      const progress = cluster.puffs <= 1 ? 0.5 : index / (cluster.puffs - 1);
      const ribbon = progress - 0.5;
      const crownWeight = Math.sin(progress * Math.PI);
      const localX = ribbon * spreadX + (random() - 0.5) * spreadX * 0.18;
      const localY =
        (random() - 0.46) * spreadY
        + crownWeight * spreadY * cluster.crown;
      const localZ =
        Math.sin(progress * Math.PI * 2.0) * spreadZ * 0.24
        + (random() - 0.5) * spreadZ * 0.52;
      puffs.push({
        base: new THREE.Vector3(centerX + localX, centerY + localY, centerZ + localZ),
        scale: new THREE.Vector3(
          scaleX * (0.78 + random() * 0.5) * (1 + crownWeight * 0.12),
          scaleY * (0.72 + random() * 0.54) * (1 + crownWeight * cluster.crown * 0.34),
          scaleZ * (0.78 + random() * 0.46),
        ),
        phase: random() * Math.PI * 2,
        drift: 0.6 + random() * 0.55,
      });
    }
  });

  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 2),
    materials.cloud,
    puffs.length,
  );
  mesh.name = 'instanced-layered-cloud-puffs';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const color = new THREE.Color();
  materials.cloud.vertexColors = true;
  materials.cloud.needsUpdate = true;
  puffs.forEach((puff, index) => {
    quaternion.setFromEuler(new THREE.Euler(0, puff.phase, (puff.phase - Math.PI) * 0.04));
    matrix.compose(puff.base, quaternion, puff.scale);
    mesh.setMatrixAt(index, matrix);
    const lightness = 0.9 + random() * 0.1;
    color.setRGB(lightness, lightness * 0.995, lightness * 0.965);
    mesh.setColorAt(index, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return { mesh, puffs };
}

function createLightingRig(): THREE.Group {
  const rig = new THREE.Group();
  rig.name = 'outdoor-key-fill-rim-lighting-rig';

  const hemisphere = new THREE.HemisphereLight('#c6e6f8', '#657158', 1.65);
  hemisphere.name = 'sky-and-ground-hemisphere-fill';
  rig.add(hemisphere);

  const ambient = new THREE.AmbientLight('#ffe9d0', 0.46);
  ambient.name = 'warm-ambient-lift';
  rig.add(ambient);

  const sun = new THREE.DirectionalLight('#fff0c8', 2.6);
  sun.name = 'warm-afternoon-sun-key';
  sun.position.set(-72, 132, -62);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 12;
  sun.shadow.camera.far = 330;
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.bias = -0.00018;
  sun.shadow.normalBias = 0.025;
  sun.shadow.intensity = 0.62;
  sun.target.position.set(0, 0, -10);
  rig.add(sun, sun.target);

  const fill = new THREE.DirectionalLight('#c5e4f7', 0.92);
  fill.name = 'cool-open-sky-fill';
  fill.position.set(65, 48, 74);
  fill.target.position.set(0, 4, 0);
  rig.add(fill, fill.target);

  const rim = new THREE.DirectionalLight('#ffd49a', 0.66);
  rim.name = 'sunset-edge-rim';
  rim.position.set(34, 34, -92);
  rim.target.position.set(0, 3, 0);
  rig.add(rim, rim.target);
  return rig;
}

function collectDiagnostics(
  root: THREE.Object3D,
  scenicProps: number,
  cloudPuffs: number,
  treeCount: number,
  runwayEdgeLights: number,
): RunwayWorldDiagnostics {
  let meshes = 0;
  let instancedMeshes = 0;
  let instances = 0;
  let approximateTriangles = 0;
  let lights = 0;
  let shadowCasters = 0;
  let shadowReceivers = 0;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((object) => {
    if (object instanceof THREE.Light) lights += 1;
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    if (object.castShadow) shadowCasters += 1;
    if (object.receiveShadow) shadowReceivers += 1;
    geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }

    const instanceCount = object instanceof THREE.InstancedMesh ? object.count : 1;
    if (object instanceof THREE.InstancedMesh) {
      instancedMeshes += 1;
      instances += object.count;
    }
    const position = object.geometry.getAttribute('position');
    const triangleCount = object.geometry.index
      ? object.geometry.index.count / 3
      : position
        ? position.count / 3
        : 0;
    approximateTriangles += Math.round(triangleCount * instanceCount);
  });

  return {
    meshes,
    instancedMeshes,
    instances,
    uniqueGeometries: geometries.size,
    uniqueMaterials: materials.size,
    textures: textures.size,
    approximateTriangles,
    lights,
    shadowCasters,
    shadowReceivers,
    scenicProps,
    cloudPuffs,
    treeCount,
    runwayEdgeLights,
  };
}

function disposeGeometries(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const extraMaterials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      if (material instanceof THREE.ShaderMaterial) extraMaterials.add(material);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of extraMaterials) material.dispose();
}

function updateClouds(
  system: CloudSystem,
  elapsedSeconds: number,
  focusPosition?: Readonly<THREE.Vector3>,
): void {
  const matrix = CLOUD_MATRIX_SCRATCH;
  const quaternion = CLOUD_QUATERNION_SCRATCH;
  const position = CLOUD_POSITION_SCRATCH;
  for (let index = 0; index < system.puffs.length; index += 1) {
    const puff = system.puffs[index];
    position.copy(puff.base);
    position.x += Math.sin(elapsedSeconds * 0.018 * puff.drift + puff.phase) * 11;
    position.y += Math.sin(elapsedSeconds * 0.075 + puff.phase) * 0.42;
    if (focusPosition) {
      position.x += Math.round((focusPosition.x - position.x) / CLOUD_WRAP_DISTANCE)
        * CLOUD_WRAP_DISTANCE;
      position.z += Math.round((focusPosition.z - position.z) / CLOUD_WRAP_DISTANCE)
        * CLOUD_WRAP_DISTANCE;
    }
    CLOUD_EULER_SCRATCH.set(
      0,
      puff.phase + elapsedSeconds * 0.003 * puff.drift,
      Math.sin(puff.phase) * 0.035,
    );
    quaternion.setFromEuler(CLOUD_EULER_SCRATCH);
    matrix.compose(position, quaternion, puff.scale);
    system.mesh.setMatrixAt(index, matrix);
  }
  system.mesh.instanceMatrix.needsUpdate = true;
}

export function createRunwayWorld(scene?: THREE.Scene): RunwayWorld {
  const random = createSeededRandom(0xc0a571de);
  const materials = createAirportMaterialLibrary();
  const world = new THREE.Group();
  world.name = 'stylized-countryside-airport-world';

  const skyDome = createSkyDome();
  const fieldLayer = createFieldLayer(materials);
  const runway = createRunwaySurface(materials, random);
  const taxiway = createTaxiway(materials);
  const runwayLights = createRunwayLights(materials);
  const buildings = createBuildings(materials);
  const windsock = createWindsock(materials);
  const fence = createFence(materials);
  const trees = createTrees(materials, random);
  const hayBales = createHayBales(materials, random);
  const cloudSystem = createCloudSystem(materials, random);
  const lighting = createLightingRig();
  const airportScenery: THREE.Object3D[] = [
    fieldLayer,
    runway,
    taxiway,
    runwayLights.group,
    buildings,
    windsock.group,
    fence,
    trees.group,
    hayBales,
  ];
  const travellingScenery: THREE.Object3D[] = [skyDome, cloudSystem.mesh];

  world.add(
    skyDome,
    fieldLayer,
    runway,
    taxiway,
    runwayLights.group,
    buildings,
    windsock.group,
    fence,
    trees.group,
    hayBales,
    cloudSystem.mesh,
    lighting,
  );

  world.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
      object.castShadow = false;
    }
  });

  const fogColor = new THREE.Color('#c4d9df');
  const fog = new THREE.Fog(fogColor, WORLD_FOG_NEAR, WORLD_FOG_FAR);
  const background = fogColor.clone();
  const previousFog = scene?.fog ?? null;
  const previousBackground = scene?.background ?? null;
  if (scene) {
    scene.fog = fog;
    scene.background = background;
    scene.add(world);
  }

  const environment: RunwayEnvironmentMetadata = {
    groundElevation: RUNWAY_SURFACE_Y,
    landingElevation: RUNWAY_SURFACE_Y,
    centerlineX: 0,
    runwayWidth: RUNWAY_WIDTH,
    pavedLength: PAVED_LENGTH,
    usableLength: NORTH_THRESHOLD_Z - SOUTH_THRESHOLD_Z,
    southThresholdZ: SOUTH_THRESHOLD_Z,
    northThresholdZ: NORTH_THRESHOLD_Z,
    pavedBounds: new THREE.Box3(
      new THREE.Vector3(-RUNWAY_WIDTH / 2, RUNWAY_SURFACE_Y - 0.08, -PAVED_LENGTH / 2),
      new THREE.Vector3(RUNWAY_WIDTH / 2, RUNWAY_SURFACE_Y + 0.04, PAVED_LENGTH / 2),
    ),
    safeCorridorHalfWidth: SAFE_CORRIDOR_HALF_WIDTH,
    preferredTakeoffDirectionZ: 1,
    parkingPosition: new THREE.Vector3(0, RUNWAY_SURFACE_Y, -112),
    rolloutStopPosition: new THREE.Vector3(0, RUNWAY_SURFACE_Y, 104),
    sunlightDirection: new THREE.Vector3(-0.48, 0.58, -0.65).normalize(),
    fog: {
      color: fogColor.clone(),
      near: fog.near,
      far: fog.far,
    },
  };

  const diagnostics = collectDiagnostics(
    world,
    5,
    cloudSystem.puffs.length,
    trees.count,
    runwayLights.edgeLightCount,
  );
  const animationHandles: WorldAnimationHandles = {
    cloudSystem,
    windsockPivot: windsock.pivot,
    windsockSleeve: windsock.sleeve,
    skyDome,
    lighting,
  };
  let internalElapsed = 0;
  let disposed = false;
  let airportVisible = true;
  let sceneryVisible = true;
  const applyVisibility = (): void => {
    airportScenery.forEach((object) => {
      object.visible = sceneryVisible && airportVisible;
    });
    travellingScenery.forEach((object) => {
      object.visible = sceneryVisible;
    });
    lighting.visible = true;
  };

  return {
    group: world,
    environment,
    diagnostics,
    update: (deltaSeconds, elapsedSeconds, focusPosition) => {
      if (disposed) return;
      internalElapsed = elapsedSeconds ?? internalElapsed + Math.max(0, deltaSeconds);
      if (focusPosition) {
        animationHandles.skyDome.position.copy(focusPosition);
        animationHandles.lighting.position.set(focusPosition.x, 0, focusPosition.z);
        const altitudeAboveGround = Math.max(0, focusPosition.y - RUNWAY_SURFACE_Y);
        fog.near = Math.hypot(WORLD_FOG_NEAR, altitudeAboveGround);
        fog.far = Math.hypot(WORLD_FOG_FAR, altitudeAboveGround);
      }
      updateClouds(animationHandles.cloudSystem, internalElapsed, focusPosition);
      animationHandles.windsockPivot.rotation.y =
        0.28 + Math.sin(internalElapsed * 0.21) * 0.12 + Math.sin(internalElapsed * 0.67) * 0.035;
      animationHandles.windsockSleeve.rotation.z =
        -0.06 + Math.sin(internalElapsed * 1.72) * 0.045 + Math.sin(internalElapsed * 3.8) * 0.014;
      animationHandles.windsockSleeve.rotation.y = Math.sin(internalElapsed * 1.1) * 0.025;
      materials.edgeLight.emissiveIntensity = 2.2 + Math.sin(internalElapsed * 1.4) * 0.13;
      materials.warningAmber.emissiveIntensity = 2.1 + (Math.sin(internalElapsed * 2.8) * 0.5 + 0.5) * 1.15;
    },
    setAirportVisible: (visible) => {
      airportVisible = visible;
      applyVisibility();
    },
    setSceneryVisible: (visible) => {
      sceneryVisible = visible;
      applyVisibility();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      scene?.remove(world);
      if (scene?.fog === fog) scene.fog = previousFog;
      if (scene?.background === background) scene.background = previousBackground;
      disposeGeometries(world);
      materials.dispose();
    },
  };
}
