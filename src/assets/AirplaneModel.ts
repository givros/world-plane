import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export type AirplaneModelDiagnostics = {
  paint: {
    selectedColor: string;
    revision: number;
  };
  dimensions: {
    overallLength: number;
    wingspan: number;
    propellerRadius: number;
    propellerSafetyRadius: number;
    propellerGroundClearance: number;
    mainWheelRadius: number;
    tailWheelRadius: number;
  };
};

export type AirplaneModel = {
  root: THREE.Group;
  propellerPivot: THREE.Group;
  propellerBlur: THREE.Mesh;
  mainWheelPivots: [THREE.Group, THREE.Group];
  tailWheelPivot: THREE.Group;
  controlSurfaces: {
    leftAileron: THREE.Group;
    rightAileron: THREE.Group;
    elevator: THREE.Group;
    rudder: THREE.Group;
  };
  face: {
    leftPupil: THREE.Group;
    rightPupil: THREE.Group;
    leftBrow: THREE.Mesh;
    rightBrow: THREE.Mesh;
  };
  sockets: {
    exhaust: THREE.Object3D;
    leftWingtip: THREE.Object3D;
    rightWingtip: THREE.Object3D;
  };
  shadowProxy: THREE.Mesh;
  groundOffset: number;
  diagnostics: AirplaneModelDiagnostics;
  paint: {
    setColor: (hexColor: string) => boolean;
    getColor: () => string;
  };
  dispose: () => void;
};

type PlaneMaterials = ReturnType<typeof createMaterials>;

export const DEFAULT_AIRCRAFT_PAINT_COLOR = '#ed870c';
const ORANGE_LIGHT = '#ff9f1c';
const ORANGE_SHEEN = '#ffc05f';
const WARM_WHITE = '#f4f1e9';
const GRAPHITE = '#17191b';
const MAIN_WHEEL_RADIUS = 0.52;
const TAIL_WHEEL_RADIUS = 0.2;
const PROPELLER_RADIUS = 1.81;
const PROPELLER_SAFETY_RADIUS = 1.86;
const PROPELLER_HUB_HEIGHT = 2.42;
const PROPELLER_GROUND_CLEARANCE = PROPELLER_HUB_HEIGHT - PROPELLER_SAFETY_RADIUS;
const AIRCRAFT_LENGTH = 9.8;
const AIRCRAFT_WINGSPAN = 11.76;

function physical(
  name: string,
  parameters: THREE.MeshPhysicalMaterialParameters,
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial(parameters);
  material.name = name;
  return material;
}

function standard(
  name: string,
  parameters: THREE.MeshStandardMaterialParameters,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial(parameters);
  material.name = name;
  return material;
}

function createMaterials() {
  const orange = physical('aircraft-orange-clearcoat', {
    color: DEFAULT_AIRCRAFT_PAINT_COLOR,
    roughness: 0.27,
    metalness: 0.03,
    clearcoat: 0.94,
    clearcoatRoughness: 0.13,
    sheen: 0.08,
    sheenColor: new THREE.Color(ORANGE_SHEEN),
  });
  orange.side = THREE.DoubleSide;
  const orangeLight = physical('aircraft-orange-highlight', {
    color: ORANGE_LIGHT,
    roughness: 0.24,
    metalness: 0.02,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });
  orangeLight.side = THREE.DoubleSide;
  const white = physical('aircraft-warm-white', {
    color: WARM_WHITE,
    roughness: 0.37,
    metalness: 0.015,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
  });
  white.side = THREE.DoubleSide;
  const black = standard('aircraft-livery-black', {
    color: GRAPHITE,
    roughness: 0.34,
    metalness: 0.04,
  });
  black.side = THREE.DoubleSide;
  const blackMatte = standard('propeller-composite', {
    color: '#202224',
    roughness: 0.48,
    metalness: 0.03,
  });
  const rubber = standard('tire-rubber', {
    color: '#161616',
    roughness: 0.88,
    metalness: 0,
  });
  const metal = physical('brushed-aircraft-metal', {
    color: '#d5dbde',
    roughness: 0.25,
    metalness: 0.56,
    clearcoat: 0.15,
    clearcoatRoughness: 0.3,
  });
  const darkMetal = standard('dark-engine-metal', {
    color: '#3f4447',
    roughness: 0.32,
    metalness: 0.74,
  });
  const canopy = physical('smoky-cockpit-glass', {
    color: '#6f858d',
    roughness: 0.24,
    metalness: 0.05,
    transmission: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.13,
  });
  canopy.side = THREE.DoubleSide;
  const canopyOverlay = physical('cockpit-glass-continuity-layer', {
    color: '#c7dce0',
    roughness: 0.22,
    metalness: 0,
    transparent: true,
    opacity: 0.17,
    depthWrite: false,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  canopyOverlay.side = THREE.DoubleSide;
  const eyeWhite = physical('eye-white', {
    color: '#f0f2ed',
    roughness: 0.2,
    clearcoat: 0.5,
  });
  eyeWhite.side = THREE.DoubleSide;
  const eyeBlue = physical('iris-blue', {
    color: '#1688d3',
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
  const pupil = physical('pupil-gloss', {
    color: '#071018',
    roughness: 0.06,
    clearcoat: 1,
  });
  const yellow = physical('propeller-safety-yellow', {
    color: '#f3ef1e',
    roughness: 0.28,
    clearcoat: 0.55,
  });
  const navRed = physical('navigation-red', {
    color: '#e33a2e',
    roughness: 0.16,
    emissive: '#b71912',
    emissiveIntensity: 1.3,
  });
  const navGreen = physical('navigation-green', {
    color: '#59d98e',
    roughness: 0.16,
    emissive: '#1e9d59',
    emissiveIntensity: 1.2,
  });
  const blur = new THREE.MeshBasicMaterial({
    name: 'propeller-motion-disc',
    color: '#d5e2dc',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const shadow = new THREE.MeshBasicMaterial({
    name: 'aircraft-contact-shadow',
    color: '#1d2829',
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });

  return {
    orange,
    orangeLight,
    white,
    black,
    blackMatte,
    rubber,
    metal,
    darkMetal,
    canopy,
    canopyOverlay,
    eyeWhite,
    eyeBlue,
    pupil,
    yellow,
    navRed,
    navGreen,
    blur,
    shadow,
  };
}

function makeMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  shadows = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}

type FuselageRing = readonly [z: number, centerY: number, radiusX: number, radiusY: number];

const FUSELAGE_RINGS: readonly FuselageRing[] = [
  [-4.85, 2.34, 0.13, 0.16],
  [-4.57, 2.32, 0.29, 0.33],
  [-4.08, 2.29, 0.43, 0.47],
  [-3.36, 2.25, 0.56, 0.59],
  [-2.42, 2.2, 0.68, 0.71],
  [-1.55, 2.16, 0.84, 0.85],
  [-0.72, 2.13, 0.96, 0.94],
  [0.18, 2.11, 1.01, 0.98],
  [1.08, 2.09, 1.02, 0.97],
  [1.92, 2.08, 0.99, 0.92],
  [2.7, 2.09, 0.91, 0.83],
  [3.32, 2.12, 0.79, 0.72],
  [3.78, 2.16, 0.63, 0.57],
  [4.08, 2.22, 0.4, 0.4],
];

function createFuselageHalf(lower: boolean): THREE.BufferGeometry {
  const positions: number[] = [];
  const angularSegments = 28;
  const startAngle = lower ? Math.PI / 2 : -Math.PI / 2;
  const endAngle = lower ? (Math.PI * 3) / 2 : Math.PI / 2;

  const pushPoint = (ring: FuselageRing, angle: number) => {
    const [z, centerY, radiusX, radiusY] = ring;
    positions.push(Math.sin(angle) * radiusX, centerY + Math.cos(angle) * radiusY, z);
  };

  for (let ringIndex = 0; ringIndex < FUSELAGE_RINGS.length - 1; ringIndex += 1) {
    const current = FUSELAGE_RINGS[ringIndex];
    const next = FUSELAGE_RINGS[ringIndex + 1];
    for (let segment = 0; segment < angularSegments; segment += 1) {
      const a = THREE.MathUtils.lerp(startAngle, endAngle, segment / angularSegments);
      const b = THREE.MathUtils.lerp(startAngle, endAngle, (segment + 1) / angularSegments);
      pushPoint(current, a);
      pushPoint(next, a);
      pushPoint(next, b);
      pushPoint(current, a);
      pushPoint(next, b);
      pushPoint(current, b);
    }
  }

  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry = mergeVertices(geometry, 0.0001);
  geometry.computeVertexNormals();
  return geometry;
}

type FuselageProfile = {
  centerY: number;
  radiusX: number;
  radiusY: number;
};

type FuselageSidePoint = readonly [z: number, y: number];

function sampleFuselageProfile(z: number): FuselageProfile {
  const first = FUSELAGE_RINGS[0];
  const last = FUSELAGE_RINGS[FUSELAGE_RINGS.length - 1];
  if (z <= first[0]) return { centerY: first[1], radiusX: first[2], radiusY: first[3] };
  if (z >= last[0]) return { centerY: last[1], radiusX: last[2], radiusY: last[3] };

  for (let index = 0; index < FUSELAGE_RINGS.length - 1; index += 1) {
    const current = FUSELAGE_RINGS[index];
    const next = FUSELAGE_RINGS[index + 1];
    if (z < current[0] || z > next[0]) continue;
    const t = (z - current[0]) / Math.max(0.0001, next[0] - current[0]);
    return {
      centerY: THREE.MathUtils.lerp(current[1], next[1], t),
      radiusX: THREE.MathUtils.lerp(current[2], next[2], t),
      radiusY: THREE.MathUtils.lerp(current[3], next[3], t),
    };
  }

  return { centerY: last[1], radiusX: last[2], radiusY: last[3] };
}

function fuselagePointAtAngle(z: number, angle: number, outset: number): THREE.Vector3 {
  const profile = sampleFuselageProfile(z);
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  const point = new THREE.Vector3(
    sine * profile.radiusX,
    profile.centerY + cosine * profile.radiusY,
    z,
  );
  const normal = new THREE.Vector2(
    sine / Math.max(0.001, profile.radiusX),
    cosine / Math.max(0.001, profile.radiusY),
  ).normalize();
  point.x += normal.x * outset;
  point.y += normal.y * outset;
  return point;
}

function fuselageSideSurfacePoint(
  side: -1 | 1,
  z: number,
  y: number,
  outset: number,
): THREE.Vector3 {
  const profile = sampleFuselageProfile(z);
  const normalizedY = THREE.MathUtils.clamp(
    (y - profile.centerY) / Math.max(0.001, profile.radiusY),
    -0.999,
    0.999,
  );
  const x = profile.radiusX * Math.sqrt(Math.max(0, 1 - normalizedY * normalizedY));
  const normal = new THREE.Vector2(
    (side * x) / Math.max(0.001, profile.radiusX * profile.radiusX),
    (y - profile.centerY) / Math.max(0.001, profile.radiusY * profile.radiusY),
  ).normalize();
  return new THREE.Vector3(
    side * x + normal.x * outset,
    y + normal.y * outset,
    z,
  );
}

function createConformingUpperFuselageBand(
  zMin: number,
  zMax: number,
  outset = 0.006,
  zSegments = 4,
  angularSegments = 28,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= zSegments; row += 1) {
    const z = THREE.MathUtils.lerp(zMin, zMax, row / zSegments);
    for (let column = 0; column <= angularSegments; column += 1) {
      const angle = THREE.MathUtils.lerp(-Math.PI / 2, Math.PI / 2, column / angularSegments);
      const point = fuselagePointAtAngle(z, angle, outset);
      positions.push(point.x, point.y, point.z);
    }
  }
  const rowSize = angularSegments + 1;
  for (let row = 0; row < zSegments; row += 1) {
    for (let column = 0; column < angularSegments; column += 1) {
      const a = row * rowSize + column;
      const b = a + rowSize;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createConformingSideRibbon(
  side: -1 | 1,
  controlPoints: readonly FuselageSidePoint[],
  width: number,
  outset = 0.006,
  segments = 48,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(
    controlPoints.map(([z, y]) => new THREE.Vector3(z, y, 0)),
    false,
    'centripetal',
  );
  const positions: number[] = [];
  const indices: number[] = [];
  const halfWidth = width * 0.5;
  for (let sample = 0; sample <= segments; sample += 1) {
    const t = sample / segments;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const normalZ = -tangent.y;
    const normalY = tangent.x;
    for (const direction of [1, -1]) {
      const z = center.x + normalZ * halfWidth * direction;
      const y = center.y + normalY * halfWidth * direction;
      const point = fuselageSideSurfacePoint(side, z, y, outset);
      positions.push(point.x, point.y, point.z);
    }
  }
  for (let sample = 0; sample < segments; sample += 1) {
    const a = sample * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    if (side > 0) indices.push(a, c, b, b, c, d);
    else indices.push(a, b, c, b, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createConformingSideShape(
  side: -1 | 1,
  contour: readonly FuselageSidePoint[],
  outset = 0.007,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  contour.forEach(([z, y], index) => {
    if (index === 0) shape.moveTo(z, y);
    else shape.lineTo(z, y);
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index += 1) {
    const point = fuselageSideSurfacePoint(
      side,
      positions.getX(index),
      positions.getY(index),
      outset,
    );
    positions.setXYZ(index, point.x, point.y, point.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createConformingSideQuad(
  side: -1 | 1,
  corners: readonly FuselageSidePoint[],
  outset = 0.007,
  uSegments = 4,
  vSegments = 12,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const [lowerStart, lowerEnd, upperEnd, upperStart] = corners;
  for (let row = 0; row <= vSegments; row += 1) {
    const v = row / vSegments;
    for (let column = 0; column <= uSegments; column += 1) {
      const u = column / uSegments;
      const lowerZ = THREE.MathUtils.lerp(lowerStart[0], lowerEnd[0], u);
      const lowerY = THREE.MathUtils.lerp(lowerStart[1], lowerEnd[1], u);
      const upperZ = THREE.MathUtils.lerp(upperStart[0], upperEnd[0], u);
      const upperY = THREE.MathUtils.lerp(upperStart[1], upperEnd[1], u);
      const point = fuselageSideSurfacePoint(
        side,
        THREE.MathUtils.lerp(lowerZ, upperZ, v),
        THREE.MathUtils.lerp(lowerY, upperY, v),
        outset,
      );
      positions.push(point.x, point.y, point.z);
    }
  }
  const rowSize = uSegments + 1;
  for (let row = 0; row < vSegments; row += 1) {
    for (let column = 0; column < uSegments; column += 1) {
      const a = row * rowSize + column;
      const b = a + 1;
      const c = a + rowSize;
      const d = c + 1;
      if (side < 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function rotatedSideRectangle(
  centerZ: number,
  centerY: number,
  width: number,
  height: number,
  angle: number,
): FuselageSidePoint[] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [
    [-width * 0.5, -height * 0.5],
    [width * 0.5, -height * 0.5],
    [width * 0.5, height * 0.5],
    [-width * 0.5, height * 0.5],
  ].map(([localZ, localY]) => [
    centerZ + localZ * cosine - localY * sine,
    centerY + localZ * sine + localY * cosine,
  ] as const);
}

function ellipseSideContour(
  centerZ: number,
  centerY: number,
  radiusZ: number,
  radiusY: number,
  segments = 24,
): FuselageSidePoint[] {
  return Array.from({ length: segments }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return [centerZ + Math.cos(angle) * radiusZ, centerY + Math.sin(angle) * radiusY] as const;
  });
}

type WingStation = {
  x: number;
  y: number;
  leading: number;
  trailing: number;
  thickness: number;
};

const MAIN_WING_STATIONS: readonly WingStation[] = [
  { x: 0.12, y: 2.04, leading: 1.22, trailing: -0.98, thickness: 0.24 },
  { x: 1.85, y: 2.25, leading: 1.12, trailing: -0.88, thickness: 0.21 },
  { x: 3.75, y: 2.47, leading: 0.98, trailing: -0.74, thickness: 0.17 },
  { x: 5.24, y: 2.64, leading: 0.84, trailing: -0.58, thickness: 0.13 },
  { x: 5.68, y: 2.69, leading: 0.68, trailing: -0.4, thickness: 0.09 },
  { x: 5.88, y: 2.71, leading: 0.45, trailing: -0.16, thickness: 0.055 },
];

const TAIL_WING_STATIONS: readonly WingStation[] = [
  { x: 0.08, y: 2.29, leading: -3.82, trailing: -5.02, thickness: 0.15 },
  { x: 1.2, y: 2.35, leading: -3.97, trailing: -4.9, thickness: 0.12 },
  { x: 1.78, y: 2.38, leading: -4.12, trailing: -4.83, thickness: 0.09 },
  { x: 2.05, y: 2.39, leading: -4.3, trailing: -4.72, thickness: 0.05 },
];

const AIRFOIL_FRACTIONS = [0, 0.06, 0.2, 0.42, 0.68, 0.88, 1] as const;

function airfoilHeight(fraction: number): number {
  if (fraction <= 0) return 0.1;
  if (fraction >= 1) return 0.035;
  return Math.pow(Math.sin(Math.PI * fraction), 0.72);
}

function wingSurfaceY(station: WingStation, fraction: number, top: boolean): number {
  const chord = station.leading - station.trailing;
  const camber = Math.sin(Math.PI * fraction) * chord * 0.018;
  const halfThickness = station.thickness * airfoilHeight(fraction) * 0.5;
  return station.y + camber * (top ? 1 : 0.22) + (top ? halfThickness : -halfThickness);
}

function createAirfoilWing(
  side: -1 | 1,
  stations: readonly WingStation[],
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const chordCount = AIRFOIL_FRACTIONS.length;
  const layerSize = stations.length * chordCount;

  for (const top of [true, false]) {
    for (const station of stations) {
      const chord = station.leading - station.trailing;
      for (const fraction of AIRFOIL_FRACTIONS) {
        positions.push(
          side * station.x,
          wingSurfaceY(station, fraction, top),
          station.leading - chord * fraction,
        );
      }
    }
  }

  for (let stationIndex = 0; stationIndex < stations.length - 1; stationIndex += 1) {
    for (let chordIndex = 0; chordIndex < chordCount - 1; chordIndex += 1) {
      const a = stationIndex * chordCount + chordIndex;
      const b = a + 1;
      const c = a + chordCount;
      const d = c + 1;
      if (side > 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);

      const ba = layerSize + a;
      const bb = layerSize + b;
      const bc = layerSize + c;
      const bd = layerSize + d;
      if (side > 0) indices.push(ba, bb, bc, bb, bd, bc);
      else indices.push(ba, bc, bb, bb, bc, bd);
    }

    const topLeading = stationIndex * chordCount;
    const nextTopLeading = topLeading + chordCount;
    const bottomLeading = layerSize + topLeading;
    const nextBottomLeading = layerSize + nextTopLeading;
    indices.push(
      topLeading,
      bottomLeading,
      nextTopLeading,
      bottomLeading,
      nextBottomLeading,
      nextTopLeading,
    );

    const topTrailing = topLeading + chordCount - 1;
    const nextTopTrailing = nextTopLeading + chordCount - 1;
    const bottomTrailing = layerSize + topTrailing;
    const nextBottomTrailing = layerSize + nextTopTrailing;
    indices.push(
      topTrailing,
      nextTopTrailing,
      bottomTrailing,
      bottomTrailing,
      nextTopTrailing,
      nextBottomTrailing,
    );
  }

  for (const stationIndex of [0, stations.length - 1]) {
    const base = stationIndex * chordCount;
    for (let chordIndex = 0; chordIndex < chordCount - 1; chordIndex += 1) {
      const topA = base + chordIndex;
      const topB = topA + 1;
      const bottomA = layerSize + topA;
      const bottomB = layerSize + topB;
      indices.push(topA, topB, bottomA, bottomA, topB, bottomB);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createWingInsetPanels(
  side: -1 | 1,
  stations: readonly WingStation[],
  tail = false,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const panelStations = stations.slice(0, -1);
  const leadingInset = tail ? 0.075 : 0.17;
  const trailingInset = tail ? 0.055 : 0.1;
  const chordSamples = 7;

  for (const top of [true, false]) {
    for (const station of panelStations) {
      const chord = station.leading - station.trailing;
      const leadFraction = leadingInset / chord;
      const trailFraction = 1 - trailingInset / chord;
      for (let sample = 0; sample < chordSamples; sample += 1) {
        const fraction = THREE.MathUtils.lerp(
          leadFraction,
          trailFraction,
          sample / (chordSamples - 1),
        );
        positions.push(
          side * station.x,
          wingSurfaceY(station, fraction, top) + (top ? 0.012 : -0.012),
          station.leading - chord * fraction,
        );
      }
    }
  }

  const layerSize = panelStations.length * chordSamples;
  for (let stationIndex = 0; stationIndex < panelStations.length - 1; stationIndex += 1) {
    for (let sample = 0; sample < chordSamples - 1; sample += 1) {
      const a = stationIndex * chordSamples + sample;
      const b = a + 1;
      const c = a + chordSamples;
      const d = c + 1;
      if (side > 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, b, c, b, d, c);

      const ba = layerSize + a;
      const bb = layerSize + b;
      const bc = layerSize + c;
      const bd = layerSize + d;
      if (side > 0) indices.push(ba, bb, bc, bb, bd, bc);
      else indices.push(ba, bc, bb, bb, bc, bd);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function sampleWingStation(x: number, stations: readonly WingStation[]): WingStation {
  const clamped = THREE.MathUtils.clamp(x, stations[0].x, stations[stations.length - 1].x);
  for (let index = 0; index < stations.length - 1; index += 1) {
    const a = stations[index];
    const b = stations[index + 1];
    if (clamped > b.x) continue;
    const t = (clamped - a.x) / Math.max(0.0001, b.x - a.x);
    return {
      x: clamped,
      y: THREE.MathUtils.lerp(a.y, b.y, t),
      leading: THREE.MathUtils.lerp(a.leading, b.leading, t),
      trailing: THREE.MathUtils.lerp(a.trailing, b.trailing, t),
      thickness: THREE.MathUtils.lerp(a.thickness, b.thickness, t),
    };
  }
  return { ...stations[stations.length - 1] };
}

function cylinderBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  name: string,
  radialSegments = 10,
): THREE.Mesh {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const mesh = makeMesh(
    new THREE.CylinderGeometry(radius, radius * 0.92, length, radialSegments, 1),
    material,
    name,
  );
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function createTailFin(materials: PlaneMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'vertical-tail-fin';
  const shape = new THREE.Shape();
  shape.moveTo(0.7, 0);
  shape.lineTo(0.38, 0.38);
  shape.lineTo(-0.38, 1.42);
  shape.quadraticCurveTo(-0.48, 1.58, -0.66, 1.63);
  shape.quadraticCurveTo(-0.84, 1.65, -0.97, 1.48);
  shape.lineTo(-1.16, 0.05);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.14,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.035,
    bevelThickness: 0.028,
    curveSegments: 12,
  });
  geometry.translate(0, 0, -0.07);
  geometry.rotateY(-Math.PI / 2);
  const fin = makeMesh(geometry, materials.orange, 'orange-vertical-fin');
  fin.position.set(0, 2.29, -3.7);
  group.add(fin);

  for (const side of [-1, 1] as const) {
    const lowerStripe = makeMesh(
      new THREE.PlaneGeometry(1.02, 0.29),
      materials.black,
      `tail-lower-chevron-${side < 0 ? 'left' : 'right'}`,
      false,
    );
    lowerStripe.position.set(side * 0.105, 3.18, -4.31);
    lowerStripe.rotation.set(0, side * Math.PI / 2, -0.39 * side);
    const upperStripe = lowerStripe.clone();
    upperStripe.name = `tail-upper-chevron-${side < 0 ? 'left' : 'right'}`;
    upperStripe.scale.set(0.78, 0.62, 1);
    upperStripe.position.set(side * 0.108, 3.5, -4.3);
    upperStripe.rotation.z = -0.43 * side;
    group.add(lowerStripe, upperStripe);

    const dShape = new THREE.Shape();
    dShape.moveTo(-0.32, -0.61);
    dShape.lineTo(-0.22, 0.61);
    dShape.lineTo(0.07, 0.61);
    dShape.bezierCurveTo(0.51, 0.56, 0.49, -0.5, -0.02, -0.61);
    dShape.closePath();
    const dHole = new THREE.Path();
    dHole.moveTo(-0.12, -0.38);
    dHole.lineTo(-0.06, 0.38);
    dHole.bezierCurveTo(0.25, 0.31, 0.23, -0.29, -0.12, -0.38);
    dHole.closePath();
    dShape.holes.push(dHole);
    const mark = makeMesh(
      new THREE.ShapeGeometry(dShape, 18),
      materials.white,
      `tail-d-mark-${side < 0 ? 'left' : 'right'}`,
      false,
    );
    mark.position.set(side * 0.115, 3.29, -4.28);
    mark.rotation.y = side * Math.PI / 2;
    mark.scale.set(0.78, 0.82, 1);
    group.add(mark);
  }
  return group;
}

function createPropeller(materials: PlaneMaterials): {
  pivot: THREE.Group;
  blur: THREE.Mesh;
} {
  const pivot = new THREE.Group();
  pivot.name = 'propeller-pivot';
  pivot.position.set(0, PROPELLER_HUB_HEIGHT, 4.34);

  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.1, 0.32);
  bladeShape.quadraticCurveTo(-0.19, 0.8, -0.22, 1.27);
  bladeShape.quadraticCurveTo(-0.21, 1.63, -0.1, PROPELLER_RADIUS);
  bladeShape.lineTo(0.08, PROPELLER_RADIUS);
  bladeShape.quadraticCurveTo(0.17, 1.6, 0.21, 1.23);
  bladeShape.quadraticCurveTo(0.2, 0.73, 0.1, 0.32);
  bladeShape.closePath();
  const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.068,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.018,
    bevelThickness: 0.014,
    curveSegments: 14,
  });
  bladeGeometry.translate(0, 0, -0.034);

  const tipShape = new THREE.Shape();
  tipShape.moveTo(-0.18, 1.64);
  tipShape.quadraticCurveTo(-0.15, 1.74, -0.1, PROPELLER_RADIUS);
  tipShape.lineTo(0.08, PROPELLER_RADIUS);
  tipShape.quadraticCurveTo(0.11, 1.73, 0.15, 1.62);
  tipShape.closePath();
  const tipGeometry = new THREE.ExtrudeGeometry(tipShape, {
    depth: 0.073,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.012,
    bevelThickness: 0.01,
    curveSegments: 8,
  });
  tipGeometry.translate(0, 0, -0.0365);

  for (let index = 0; index < 3; index += 1) {
    const bladeAssembly = new THREE.Group();
    bladeAssembly.name = `propeller-blade-${index + 1}-assembly`;
    bladeAssembly.rotation.z = Math.PI + (index * Math.PI * 2) / 3;
    const blade = makeMesh(bladeGeometry, materials.blackMatte, `propeller-blade-${index + 1}`);
    blade.rotation.z = -0.08;
    const tip = makeMesh(tipGeometry, materials.yellow, `propeller-safety-tip-${index + 1}`);
    tip.rotation.z = -0.08;
    bladeAssembly.add(blade, tip);
    pivot.add(bladeAssembly);
  }

  const hub = makeMesh(new THREE.SphereGeometry(0.47, 36, 24), materials.metal, 'propeller-hub');
  hub.scale.set(1, 1, 1.05);
  hub.position.z = 0.09;
  const upperHub = makeMesh(
    new THREE.SphereGeometry(0.474, 36, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    materials.darkMetal,
    'graphite-upper-spinner-shell',
  );
  upperHub.scale.set(1, 1, 1.05);
  upperHub.position.z = 0.09;
  pivot.add(hub, upperHub);

  const blur = makeMesh(
    new THREE.RingGeometry(0.47, PROPELLER_SAFETY_RADIUS, 96),
    materials.blur,
    'propeller-motion-blur',
    false,
  );
  blur.position.z = 0.135;
  blur.renderOrder = 3;
  pivot.add(blur);
  return { pivot, blur };
}

function createWheel(
  name: string,
  radius: number,
  width: number,
  materials: PlaneMaterials,
): THREE.Group {
  const pivot = new THREE.Group();
  pivot.name = `${name}-pivot`;
  const tire = makeMesh(
    new THREE.TorusGeometry(radius * 0.72, radius * 0.28, 12, 32),
    materials.rubber,
    `${name}-tire`,
  );
  tire.rotation.y = Math.PI / 2;
  const hub = makeMesh(
    new THREE.CylinderGeometry(radius * 0.34, radius * 0.34, width * 1.08, 20),
    materials.metal,
    `${name}-hub`,
  );
  hub.rotation.z = Math.PI / 2;
  const cap = makeMesh(
    new THREE.CylinderGeometry(radius * 0.16, radius * 0.2, width * 1.15, 16),
    materials.darkMetal,
    `${name}-hub-cap`,
  );
  cap.rotation.z = Math.PI / 2;
  pivot.add(tire, hub, cap);
  return pivot;
}

function createCockpit(materials: PlaneMaterials): {
  group: THREE.Group;
  face: AirplaneModel['face'];
} {
  const group = new THREE.Group();
  group.name = 'cockpit-and-face';
  type CabinProfile = { z: number; baseY: number; radiusX: number; height: number };
  const cabinProfiles: readonly CabinProfile[] = [
    { z: 1.2, baseY: 2.45, radiusX: 0.58, height: 0.4 },
    { z: 1.08, baseY: 2.46, radiusX: 0.63, height: 0.61 },
    { z: 0.94, baseY: 2.47, radiusX: 0.64, height: 1.03 },
    { z: 0.78, baseY: 2.47, radiusX: 0.68, height: 1.23 },
    { z: 0.56, baseY: 2.47, radiusX: 0.7, height: 1.29 },
    { z: 0.28, baseY: 2.46, radiusX: 0.71, height: 1.31 },
    { z: 0, baseY: 2.45, radiusX: 0.7, height: 1.28 },
    { z: -0.28, baseY: 2.44, radiusX: 0.68, height: 1.19 },
    { z: -0.55, baseY: 2.42, radiusX: 0.62, height: 1.02 },
    { z: -0.78, baseY: 2.39, radiusX: 0.53, height: 0.77 },
    { z: -0.98, baseY: 2.36, radiusX: 0.39, height: 0.52 },
    { z: -1.16, baseY: 2.33, radiusX: 0.27, height: 0.39 },
    { z: -1.31, baseY: 2.3, radiusX: 0.14, height: 0.18 },
  ];
  const cabinPositions: number[] = [];
  const cabinIndices: number[] = [];
  const cabinSegments = 24;
  const cabinExponent = 3.7;
  const cabinPower = 2 / cabinExponent;
  for (const profile of cabinProfiles) {
    for (let segment = 0; segment <= cabinSegments; segment += 1) {
      const angle = (segment / cabinSegments) * Math.PI;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      cabinPositions.push(
        Math.sign(cosine) * Math.pow(Math.abs(cosine), cabinPower) * profile.radiusX,
        profile.baseY + Math.pow(Math.max(0, sine), cabinPower) * profile.height,
        profile.z,
      );
    }
  }
  const cabinRow = cabinSegments + 1;
  for (let profile = 0; profile < cabinProfiles.length - 1; profile += 1) {
    for (let segment = 0; segment < cabinSegments; segment += 1) {
      const a = profile * cabinRow + segment;
      const b = a + 1;
      const c = a + cabinRow;
      const d = c + 1;
      cabinIndices.push(a, c, b, b, c, d);
    }
  }
  const cabinGeometry = new THREE.BufferGeometry();
  cabinGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cabinPositions, 3));
  cabinGeometry.setIndex(cabinIndices);
  cabinGeometry.computeVertexNormals();
  const cabin = makeMesh(cabinGeometry, materials.orange, 'lofted-cockpit-cabin');
  group.add(cabin);

  const sampleCabinProfile = (z: number): CabinProfile => {
    if (z >= cabinProfiles[0].z) return cabinProfiles[0];
    if (z <= cabinProfiles[cabinProfiles.length - 1].z) {
      return cabinProfiles[cabinProfiles.length - 1];
    }
    for (let index = 0; index < cabinProfiles.length - 1; index += 1) {
      const a = cabinProfiles[index];
      const b = cabinProfiles[index + 1];
      if (z > a.z || z < b.z) continue;
      const t = (a.z - z) / Math.max(0.0001, a.z - b.z);
      return {
        z,
        baseY: THREE.MathUtils.lerp(a.baseY, b.baseY, t),
        radiusX: THREE.MathUtils.lerp(a.radiusX, b.radiusX, t),
        height: THREE.MathUtils.lerp(a.height, b.height, t),
      };
    }
    return cabinProfiles[cabinProfiles.length - 1];
  };

  const cabinSurfaceX = (z: number, y: number): number => {
    const profile = sampleCabinProfile(z);
    const normalizedY = THREE.MathUtils.clamp(
      (y - profile.baseY) / Math.max(0.001, profile.height),
      0,
      1,
    );
    return profile.radiusX * Math.pow(
      Math.max(0, 1 - Math.pow(normalizedY, cabinExponent)),
      1 / cabinExponent,
    );
  };

  type SideWindowCorners = {
    frontLower: readonly [z: number, y: number];
    frontUpper: readonly [z: number, y: number];
    rearUpper: readonly [z: number, y: number];
    rearLower: readonly [z: number, y: number];
  };

  const sideConformingWindow = (
    side: -1 | 1,
    corners: SideWindowCorners,
    outset: number,
    upperArch = 0,
    uSegments = 12,
    vSegments = 7,
  ): THREE.BufferGeometry => {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let row = 0; row <= vSegments; row += 1) {
      const v = row / vSegments;
      for (let column = 0; column <= uSegments; column += 1) {
        const u = column / uSegments;
        const lowerZ = THREE.MathUtils.lerp(corners.frontLower[0], corners.rearLower[0], u);
        const lowerY = THREE.MathUtils.lerp(corners.frontLower[1], corners.rearLower[1], u);
        const upperZ = THREE.MathUtils.lerp(corners.frontUpper[0], corners.rearUpper[0], u);
        const upperY = THREE.MathUtils.lerp(corners.frontUpper[1], corners.rearUpper[1], u)
          + Math.sin(u * Math.PI) * upperArch;
        const z = THREE.MathUtils.lerp(lowerZ, upperZ, v);
        const y = THREE.MathUtils.lerp(lowerY, upperY, v);
        positions.push(side * (cabinSurfaceX(z, y) + outset), y, z);
      }
    }
    const rowSize = uSegments + 1;
    for (let row = 0; row < vSegments; row += 1) {
      for (let column = 0; column < uSegments; column += 1) {
        const a = row * rowSize + column;
        const b = a + 1;
        const c = a + rowSize;
        const d = c + 1;
        if (side < 0) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };

  for (const side of [-1, 1] as const) {
    const sideName = side < 0 ? 'left' : 'right';
    const surround = makeMesh(
      sideConformingWindow(side, {
        frontLower: [0.7, 2.53],
        frontUpper: [0.6, 3.45],
        rearUpper: [-0.26, 3.32],
        rearLower: [-0.36, 2.56],
      }, 0.012, 0.08),
      materials.black,
      `cockpit-window-surround-${sideName}`,
      false,
    );
    const window = makeMesh(
      sideConformingWindow(side, {
        frontLower: [0.64, 2.6],
        frontUpper: [0.55, 3.38],
        rearUpper: [-0.2, 3.26],
        rearLower: [-0.3, 2.63],
      }, 0.024, 0.08),
      materials.canopy,
      `cockpit-side-window-${sideName}`,
      false,
    );
    const windowHighlight = makeMesh(
      sideConformingWindow(side, {
        frontLower: [0.64, 2.6],
        frontUpper: [0.55, 3.38],
        rearUpper: [-0.2, 3.26],
        rearLower: [-0.3, 2.63],
      }, 0.032, 0.08),
      materials.canopyOverlay,
      `cockpit-side-window-continuity-layer-${sideName}`,
      false,
    );
    windowHighlight.renderOrder = 5;
    group.add(surround, window, windowHighlight);
  }

  const windshieldPoint = (u: number, v: number, outset = 0): THREE.Vector3 => {
    const y = THREE.MathUtils.lerp(2.7, 3.55, v) + (1 - u * u) * 0.012;
    const z = THREE.MathUtils.lerp(1.18, 0.9, v) + (1 - u * u) * 0.05 + outset;
    const halfWidth = THREE.MathUtils.lerp(0.62, 0.43, v);
    return new THREE.Vector3(u * halfWidth, y, z);
  };

  const windshieldSurface = (
    uStart: number,
    uEnd: number,
    vStart: number,
    vEnd: number,
    outset: number,
    uSegments = 16,
    vSegments = 10,
  ): THREE.BufferGeometry => {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let row = 0; row <= vSegments; row += 1) {
      const v = THREE.MathUtils.lerp(vStart, vEnd, row / vSegments);
      for (let column = 0; column <= uSegments; column += 1) {
        const u = THREE.MathUtils.lerp(uStart, uEnd, column / uSegments);
        const point = windshieldPoint(u, v, outset);
        positions.push(point.x, point.y, point.z);
      }
    }
    const rowSize = uSegments + 1;
    for (let row = 0; row < vSegments; row += 1) {
      for (let column = 0; column < uSegments; column += 1) {
        const a = row * rowSize + column;
        const b = a + 1;
        const c = a + rowSize;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };

  const windshieldSurround = makeMesh(
    windshieldSurface(-1, 1, 0, 1, 0, 20, 12),
    materials.black,
    'conforming-front-windshield-surround',
    false,
  );
  const windshield = makeMesh(
    windshieldSurface(-0.94, 0.94, 0.05, 0.95, 0.009, 20, 11),
    materials.canopy,
    'curved-front-windshield-glass',
    false,
  );
  const eyeBand = makeMesh(
    windshieldSurface(-0.91, 0.91, 0.39, 0.74, 0.023, 18, 6),
    materials.eyeWhite,
    'conforming-white-windshield-eye-band',
    false,
  );

  const browPatchGeometry = (side: -1 | 1): THREE.BufferGeometry => {
    const positions: number[] = [];
    const indices: number[] = [];
    const segments = 10;
    const start = side < 0 ? -0.92 : 0;
    const end = side < 0 ? 0 : 0.92;
    for (let column = 0; column <= segments; column += 1) {
      const u = THREE.MathUtils.lerp(start, end, column / segments);
      const centerWeight = Math.pow(1 - Math.abs(u) / 0.92, 1.8);
      const lowerV = 0.74 - centerWeight * 0.29;
      const lower = windshieldPoint(u, lowerV, 0.027);
      const upper = windshieldPoint(u, 0.955, 0.027);
      positions.push(lower.x, lower.y, lower.z, upper.x, upper.y, upper.z);
      if (column < segments) {
        const a = column * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  };

  const leftBrow = makeMesh(
    browPatchGeometry(-1),
    materials.orange,
    'left-integrated-orange-windshield-brow',
    false,
  );
  const rightBrow = makeMesh(
    browPatchGeometry(1),
    materials.orange,
    'right-integrated-orange-windshield-brow',
    false,
  );
  group.add(windshieldSurround, windshield, eyeBand, leftBrow, rightBrow);

  const eyes: THREE.Group[] = [];
  const facePlane = new THREE.Group();
  facePlane.name = 'recessed-eye-layer-on-windshield';
  const eyeCenter = windshieldPoint(0, 0.59, 0.038);
  facePlane.position.copy(eyeCenter);
  facePlane.rotation.x = Math.atan2(0.9 - 1.18, 3.55 - 2.7);
  for (const side of [-1, 1] as const) {
    const eye = new THREE.Group();
    eye.name = `${side < 0 ? 'left' : 'right'}-expressive-eye`;
    eye.position.set(side * 0.205, side < 0 ? -0.002 : -0.025, 0);
    const pupilGroup = new THREE.Group();
    pupilGroup.name = `${side < 0 ? 'left' : 'right'}-pupil-pivot`;
    pupilGroup.position.set(-side * 0.045, -0.035, 0.018);
    const iris = makeMesh(new THREE.CircleGeometry(0.11, 32), materials.eyeBlue, 'blue-iris', false);
    iris.scale.y = 0.95;
    const pupil = makeMesh(new THREE.CircleGeometry(0.049, 24), materials.pupil, 'pupil', false);
    pupil.position.z = 0.007;
    const catchlight = makeMesh(new THREE.CircleGeometry(0.018, 12), materials.eyeWhite, 'eye-catchlight', false);
    catchlight.position.set(-0.02, 0.025, 0.009);
    pupil.add(catchlight);
    pupilGroup.add(iris, pupil);
    eye.add(pupilGroup);
    facePlane.add(eye);
    eyes.push(pupilGroup);
  }
  group.add(facePlane);

  const glassContinuity = makeMesh(
    windshieldSurface(-0.925, 0.925, 0.075, 0.935, 0.07, 20, 11),
    materials.canopyOverlay,
    'continuous-front-glass-highlight-layer',
    false,
  );
  glassContinuity.renderOrder = 5;
  group.add(glassContinuity);

  return {
    group,
    face: {
      leftPupil: eyes[0],
      rightPupil: eyes[1],
      leftBrow,
      rightBrow,
    },
  };
}

function createSideLivery(materials: PlaneMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = 'side-livery-and-decals';

  const collar = makeMesh(
    createConformingUpperFuselageBand(-1.59, -1.37),
    materials.black,
    'conforming-black-aft-cockpit-band',
    false,
  );
  collar.renderOrder = 2;
  group.add(collar);

  for (const side of [-1, 1] as const) {
    const sideName = side < 0 ? 'left' : 'right';
    const upperStripePoints: readonly FuselageSidePoint[] = [
      [3.18, 2.08],
      [1.55, 2.07],
      [-0.35, 2.08],
      [-1.08, 2.12],
      [-1.37, 2.155],
    ];
    const upperStripe = makeMesh(
      createConformingSideRibbon(side, upperStripePoints, 0.082),
      materials.black,
      `${sideName}-conforming-upper-black-pinstripe`,
      false,
    );
    const lowerStripePoints: readonly FuselageSidePoint[] = [
      [3.18, 1.96],
      [1.55, 1.95],
      [-0.35, 1.96],
      [-1.08, 2.01],
      [-1.37, 2.115],
    ];
    const lowerStripe = makeMesh(
      createConformingSideRibbon(side, lowerStripePoints, 0.045, 0.0065),
      materials.black,
      `${sideName}-conforming-lower-black-pinstripe`,
      false,
    );
    upperStripe.renderOrder = 2;
    lowerStripe.renderOrder = 2;
    group.add(upperStripe, lowerStripe);

    for (let index = 0; index < 2; index += 1) {
      const slash = makeMesh(
        createConformingSideQuad(
          side,
          rotatedSideRectangle(-1.03 + index * 0.31, 2.51, 0.18, 0.64, -0.25),
          0.007,
        ),
        materials.white,
        `${sideName}-conforming-white-aft-slash-${index + 1}`,
        false,
      );
      slash.renderOrder = 2;
      group.add(slash);
    }

    const smilePoints: readonly FuselageSidePoint[] = [
      [3.52, 1.69],
      [3.2, 1.61],
      [2.88, 1.69],
    ];
    const smile = makeMesh(
      createConformingSideRibbon(side, smilePoints, 0.032, 0.0065, 20),
      materials.black,
      `${sideName}-conforming-smile-line`,
      false,
    );
    smile.renderOrder = 2;
    group.add(smile);
  }
  return group;
}

function collectDiagnostics(): AirplaneModelDiagnostics {
  return {
    paint: {
      selectedColor: DEFAULT_AIRCRAFT_PAINT_COLOR,
      revision: 0,
    },
    dimensions: {
      overallLength: AIRCRAFT_LENGTH,
      wingspan: AIRCRAFT_WINGSPAN,
      propellerRadius: PROPELLER_RADIUS,
      propellerSafetyRadius: PROPELLER_SAFETY_RADIUS,
      propellerGroundClearance: PROPELLER_GROUND_CLEARANCE,
      mainWheelRadius: MAIN_WHEEL_RADIUS,
      tailWheelRadius: TAIL_WHEEL_RADIUS,
    },
  };
}

export function createAirplaneModel(): AirplaneModel {
  const materials = createMaterials();
  const root = new THREE.Group();
  root.name = 'cropper-seven-aircraft-root';

  const orangeUpper = makeMesh(
    createFuselageHalf(false),
    materials.orange,
    'orange-upper-fuselage-shell',
  );
  const whiteLower = makeMesh(
    createFuselageHalf(true),
    materials.white,
    'white-lower-fuselage-shell',
  );
  root.add(orangeUpper, whiteLower);

  const noseRing = makeMesh(
    new THREE.CylinderGeometry(0.56, 0.69, 0.46, 40, 3),
    materials.metal,
    'silver-nose-cowling',
  );
  noseRing.rotation.x = Math.PI / 2;
  noseRing.position.set(0, 2.22, 4.04);
  root.add(noseRing);

  const bellyHopper = makeMesh(new THREE.SphereGeometry(1, 28, 18), materials.white, 'crop-hopper-belly');
  bellyHopper.scale.set(0.72, 0.34, 1.18);
  bellyHopper.position.set(0, 1.32, 0.05);
  root.add(bellyHopper);

  const intakeFairing = makeMesh(
    new THREE.SphereGeometry(1, 28, 14),
    materials.orangeLight,
    'integrated-dorsal-intake-fairing',
  );
  intakeFairing.scale.set(0.34, 0.07, 0.36);
  intakeFairing.position.set(0, 2.9, 3.28);
  const noseIntake = makeMesh(
    new THREE.BoxGeometry(0.48, 0.05, 0.028),
    materials.black,
    'dorsal-nose-intake-grille',
  );
  noseIntake.position.set(0, 2.935, 3.57);
  const intakeLip = makeMesh(
    new THREE.BoxGeometry(0.54, 0.025, 0.04),
    materials.orangeLight,
    'dorsal-nose-intake-lip',
  );
  intakeLip.position.set(0, 2.972, 3.55);
  root.add(intakeFairing, noseIntake, intakeLip);

  const cockpit = createCockpit(materials);
  root.add(cockpit.group);
  root.add(createSideLivery(materials));

  for (const side of [-1, 1] as const) {
    const emblem = new THREE.Group();
    emblem.name = `${side < 0 ? 'left' : 'right'}-nose-skull-emblem`;
    const skull = makeMesh(
      createConformingSideShape(side, ellipseSideContour(3.42, 2.02, 0.11, 0.092), 0.007),
      materials.black,
      'conforming-skull-head',
      false,
    );
    const jaw = makeMesh(
      createConformingSideQuad(
        side,
        rotatedSideRectangle(3.42, 1.92, 0.11, 0.07, 0),
        0.0075,
        4,
        5,
      ),
      materials.black,
      'conforming-skull-jaw',
      false,
    );
    const boneA = makeMesh(
      createConformingSideQuad(
        side,
        rotatedSideRectangle(3.42, 1.84, 0.028, 0.3, 0.82),
        0.007,
        3,
        12,
      ),
      materials.black,
      'conforming-crossbone-a',
      false,
    );
    const boneB = makeMesh(
      createConformingSideQuad(
        side,
        rotatedSideRectangle(3.42, 1.84, 0.028, 0.3, -0.82),
        0.007,
        3,
        12,
      ),
      materials.black,
      'conforming-crossbone-b',
      false,
    );
    skull.renderOrder = 2;
    jaw.renderOrder = 2;
    boneA.renderOrder = 2;
    boneB.renderOrder = 2;
    emblem.add(skull, jaw, boneA, boneB);
    root.add(emblem);
  }

  const wingAssembly = new THREE.Group();
  wingAssembly.name = 'main-wing-assembly';
  const controlSurfaces = {
    leftAileron: new THREE.Group(),
    rightAileron: new THREE.Group(),
    elevator: new THREE.Group(),
    rudder: new THREE.Group(),
  };
  controlSurfaces.leftAileron.name = 'left-aileron-pivot';
  controlSurfaces.rightAileron.name = 'right-aileron-pivot';
  controlSurfaces.elevator.name = 'elevator-pivot';
  controlSurfaces.rudder.name = 'rudder-pivot';

  for (const side of [-1, 1] as const) {
    const sideName = side < 0 ? 'left' : 'right';
    const wing = makeMesh(
      createAirfoilWing(side, MAIN_WING_STATIONS),
      materials.orange,
      `${sideName}-orange-airfoil-main-wing`,
    );
    const inset = makeMesh(
      createWingInsetPanels(side, MAIN_WING_STATIONS),
      materials.white,
      `${sideName}-white-inset-wing-panels`,
    );
    wingAssembly.add(wing, inset);

    const aileronPivot = side < 0 ? controlSurfaces.leftAileron : controlSurfaces.rightAileron;
    aileronPivot.position.set(side * 3.95, 2.51, -0.53);
    aileronPivot.rotation.z = side * THREE.MathUtils.degToRad(6.7);
    const aileron = makeMesh(
      new THREE.BoxGeometry(2.34, 0.065, 0.25),
      materials.white,
      `${sideName}-aileron`,
    );
    aileron.position.set(0, 0, -0.02);
    aileronPivot.add(aileron);
    wingAssembly.add(aileronPivot);

    for (const x of [0.95, 1.65, 2.38, 3.13, 3.87, 4.61, 5.24]) {
      const station = sampleWingStation(x, MAIN_WING_STATIONS);
      const chord = station.leading - station.trailing;
      const panelLine = makeMesh(
        new THREE.BoxGeometry(0.016, 0.014, Math.max(0.42, chord - 0.34)),
        materials.black,
        `${sideName}-wing-panel-line-${x}`,
        false,
      );
      panelLine.position.set(
        side * x,
        wingSurfaceY(station, 0.48, true) + 0.014,
        (station.leading + station.trailing) * 0.5 - 0.015,
      );
      panelLine.material = (materials.black as THREE.MeshStandardMaterial).clone();
      (panelLine.material as THREE.MeshStandardMaterial).transparent = true;
      (panelLine.material as THREE.MeshStandardMaterial).opacity = 0.18;
      wingAssembly.add(panelLine);
    }

    const hingeStationA = sampleWingStation(2.55, MAIN_WING_STATIONS);
    const hingeStationB = sampleWingStation(5.35, MAIN_WING_STATIONS);
    const hinge = cylinderBetween(
      new THREE.Vector3(side * 2.55, hingeStationA.y + 0.13, hingeStationA.trailing + 0.31),
      new THREE.Vector3(side * 5.35, hingeStationB.y + 0.08, hingeStationB.trailing + 0.22),
      0.0025,
      materials.black,
      `${sideName}-aileron-hinge-line`,
      6,
    );
    hinge.material = (materials.black as THREE.MeshStandardMaterial).clone();
    (hinge.material as THREE.MeshStandardMaterial).transparent = true;
    (hinge.material as THREE.MeshStandardMaterial).opacity = 0.42;
    wingAssembly.add(hinge);

    const wingtip = makeMesh(
      new THREE.SphereGeometry(0.105, 18, 12),
      materials.navRed,
      `${sideName}-wingtip-navigation-light`,
    );
    wingtip.scale.set(0.75, 0.45, 1.65);
    wingtip.position.set(side * 5.78, 2.7, 0.33);
    wingAssembly.add(wingtip);
  }
  root.add(wingAssembly);

  const leftWingtip = new THREE.Object3D();
  leftWingtip.name = 'left-wingtip-vfx-socket';
  leftWingtip.position.set(-5.77, 2.7, 0.2);
  const rightWingtip = new THREE.Object3D();
  rightWingtip.name = 'right-wingtip-vfx-socket';
  rightWingtip.position.set(5.77, 2.7, 0.2);
  root.add(leftWingtip, rightWingtip);

  for (const side of [-1, 1] as const) {
    root.add(
      cylinderBetween(
        new THREE.Vector3(side * 0.62, 1.48, 0.34),
        new THREE.Vector3(side * 3.78, 2.49, 0.16),
        0.052,
        materials.darkMetal,
        `${side < 0 ? 'left' : 'right'}-wing-brace`,
      ),
    );
  }

  const tailAssembly = new THREE.Group();
  tailAssembly.name = 'tail-assembly';
  for (const side of [-1, 1] as const) {
    const stabilizer = makeMesh(
      createAirfoilWing(side, TAIL_WING_STATIONS),
      materials.orange,
      `${side < 0 ? 'left' : 'right'}-tailplane`,
    );
    const tailInset = makeMesh(
      createWingInsetPanels(side, TAIL_WING_STATIONS, true),
      materials.orangeLight,
      `${side < 0 ? 'left' : 'right'}-tailplane-inset`,
    );
    tailAssembly.add(stabilizer, tailInset);
  }
  controlSurfaces.elevator.position.set(0, 2.36, -4.8);
  const elevator = makeMesh(new THREE.BoxGeometry(3.5, 0.075, 0.24), materials.orange, 'elevator');
  controlSurfaces.elevator.add(elevator);
  tailAssembly.add(controlSurfaces.elevator);
  root.add(tailAssembly, createTailFin(materials));

  controlSurfaces.rudder.position.set(0, 2.29, -4.64);
  const rudderShape = new THREE.Shape();
  rudderShape.moveTo(0.12, 0.02);
  rudderShape.lineTo(0.04, 1.47);
  rudderShape.quadraticCurveTo(-0.08, 1.62, -0.24, 1.55);
  rudderShape.lineTo(-0.22, 0.08);
  rudderShape.closePath();
  const rudderGeometry = new THREE.ExtrudeGeometry(rudderShape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.025,
    bevelThickness: 0.02,
    curveSegments: 8,
  });
  rudderGeometry.translate(0, 0, -0.06);
  rudderGeometry.rotateY(-Math.PI / 2);
  const rudder = makeMesh(rudderGeometry, materials.orange, 'rudder');
  controlSurfaces.rudder.add(rudder);
  root.add(controlSurfaces.rudder);

  const propeller = createPropeller(materials);
  root.add(propeller.pivot);

  const leftMainWheel = createWheel('left-main-wheel', MAIN_WHEEL_RADIUS, 0.3, materials);
  const rightMainWheel = createWheel('right-main-wheel', MAIN_WHEEL_RADIUS, 0.3, materials);
  leftMainWheel.position.set(-1.76, MAIN_WHEEL_RADIUS, 0.72);
  rightMainWheel.position.set(1.76, MAIN_WHEEL_RADIUS, 0.72);
  const tailWheel = createWheel('tail-wheel', TAIL_WHEEL_RADIUS, 0.15, materials);
  tailWheel.position.set(0, TAIL_WHEEL_RADIUS, -4.67);
  root.add(leftMainWheel, rightMainWheel, tailWheel);

  for (const side of [-1, 1] as const) {
    root.add(
      cylinderBetween(
        new THREE.Vector3(side * 0.55, 1.52, 0.48),
        new THREE.Vector3(side * 1.76, 0.58, 0.72),
        0.078,
        materials.white,
        `${side < 0 ? 'left' : 'right'}-main-gear-strut`,
        12,
      ),
      cylinderBetween(
        new THREE.Vector3(side * 0.22, 1.42, 0.08),
        new THREE.Vector3(side * 1.76, 0.58, 0.72),
        0.042,
        materials.metal,
        `${side < 0 ? 'left' : 'right'}-gear-brace`,
        10,
      ),
    );
  }
  const tailGearAnchor = new THREE.Vector3(0, 1.91, -4.2);
  const tailGearAxle = new THREE.Vector3(0, 0.27, -4.65);
  const tailGearMount = makeMesh(
    new THREE.SphereGeometry(0.105, 16, 10),
    materials.darkMetal,
    'embedded-tail-wheel-mount',
  );
  tailGearMount.position.copy(tailGearAnchor);
  tailGearMount.scale.set(0.72, 0.58, 1.08);
  root.add(
    tailGearMount,
    cylinderBetween(
      tailGearAnchor,
      tailGearAxle,
      0.047,
      materials.darkMetal,
      'tail-wheel-strut',
    ),
  );

  for (const side of [-1, 1] as const) {
    const exhaustCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.82, 2.04, 2.72),
      new THREE.Vector3(side * 0.98, 2.02, 2.65),
      new THREE.Vector3(side * 1.08, 1.94, 2.52),
      new THREE.Vector3(side * 1.12, 1.86, 2.35),
    ]);
    const exhaust = makeMesh(
      new THREE.TubeGeometry(exhaustCurve, 24, 0.105, 12, false),
      materials.metal,
      `${side < 0 ? 'left' : 'right'}-curved-exhaust-outlet`,
    );
    const exhaustMouth = makeMesh(
      new THREE.CylinderGeometry(0.085, 0.11, 0.055, 16),
      materials.darkMetal,
      `${side < 0 ? 'left' : 'right'}-exhaust-mouth`,
    );
    exhaustMouth.position.set(side * 1.125, 1.85, 2.34);
    exhaustMouth.rotation.z = Math.PI / 2;
    root.add(exhaust, exhaustMouth);
  }
  const exhaustSocket = new THREE.Object3D();
  exhaustSocket.name = 'exhaust-vfx-socket';
  exhaustSocket.position.set(-1.12, 1.86, 2.35);
  root.add(exhaustSocket);

  for (const side of [-1, 1] as const) {
    const boom = cylinderBetween(
      new THREE.Vector3(side * 0.72, 1.43, -0.54),
      new THREE.Vector3(side * 3.72, 1.43, -0.54),
      0.043,
      materials.metal,
      `${side < 0 ? 'left' : 'right'}-crop-spray-boom`,
      10,
    );
    root.add(boom);
    for (const x of [1.05, 1.78, 2.51, 3.24]) {
      const nozzleX = side * x;
      root.add(
        cylinderBetween(
          new THREE.Vector3(nozzleX, 1.43, -0.54),
          new THREE.Vector3(nozzleX, 1.08, -0.54),
          0.03,
          materials.white,
          `${side < 0 ? 'left' : 'right'}-spray-nozzle-drop-${x}`,
          8,
        ),
        cylinderBetween(
          new THREE.Vector3(nozzleX, 1.08, -0.54),
          new THREE.Vector3(nozzleX, 1.08, -0.7),
          0.025,
          materials.darkMetal,
          `${side < 0 ? 'left' : 'right'}-spray-nozzle-outlet-${x}`,
          8,
        ),
      );
    }
  }

  const shadowProxy = makeMesh(
    new THREE.CircleGeometry(3.1, 48),
    materials.shadow,
    'aircraft-contact-shadow-proxy',
    false,
  );
  shadowProxy.scale.set(1.35, 0.42, 1);
  shadowProxy.rotation.x = -Math.PI / 2;
  shadowProxy.position.set(0, 0.012, 0.05);
  shadowProxy.renderOrder = 1;
  root.add(shadowProxy);

  const castsHeroShadow = /fuselage|cowling|hopper|cockpit|cabin|main-wing|airfoil|aileron|tailplane|elevator|vertical-fin|rudder|propeller-blade|safety-tip|propeller-hub|main-wheel|tail-wheel|wing-brace|gear-strut|gear-brace/.test.bind(
    /fuselage|cowling|hopper|cockpit|cabin|main-wing|airfoil|aileron|tailplane|elevator|vertical-fin|rudder|propeller-blade|safety-tip|propeller-hub|main-wheel|tail-wheel|wing-brace|gear-strut|gear-brace/,
  );
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = castsHeroShadow(object.name);
  });

  const diagnostics = collectDiagnostics();
  const paintHighlight = new THREE.Color();
  const paintSheen = new THREE.Color();
  const paintWhite = new THREE.Color('#ffffff');

  const setPaintColor = (value: string): boolean => {
    const normalized = /^#[0-9a-f]{6}$/i.test(value.trim())
      ? value.trim().toLowerCase()
      : null;
    if (!normalized) return false;
    if (normalized === diagnostics.paint.selectedColor) return true;

    materials.orange.color.set(normalized);
    if (normalized === DEFAULT_AIRCRAFT_PAINT_COLOR) {
      materials.orangeLight.color.set(ORANGE_LIGHT);
      materials.orange.sheenColor.set(ORANGE_SHEEN);
    } else {
      paintHighlight.set(normalized).lerp(paintWhite, 0.18);
      paintSheen.set(normalized).lerp(paintWhite, 0.4);
      materials.orangeLight.color.copy(paintHighlight);
      materials.orange.sheenColor.copy(paintSheen);
    }

    diagnostics.paint.selectedColor = normalized;
    diagnostics.paint.revision += 1;
    return true;
  };
  let disposed = false;

  return {
    root,
    propellerPivot: propeller.pivot,
    propellerBlur: propeller.blur,
    mainWheelPivots: [leftMainWheel, rightMainWheel],
    tailWheelPivot: tailWheel,
    controlSurfaces,
    face: cockpit.face,
    sockets: {
      exhaust: exhaustSocket,
      leftWingtip,
      rightWingtip,
    },
    shadowProxy,
    groundOffset: 0,
    diagnostics,
    paint: {
      setColor: setPaintColor,
      getColor: () => diagnostics.paint.selectedColor,
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      const geometries = new Set<THREE.BufferGeometry>();
      const usedMaterials = new Set<THREE.Material>();
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) usedMaterials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of usedMaterials) material.dispose();
    },
  };
}
