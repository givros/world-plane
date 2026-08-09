import * as THREE from 'three';

export type AirportMaterialLibrary = {
  asphalt: THREE.MeshStandardMaterial;
  asphaltPatch: THREE.MeshStandardMaterial;
  asphaltSeam: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  runwayPaint: THREE.MeshStandardMaterial;
  taxiPaint: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  grassLight: THREE.MeshStandardMaterial;
  grassDark: THREE.MeshStandardMaterial;
  dryField: THREE.MeshStandardMaterial;
  earth: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  foliageLight: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  hangarWall: THREE.MeshStandardMaterial;
  hangarAccent: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  roofLight: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  galvanizedMetal: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  wood: THREE.MeshStandardMaterial;
  fabricRed: THREE.MeshStandardMaterial;
  fabricWhite: THREE.MeshStandardMaterial;
  hay: THREE.MeshStandardMaterial;
  mountainNear: THREE.MeshStandardMaterial;
  mountainMiddle: THREE.MeshStandardMaterial;
  mountainFar: THREE.MeshStandardMaterial;
  cloud: THREE.MeshStandardMaterial;
  edgeLight: THREE.MeshStandardMaterial;
  thresholdGreen: THREE.MeshStandardMaterial;
  thresholdRed: THREE.MeshStandardMaterial;
  warningAmber: THREE.MeshStandardMaterial;
  dispose: () => void;
};

type Rgb = readonly [number, number, number];

function createNoiseTexture(
  size: number,
  base: Rgb,
  variation: number,
  seed: number,
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  let state = seed >>> 0;

  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const fine = random() * 2 - 1;
      const broad = Math.sin(x * 0.19 + y * 0.07) * 0.32 + Math.sin(y * 0.13) * 0.22;
      const grain = (fine * 0.7 + broad) * variation;

      data[index] = THREE.MathUtils.clamp(Math.round(base[0] + grain), 0, 255);
      data[index + 1] = THREE.MathUtils.clamp(Math.round(base[1] + grain), 0, 255);
      data[index + 2] = THREE.MathUtils.clamp(Math.round(base[2] + grain), 0, 255);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = `procedural-noise-${seed}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function standard(
  name: string,
  parameters: THREE.MeshStandardMaterialParameters,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial(parameters);
  material.name = name;
  return material;
}

export function createAirportMaterialLibrary(): AirportMaterialLibrary {
  const asphaltTexture = createNoiseTexture(128, [73, 78, 82], 24, 0xa17f4d2b);
  asphaltTexture.repeat.set(8, 96);

  const concreteTexture = createNoiseTexture(96, [164, 160, 147], 18, 0x4518dc23);
  concreteTexture.repeat.set(5, 20);

  const grassTexture = createNoiseTexture(128, [94, 126, 64], 38, 0x8215fa61);
  grassTexture.repeat.set(44, 44);

  const roofTexture = createNoiseTexture(64, [102, 115, 118], 16, 0xe15076a3);
  roofTexture.repeat.set(7, 4);

  const asphalt = standard('runway-asphalt', {
    color: '#767b7e',
    map: asphaltTexture,
    roughness: 0.91,
    metalness: 0.01,
  });
  const concrete = standard('airport-concrete', {
    color: '#b2ad9e',
    map: concreteTexture,
    roughness: 0.88,
    metalness: 0.01,
  });
  const grass = standard('airfield-grass', {
    color: '#86a95e',
    map: grassTexture,
    roughness: 0.97,
    metalness: 0,
  });
  const roof = standard('weathered-roof', {
    color: '#7a8a8d',
    map: roofTexture,
    roughness: 0.66,
    metalness: 0.35,
  });

  const materials = {
    asphalt,
    asphaltPatch: standard('runway-repair-patch', {
      color: '#343a3d',
      roughness: 0.98,
      metalness: 0,
    }),
    asphaltSeam: standard('runway-seams-and-rubber', {
      color: '#252b2d',
      roughness: 0.96,
      metalness: 0,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    }),
    concrete,
    runwayPaint: standard('runway-white-paint', {
      color: '#f3f0dc',
      roughness: 0.72,
      metalness: 0,
    }),
    taxiPaint: standard('taxiway-yellow-paint', {
      color: '#f4c646',
      roughness: 0.68,
      metalness: 0,
    }),
    grass,
    grassLight: standard('field-light-green', {
      color: '#a8bb72',
      roughness: 1,
      metalness: 0,
    }),
    grassDark: standard('field-deep-green', {
      color: '#547a48',
      roughness: 1,
      metalness: 0,
    }),
    dryField: standard('field-harvest-ochre', {
      color: '#c2a466',
      roughness: 1,
      metalness: 0,
    }),
    earth: standard('field-earth', {
      color: '#765d43',
      roughness: 1,
      metalness: 0,
    }),
    foliage: standard('tree-foliage', {
      color: '#426f49',
      roughness: 0.94,
      metalness: 0,
      flatShading: true,
    }),
    foliageLight: standard('tree-foliage-sunlit', {
      color: '#6f9453',
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
    }),
    trunk: standard('tree-trunk', {
      color: '#594433',
      roughness: 1,
      metalness: 0,
      flatShading: true,
    }),
    rock: standard('airfield-rock', {
      color: '#74756c',
      roughness: 0.96,
      metalness: 0,
      flatShading: true,
    }),
    hangarWall: standard('hangar-warm-wall', {
      color: '#d8d1bc',
      roughness: 0.73,
      metalness: 0.08,
    }),
    hangarAccent: standard('hangar-orange-accent', {
      color: '#d76d29',
      roughness: 0.54,
      metalness: 0.14,
    }),
    roof,
    roofLight: standard('hangar-roof-highlight', {
      color: '#aab8b7',
      roughness: 0.62,
      metalness: 0.28,
    }),
    darkMetal: standard('airport-dark-metal', {
      color: '#2e3638',
      roughness: 0.46,
      metalness: 0.66,
    }),
    galvanizedMetal: standard('airport-galvanized-metal', {
      color: '#9aa6a6',
      roughness: 0.45,
      metalness: 0.72,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      name: 'airport-window-glass',
      color: '#80b7bf',
      roughness: 0.15,
      metalness: 0.05,
      transmission: 0.16,
      transparent: true,
      opacity: 0.76,
      clearcoat: 0.8,
      clearcoatRoughness: 0.18,
    }),
    wood: standard('farm-wood', {
      color: '#7f5437',
      roughness: 0.9,
      metalness: 0,
    }),
    fabricRed: standard('windsock-red', {
      color: '#d94432',
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    fabricWhite: standard('windsock-white', {
      color: '#f4ead4',
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    hay: standard('hay-bale', {
      color: '#c99a47',
      roughness: 1,
      metalness: 0,
      flatShading: true,
    }),
    mountainNear: standard('terrain-near-ridge', {
      color: '#769278',
      roughness: 1,
      metalness: 0,
      flatShading: false,
    }),
    mountainMiddle: standard('terrain-middle-ridge', {
      color: '#8aa29b',
      roughness: 1,
      metalness: 0,
      flatShading: false,
    }),
    mountainFar: standard('terrain-far-ridge', {
      color: '#a7b8bb',
      roughness: 1,
      metalness: 0,
      flatShading: false,
    }),
    cloud: standard('soft-cloud', {
      color: '#fff9e9',
      roughness: 0.98,
      metalness: 0,
      emissive: '#a9c5d2',
      emissiveIntensity: 0.58,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    }),
    edgeLight: standard('runway-edge-light', {
      color: '#d9eef0',
      roughness: 0.24,
      metalness: 0.05,
      emissive: '#bfeff4',
      emissiveIntensity: 2.35,
    }),
    thresholdGreen: standard('runway-threshold-green', {
      color: '#86f2b0',
      roughness: 0.22,
      emissive: '#29c867',
      emissiveIntensity: 2.8,
    }),
    thresholdRed: standard('runway-end-red', {
      color: '#ff7a61',
      roughness: 0.22,
      emissive: '#e33b27',
      emissiveIntensity: 2.9,
    }),
    warningAmber: standard('airport-warning-amber', {
      color: '#ffd173',
      roughness: 0.25,
      emissive: '#f2a820',
      emissiveIntensity: 2.4,
    }),
  };

  const allMaterials: THREE.Material[] = Object.values(materials);
  const textures = [asphaltTexture, concreteTexture, grassTexture, roofTexture];

  return {
    ...materials,
    dispose: () => {
      for (const material of allMaterials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
