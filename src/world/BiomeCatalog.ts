export const BIOME_IDS = [
  'sunlit-meadow',
  'sahara-dunes',
  'alpine-peaks',
  'arctic-tundra',
  'volcanic-wastes',
  'emerald-marsh',
  'red-rock-canyon',
  'autumn-forest',
  'tropical-lagoon',
  'crystal-salt-flats',
  'metropolitan-core',
  'azure-harbor',
  'ironworks-district',
  'sunstone-citadel',
] as const;

export type BiomeId = (typeof BIOME_IDS)[number];

export const CITY_BIOME_IDS = [
  'metropolitan-core',
  'azure-harbor',
  'ironworks-district',
  'sunstone-citadel',
] as const;

export type CityBiomeId = (typeof CITY_BIOME_IDS)[number];

export function isCityBiomeId(id: BiomeId): id is CityBiomeId {
  return (CITY_BIOME_IDS as readonly BiomeId[]).includes(id);
}

export type BiomeDefinition = Readonly<{
  id: BiomeId;
  label: string;
  groundColor: string;
  groundRoughness: number;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  rockColor: string;
  waterColor: string;
}>;

export const BIOME_CATALOG: readonly BiomeDefinition[] = [
  {
    id: 'sunlit-meadow',
    label: 'Sunlit Meadow',
    groundColor: '#4f843e',
    groundRoughness: 0.96,
    primaryColor: '#315f2f',
    secondaryColor: '#8eb952',
    accentColor: '#f1cf52',
    rockColor: '#777766',
    waterColor: '#4f93a6',
  },
  {
    id: 'sahara-dunes',
    label: 'Sahara Dunes',
    groundColor: '#c98c45',
    groundRoughness: 1,
    primaryColor: '#477342',
    secondaryColor: '#e8b85f',
    accentColor: '#d66b2d',
    rockColor: '#9f5d32',
    waterColor: '#4e9aab',
  },
  {
    id: 'alpine-peaks',
    label: 'Alpine Peaks',
    groundColor: '#788276',
    groundRoughness: 0.92,
    primaryColor: '#234b3f',
    secondaryColor: '#dbe1db',
    accentColor: '#c7d9e5',
    rockColor: '#5e6465',
    waterColor: '#538aa1',
  },
  {
    id: 'arctic-tundra',
    label: 'Arctic Tundra',
    groundColor: '#c8d6d5',
    groundRoughness: 0.76,
    primaryColor: '#78918e',
    secondaryColor: '#eaf2ef',
    accentColor: '#8bd4df',
    rockColor: '#78878b',
    waterColor: '#5e9fb4',
  },
  {
    id: 'volcanic-wastes',
    label: 'Volcanic Wastes',
    groundColor: '#292b2a',
    groundRoughness: 0.98,
    primaryColor: '#3b3b38',
    secondaryColor: '#646158',
    accentColor: '#f05b21',
    rockColor: '#151918',
    waterColor: '#f17a20',
  },
  {
    id: 'emerald-marsh',
    label: 'Emerald Marsh',
    groundColor: '#536a43',
    groundRoughness: 0.94,
    primaryColor: '#314d33',
    secondaryColor: '#809047',
    accentColor: '#b3c26a',
    rockColor: '#555d4e',
    waterColor: '#315f5c',
  },
  {
    id: 'red-rock-canyon',
    label: 'Red Rock Canyon',
    groundColor: '#a64f32',
    groundRoughness: 1,
    primaryColor: '#70402d',
    secondaryColor: '#d17b43',
    accentColor: '#e6aa58',
    rockColor: '#7d382a',
    waterColor: '#447a86',
  },
  {
    id: 'autumn-forest',
    label: 'Autumn Forest',
    groundColor: '#6f5535',
    groundRoughness: 0.98,
    primaryColor: '#8d3324',
    secondaryColor: '#d37b2d',
    accentColor: '#efb943',
    rockColor: '#665c50',
    waterColor: '#476f76',
  },
  {
    id: 'tropical-lagoon',
    label: 'Tropical Lagoon',
    groundColor: '#2f794d',
    groundRoughness: 0.91,
    primaryColor: '#1f6f4b',
    secondaryColor: '#62a949',
    accentColor: '#f0d85f',
    rockColor: '#6e7767',
    waterColor: '#28a7a4',
  },
  {
    id: 'crystal-salt-flats',
    label: 'Crystal Salt Flats',
    groundColor: '#d9d5c9',
    groundRoughness: 0.68,
    primaryColor: '#c0bbb0',
    secondaryColor: '#efeadb',
    accentColor: '#8fc7c9',
    rockColor: '#9a968f',
    waterColor: '#83b9bd',
  },
  {
    id: 'metropolitan-core',
    label: 'Metropolitan Core',
    groundColor: '#596963',
    groundRoughness: 0.82,
    primaryColor: '#5f7482',
    secondaryColor: '#b9c6c8',
    accentColor: '#55c7df',
    rockColor: '#39464c',
    waterColor: '#438da2',
  },
  {
    id: 'azure-harbor',
    label: 'Azure Harbor',
    groundColor: '#65766e',
    groundRoughness: 0.86,
    primaryColor: '#536d7a',
    secondaryColor: '#d0bea0',
    accentColor: '#e77d38',
    rockColor: '#465156',
    waterColor: '#287f98',
  },
  {
    id: 'ironworks-district',
    label: 'Ironworks District',
    groundColor: '#646057',
    groundRoughness: 0.93,
    primaryColor: '#6a6257',
    secondaryColor: '#aa987d',
    accentColor: '#e1a03d',
    rockColor: '#353b3d',
    waterColor: '#55757a',
  },
  {
    id: 'sunstone-citadel',
    label: 'Sunstone Citadel',
    groundColor: '#bd8b58',
    groundRoughness: 0.97,
    primaryColor: '#c76e3d',
    secondaryColor: '#efd09a',
    accentColor: '#3c9da1',
    rockColor: '#8e5139',
    waterColor: '#3e98a5',
  },
] as const;

export function hashChunkCoordinates(chunkX: number, chunkZ: number, seed = 0): number {
  let hash = Math.imul(chunkX | 0, 0x1f123bb5) ^ Math.imul(chunkZ | 0, 0x6c8e9cf5) ^ (seed | 0);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function selectBiomeForChunk(
  chunkX: number,
  chunkZ: number,
  seed = 0,
): BiomeDefinition {
  // Biomes are regions rather than a checkerboard of unrelated chunks. Each
  // low-frequency cell owns one jittered Voronoi site, so a biome naturally
  // spans several streamed chunks while remaining deterministic at any
  // positive or negative world coordinate.
  const regionSpan = 4;
  const regionX = Math.floor(chunkX / regionSpan);
  const regionZ = Math.floor(chunkZ / regionSpan);
  let closestDistance = Number.POSITIVE_INFINITY;
  let closestHash = 0;

  for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const cellX = regionX + offsetX;
      const cellZ = regionZ + offsetZ;
      const siteHash = hashChunkCoordinates(cellX, cellZ, seed ^ 0x3c6ef372);
      const jitterX = ((siteHash & 0xffff) / 0xffff - 0.5) * 0.72;
      const jitterZ = (((siteHash >>> 16) & 0xffff) / 0xffff - 0.5) * 0.72;
      const siteX = (cellX + 0.5 + jitterX) * regionSpan;
      const siteZ = (cellZ + 0.5 + jitterZ) * regionSpan;
      const deltaX = chunkX - siteX;
      const deltaZ = chunkZ - siteZ;
      const distance = deltaX * deltaX + deltaZ * deltaZ;

      if (distance < closestDistance) {
        closestDistance = distance;
        closestHash = hashChunkCoordinates(cellX, cellZ, seed ^ 0xa54ff53a);
      }
    }
  }

  return BIOME_CATALOG[closestHash % BIOME_CATALOG.length];
}
