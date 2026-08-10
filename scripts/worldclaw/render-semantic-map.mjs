#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { createServer } from 'vite';

const SEGMENTS = 40;
const SAMPLES = 41;
const SAMPLE_COUNT = SAMPLES * SAMPLES;
const CHUNK_SIZE = 1280;
const CELL_SIZE = CHUNK_SIZE / SEGMENTS;
const HALF_CHUNK = CHUNK_SIZE * 0.5;
const WINDOW_CHUNKS = 3;
const WINDOW_PIXELS = SEGMENTS * WINDOW_CHUNKS;
const CORRIDOR_LENGTH = 160;
const CORRIDOR_WIDTH = 30;
const CORRIDOR_HALF_LENGTH = CORRIDOR_LENGTH * 0.5;
const CORRIDOR_HALF_WIDTH = CORRIDOR_WIDTH * 0.5;
const CORRIDOR_EDGE_MARGIN = 96;
const CORRIDOR_MAX_SLOPE_DEGREES = 4;
const CORRIDOR_HEADINGS = [0, 45, 90, 135];
const CONTACT_PANEL_SIZE = 320;

export const SEMANTIC_REVIEW_IMAGE_DIMENSIONS = Object.freeze({
  'semantic-window.png': [WINDOW_PIXELS, WINDOW_PIXELS],
  'terrain-height.png': [SEGMENTS, SEGMENTS],
  'slope-landability.png': [SEGMENTS, SEGMENTS],
  'placements.png': [SEGMENTS, SEGMENTS],
  'composite.png': [SEGMENTS, SEGMENTS],
  'contact-sheet.png': [CONTACT_PANEL_SIZE * 3, CONTACT_PANEL_SIZE * 2],
});

const UNIT_FOOTPRINT_RADIUS = Object.freeze({
  'proto-biome-trunk': 0.72,
  'proto-biome-canopy': 1.22,
  'proto-biome-conifer': 0.72,
  'proto-biome-frond': 1.48,
  'proto-biome-ground-cover': 0.3,
  'proto-biome-reed': 0.34,
  'proto-biome-cactus': 0.62,
  'proto-biome-deadwood': 0.56,
  'proto-biome-rock': 1,
  'proto-biome-mesa': 1,
  'proto-biome-crystal': 0.5,
  'proto-biome-snow': 1,
  'proto-biome-water': 1,
  'proto-biome-glow': 1,
});

const PLACEMENT_COLORS = Object.freeze([
  [255, 214, 64, 255],
  [242, 112, 89, 255],
  [94, 213, 178, 255],
  [123, 169, 255, 255],
  [224, 132, 255, 255],
  [255, 164, 77, 255],
]);

function usage() {
  return [
    'Usage: node scripts/worldclaw/render-semantic-map.mjs --descriptor FILE [options]',
    '',
    'Options:',
    '  --region-graph FILE    Defaults to data/world/region_graph.json',
    '  --asset-registry FILE  Defaults to data/world/asset_registry.json',
    '  --manifest FILE        Optional compiled manifest',
    '  --root DIR             Repository root (defaults to current directory)',
    '  --out DIR              Output directory (defaults below output/worldclaw)',
    '  -h, --help             Show this help',
  ].join('\n');
}

function parseArguments(argv) {
  const parsed = {
    root: process.cwd(),
    descriptor: null,
    regionGraph: 'data/world/region_graph.json',
    assetRegistry: 'data/world/asset_registry.json',
    manifest: null,
    out: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') return { help: true };
    if (!argument.startsWith('--')) throw new Error(`Unexpected positional argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    index += 1;
    if (argument === '--root') parsed.root = value;
    else if (argument === '--descriptor') parsed.descriptor = value;
    else if (argument === '--region-graph') parsed.regionGraph = value;
    else if (argument === '--asset-registry') parsed.assetRegistry = value;
    else if (argument === '--manifest') parsed.manifest = value;
    else if (argument === '--out') parsed.out = value;
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (!parsed.descriptor) throw new Error('--descriptor is required.');
  return parsed;
}

function resolveFromRoot(root, value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
}

async function readJson(filePath, label) {
  let contents;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} at ${filePath}: ${error.message}`);
  }
}

function assertFiniteArray(value, length, label) {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${label} must contain exactly ${length} values.`);
  }
  value.forEach((item, index) => {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      throw new Error(`${label}[${index}] must be finite.`);
    }
  });
}

function validateReadyDescriptor(descriptor) {
  const prefix = `Descriptor ${descriptor?.descriptorId ?? '<unknown>'} is not review-ready`;
  if (descriptor?.runtimeRecordStatus !== 'ready') {
    throw new Error(`${prefix}: runtimeRecordStatus must be "ready".`);
  }
  if (!descriptor.runtimeRecord || typeof descriptor.runtimeRecord !== 'object') {
    throw new Error(`${prefix}: runtimeRecord is required.`);
  }
  if (descriptor.terrain?.segmentsPerSide !== SEGMENTS || descriptor.terrain?.samplesPerSide !== SAMPLES) {
    throw new Error(`${prefix}: terrain must use 40 segments and 41 samples per side.`);
  }
  assertFiniteArray(descriptor.runtimeRecord.heightSamples, SAMPLE_COUNT, `${prefix}: runtimeRecord.heightSamples`);
  if (!Array.isArray(descriptor.prototypeBatches)) {
    throw new Error(`${prefix}: prototypeBatches must be an array.`);
  }
  const [chunkX, chunkZ] = descriptor.chunk?.coordinates ?? [];
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkZ)) {
    throw new Error(`${prefix}: chunk.coordinates must contain two integers.`);
  }
  if (
    descriptor.runtimeRecord.chunkX !== chunkX
    || descriptor.runtimeRecord.chunkZ !== chunkZ
  ) {
    throw new Error(`${prefix}: runtimeRecord coordinates do not match chunk.coordinates.`);
  }
  return { chunkX, chunkZ };
}

function createPng(width, height, fill = [0, 0, 0, 0]) {
  const png = new PNG({ width, height, colorType: 6 });
  for (let offset = 0; offset < png.data.length; offset += 4) {
    png.data[offset] = fill[0];
    png.data[offset + 1] = fill[1];
    png.data[offset + 2] = fill[2];
    png.data[offset + 3] = fill[3];
  }
  return png;
}

function setPixel(png, x, y, color) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const offset = (y * png.width + x) * 4;
  png.data[offset] = color[0];
  png.data[offset + 1] = color[1];
  png.data[offset + 2] = color[2];
  png.data[offset + 3] = color[3] ?? 255;
}

function getPixel(png, x, y) {
  const offset = (y * png.width + x) * 4;
  return [
    png.data[offset],
    png.data[offset + 1],
    png.data[offset + 2],
    png.data[offset + 3],
  ];
}

function blend(first, second, amount) {
  const t = Math.max(0, Math.min(1, amount));
  return [
    Math.round(first[0] + (second[0] - first[0]) * t),
    Math.round(first[1] + (second[1] - first[1]) * t),
    Math.round(first[2] + (second[2] - first[2]) * t),
    Math.round((first[3] ?? 255) + ((second[3] ?? 255) - (first[3] ?? 255)) * t),
  ];
}

function hexColor(value, label) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${label} must be a six-digit sRGB hex color.`);
  }
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    255,
  ];
}

function stableColorIndex(value) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % PLACEMENT_COLORS.length;
}

function sampleIndex(x, z) {
  return z * SAMPLES + x;
}

function terrainCell(heightSamples, cellX, cellZ) {
  const h00 = heightSamples[sampleIndex(cellX, cellZ)];
  const h10 = heightSamples[sampleIndex(cellX + 1, cellZ)];
  const h01 = heightSamples[sampleIndex(cellX, cellZ + 1)];
  const h11 = heightSamples[sampleIndex(cellX + 1, cellZ + 1)];
  const slopeA = Math.atan(Math.hypot((h10 - h00) / CELL_SIZE, (h01 - h00) / CELL_SIZE)) * 180 / Math.PI;
  const slopeB = Math.atan(Math.hypot((h11 - h01) / CELL_SIZE, (h11 - h10) / CELL_SIZE)) * 180 / Math.PI;
  return {
    h00,
    h10,
    h01,
    h11,
    centerHeight: Math.fround(h00 + (h10 - h00) * 0.5 + (h01 - h00) * 0.5),
    slopeA,
    slopeB,
    maximumSlopeDegrees: Math.max(slopeA, slopeB),
  };
}

function sampleTerrainAt(heightSamples, localX, localZ) {
  const gridX = Math.max(0, Math.min(SEGMENTS - Number.EPSILON, (localX + HALF_CHUNK) / CELL_SIZE));
  const gridZ = Math.max(0, Math.min(SEGMENTS - Number.EPSILON, (localZ + HALF_CHUNK) / CELL_SIZE));
  const cellX = Math.min(SEGMENTS - 1, Math.floor(gridX));
  const cellZ = Math.min(SEGMENTS - 1, Math.floor(gridZ));
  const fractionX = gridX - cellX;
  const fractionZ = gridZ - cellZ;
  const cell = terrainCell(heightSamples, cellX, cellZ);
  if (fractionX + fractionZ <= 1) {
    return {
      height: cell.h00 + (cell.h10 - cell.h00) * fractionX + (cell.h01 - cell.h00) * fractionZ,
      slopeDegrees: cell.slopeA,
    };
  }
  return {
    height: cell.h11
      + (cell.h01 - cell.h11) * (1 - fractionX)
      + (cell.h10 - cell.h11) * (1 - fractionZ),
    slopeDegrees: cell.slopeB,
  };
}

function buildTerrainGrid(heightSamples) {
  const cells = [];
  let minimumHeight = Number.POSITIVE_INFINITY;
  let maximumHeight = Number.NEGATIVE_INFINITY;
  let maximumSlopeDegrees = 0;
  let cellsAtOrBelowFourDegrees = 0;
  let cellsAtOrBelowEightDegrees = 0;
  for (let cellZ = 0; cellZ < SEGMENTS; cellZ += 1) {
    const row = [];
    for (let cellX = 0; cellX < SEGMENTS; cellX += 1) {
      const cell = terrainCell(heightSamples, cellX, cellZ);
      row.push(cell);
      minimumHeight = Math.min(minimumHeight, cell.h00, cell.h10, cell.h01, cell.h11);
      maximumHeight = Math.max(maximumHeight, cell.h00, cell.h10, cell.h01, cell.h11);
      maximumSlopeDegrees = Math.max(maximumSlopeDegrees, cell.maximumSlopeDegrees);
      if (cell.maximumSlopeDegrees <= 4) cellsAtOrBelowFourDegrees += 1;
      if (cell.maximumSlopeDegrees <= 8) cellsAtOrBelowEightDegrees += 1;
    }
    cells.push(row);
  }
  return {
    cells,
    minimumHeight,
    maximumHeight,
    maximumSlopeDegrees,
    cellsAtOrBelowFourDegrees,
    cellsAtOrBelowEightDegrees,
  };
}

function footprintRadius(assetId, scale) {
  if (assetId === 'existing-urban-box-pool' || assetId === 'existing-urban-roof-pool') {
    return Math.hypot(scale[0] * 0.5, scale[2] * 0.5);
  }
  const unitRadius = UNIT_FOOTPRINT_RADIUS[assetId] ?? 1;
  return unitRadius * Math.max(scale[0], scale[2]);
}

function collectPlacements(descriptor, assetRegistry) {
  const assets = new Map(assetRegistry.assets.map((asset) => [asset.id, asset]));
  const placements = [];
  const countsByAsset = {};
  for (const batch of descriptor.prototypeBatches) {
    if (!assets.has(batch.assetId)) {
      throw new Error(`Prototype batch references unknown asset ${batch.assetId}.`);
    }
    if (!Array.isArray(batch.transforms)) {
      throw new Error(`Prototype batch ${batch.assetId} must contain a transforms array.`);
    }
    for (let index = 0; index < batch.transforms.length; index += 1) {
      const transform = batch.transforms[index];
      assertFiniteArray(transform.translation, 3, `${batch.assetId}.transforms[${index}].translation`);
      assertFiniteArray(transform.rotation, 4, `${batch.assetId}.transforms[${index}].rotation`);
      assertFiniteArray(transform.scale, 3, `${batch.assetId}.transforms[${index}].scale`);
      assertFiniteArray(transform.colorLinearRgb, 3, `${batch.assetId}.transforms[${index}].colorLinearRgb`);
      if (transform.scale.some((value) => value <= 0)) {
        throw new Error(`${batch.assetId}.transforms[${index}].scale must be positive.`);
      }
      const [x, , z] = transform.translation;
      if (Math.abs(x) > HALF_CHUNK || Math.abs(z) > HALF_CHUNK) {
        throw new Error(`${batch.assetId}.transforms[${index}] lies outside chunk-local X/Z bounds.`);
      }
      placements.push({
        assetId: batch.assetId,
        assetClass: assets.get(batch.assetId).classification,
        x,
        z,
        radius: footprintRadius(batch.assetId, transform.scale),
      });
    }
    countsByAsset[batch.assetId] = (countsByAsset[batch.assetId] ?? 0) + batch.transforms.length;
  }
  placements.sort((left, right) => (
    left.assetId.localeCompare(right.assetId)
    || left.x - right.x
    || left.z - right.z
  ));
  return { placements, countsByAsset };
}

function pointToCorridorClearance(point, candidate) {
  const deltaX = point.x - candidate.centerLocal[0];
  const deltaZ = point.z - candidate.centerLocal[1];
  const longitudinal = deltaX * candidate.cosine + deltaZ * candidate.sine;
  const lateral = -deltaX * candidate.sine + deltaZ * candidate.cosine;
  const outsideLongitudinal = Math.max(Math.abs(longitudinal) - CORRIDOR_HALF_LENGTH, 0);
  const outsideLateral = Math.max(Math.abs(lateral) - CORRIDOR_HALF_WIDTH, 0);
  return Math.hypot(outsideLongitudinal, outsideLateral) - point.radius;
}

function corridorContainsPoint(localX, localZ, corridor) {
  if (!corridor || corridor.status !== 'found') return false;
  const radians = corridor.headingDegreesFromPositiveX * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const deltaX = localX - corridor.centerLocalXZ[0];
  const deltaZ = localZ - corridor.centerLocalXZ[1];
  const longitudinal = deltaX * cosine + deltaZ * sine;
  const lateral = -deltaX * sine + deltaZ * cosine;
  return Math.abs(longitudinal) <= CORRIDOR_HALF_LENGTH
    && Math.abs(lateral) <= CORRIDOR_HALF_WIDTH;
}

function corridorSampleOffsets() {
  const offsets = [];
  for (let longitudinal = -CORRIDOR_HALF_LENGTH; longitudinal <= CORRIDOR_HALF_LENGTH; longitudinal += CELL_SIZE * 0.5) {
    for (const lateral of [-CORRIDOR_HALF_WIDTH, 0, CORRIDOR_HALF_WIDTH]) {
      offsets.push([longitudinal, lateral]);
    }
  }
  if (offsets.at(-1)?.[0] !== CORRIDOR_HALF_LENGTH) {
    for (const lateral of [-CORRIDOR_HALF_WIDTH, 0, CORRIDOR_HALF_WIDTH]) {
      offsets.push([CORRIDOR_HALF_LENGTH, lateral]);
    }
  }
  return offsets;
}

function selectLandingCorridor(heightSamples, placements) {
  const samples = corridorSampleOffsets();
  const candidates = [];
  for (const headingDegrees of CORRIDOR_HEADINGS) {
    const radians = headingDegrees * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const extentX = Math.abs(cosine) * CORRIDOR_HALF_LENGTH + Math.abs(sine) * CORRIDOR_HALF_WIDTH;
    const extentZ = Math.abs(sine) * CORRIDOR_HALF_LENGTH + Math.abs(cosine) * CORRIDOR_HALF_WIDTH;
    for (let cellZ = 0; cellZ < SEGMENTS; cellZ += 1) {
      const centerZ = -HALF_CHUNK + (cellZ + 0.5) * CELL_SIZE;
      for (let cellX = 0; cellX < SEGMENTS; cellX += 1) {
        const centerX = -HALF_CHUNK + (cellX + 0.5) * CELL_SIZE;
        const edgeMargin = Math.min(
          HALF_CHUNK - (Math.abs(centerX) + extentX),
          HALF_CHUNK - (Math.abs(centerZ) + extentZ),
        );
        if (edgeMargin + 1e-9 < CORRIDOR_EDGE_MARGIN) continue;
        let maximumSlope = 0;
        let minimumHeight = Number.POSITIVE_INFINITY;
        let maximumHeight = Number.NEGATIVE_INFINITY;
        let slopeAllowed = true;
        for (const [longitudinal, lateral] of samples) {
          const sampleX = centerX + longitudinal * cosine - lateral * sine;
          const sampleZ = centerZ + longitudinal * sine + lateral * cosine;
          const terrain = sampleTerrainAt(heightSamples, sampleX, sampleZ);
          maximumSlope = Math.max(maximumSlope, terrain.slopeDegrees);
          minimumHeight = Math.min(minimumHeight, terrain.height);
          maximumHeight = Math.max(maximumHeight, terrain.height);
          if (maximumSlope > CORRIDOR_MAX_SLOPE_DEGREES + 1e-9) {
            slopeAllowed = false;
            break;
          }
        }
        if (!slopeAllowed) continue;
        const candidate = {
          centerLocal: [centerX, centerZ],
          headingDegrees,
          cosine,
          sine,
        };
        let minimumPlacementClearance = Number.POSITIVE_INFINITY;
        let placementsAllowed = true;
        for (const placement of placements) {
          const clearance = pointToCorridorClearance(placement, candidate);
          minimumPlacementClearance = Math.min(minimumPlacementClearance, clearance);
          if (clearance < -1e-9) {
            placementsAllowed = false;
            break;
          }
        }
        if (!placementsAllowed) continue;
        candidates.push({
          ...candidate,
          edgeMargin,
          maximumSlope,
          minimumHeight,
          maximumHeight,
          minimumPlacementClearance,
        });
      }
    }
  }
  candidates.sort((left, right) => (
    left.maximumSlope - right.maximumSlope
    || right.minimumPlacementClearance - left.minimumPlacementClearance
    || Math.hypot(...left.centerLocal) - Math.hypot(...right.centerLocal)
    || left.headingDegrees - right.headingDegrees
    || left.centerLocal[1] - right.centerLocal[1]
    || left.centerLocal[0] - right.centerLocal[0]
  ));
  const selected = candidates[0];
  if (!selected) {
    return {
      status: 'not-found',
      reviewOnly: true,
      lengthMeters: CORRIDOR_LENGTH,
      widthMeters: CORRIDOR_WIDTH,
      requiredEdgeMarginMeters: CORRIDOR_EDGE_MARGIN,
      maximumSlopeDegreesAllowed: CORRIDOR_MAX_SLOPE_DEGREES,
      testedHeadingsDegreesFromPositiveX: CORRIDOR_HEADINGS,
      candidateCount: 0,
    };
  }
  return {
    status: 'found',
    reviewOnly: true,
    centerLocalXZ: selected.centerLocal,
    headingDegreesFromPositiveX: selected.headingDegrees,
    lengthMeters: CORRIDOR_LENGTH,
    widthMeters: CORRIDOR_WIDTH,
    edgeMarginMeters: selected.edgeMargin,
    maximumSlopeDegrees: selected.maximumSlope,
    heightRangeMeters: [selected.minimumHeight, selected.maximumHeight],
    minimumPlacementFootprintClearanceMeters: Number.isFinite(selected.minimumPlacementClearance)
      ? selected.minimumPlacementClearance
      : null,
    requiredEdgeMarginMeters: CORRIDOR_EDGE_MARGIN,
    maximumSlopeDegreesAllowed: CORRIDOR_MAX_SLOPE_DEGREES,
    testedHeadingsDegreesFromPositiveX: CORRIDOR_HEADINGS,
    candidateCount: candidates.length,
  };
}

function heightColor(normalized) {
  const low = [43, 86, 78, 255];
  const middle = [124, 157, 91, 255];
  const high = [225, 215, 177, 255];
  return normalized <= 0.5
    ? blend(low, middle, normalized * 2)
    : blend(middle, high, (normalized - 0.5) * 2);
}

function slopeColor(slope) {
  if (slope <= 4) return [67, 173, 102, 255];
  if (slope <= 8) return [224, 194, 71, 255];
  if (slope <= 18) return [230, 129, 54, 255];
  return [188, 62, 59, 255];
}

function renderTerrainImages(terrainGrid, regionColor, placements, landingCorridor) {
  const height = createPng(SEGMENTS, SEGMENTS);
  const slope = createPng(SEGMENTS, SEGMENTS);
  const placement = createPng(SEGMENTS, SEGMENTS, [14, 21, 26, 255]);
  const composite = createPng(SEGMENTS, SEGMENTS);
  const range = Math.max(1e-9, terrainGrid.maximumHeight - terrainGrid.minimumHeight);
  for (let z = 0; z < SEGMENTS; z += 1) {
    for (let x = 0; x < SEGMENTS; x += 1) {
      const cell = terrainGrid.cells[z][x];
      const normalized = (cell.centerHeight - terrainGrid.minimumHeight) / range;
      const localX = -HALF_CHUNK + (x + 0.5) * CELL_SIZE;
      const localZ = -HALF_CHUNK + (z + 0.5) * CELL_SIZE;
      setPixel(height, x, z, heightColor(normalized));
      setPixel(slope, x, z, slopeColor(cell.maximumSlopeDegrees));
      const modulatedRegion = regionColor.map((component, index) => (
        index === 3 ? 255 : Math.max(0, Math.min(255, Math.round(component * (0.72 + normalized * 0.3))))
      ));
      const slopeOverlay = cell.maximumSlopeDegrees <= 4
        ? modulatedRegion
        : blend(modulatedRegion, slopeColor(cell.maximumSlopeDegrees), 0.36);
      setPixel(composite, x, z, slopeOverlay);
      if (corridorContainsPoint(localX, localZ, landingCorridor)) {
        setPixel(placement, x, z, [30, 102, 123, 255]);
        setPixel(composite, x, z, blend(getPixel(composite, x, z), [72, 221, 234, 255], 0.48));
      }
    }
  }
  for (const item of placements) {
    const x = Math.max(0, Math.min(SEGMENTS - 1, Math.floor((item.x + HALF_CHUNK) / CELL_SIZE)));
    const z = Math.max(0, Math.min(SEGMENTS - 1, Math.floor((item.z + HALF_CHUNK) / CELL_SIZE)));
    const color = PLACEMENT_COLORS[stableColorIndex(item.assetId)];
    setPixel(placement, x, z, color);
    setPixel(composite, x, z, color);
  }
  return { height, slope, placement, composite };
}

function renderSemanticWindow(windowChunks) {
  const png = createPng(WINDOW_PIXELS, WINDOW_PIXELS);
  for (const chunk of windowChunks) {
    const offsetX = (chunk.windowX + 1) * SEGMENTS;
    const offsetZ = (chunk.windowZ + 1) * SEGMENTS;
    for (let z = 0; z < SEGMENTS; z += 1) {
      for (let x = 0; x < SEGMENTS; x += 1) {
        setPixel(png, offsetX + x, offsetZ + z, chunk.color);
      }
    }
  }
  return png;
}

function scaleNearest(source, target, offsetX, offsetY, width, height) {
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor(y / height * source.height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor(x / width * source.width));
      setPixel(target, offsetX + x, offsetY + y, getPixel(source, sourceX, sourceY));
    }
  }
}

function renderContactSheet(images) {
  const sheet = createPng(CONTACT_PANEL_SIZE * 3, CONTACT_PANEL_SIZE * 2, [20, 25, 30, 255]);
  const ordered = [images.semanticWindow, images.height, images.slope, images.placement, images.composite];
  ordered.forEach((image, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    scaleNearest(
      image,
      sheet,
      column * CONTACT_PANEL_SIZE,
      row * CONTACT_PANEL_SIZE,
      CONTACT_PANEL_SIZE,
      CONTACT_PANEL_SIZE,
    );
  });
  const swatches = [
    [67, 173, 102, 255],
    [224, 194, 71, 255],
    [230, 129, 54, 255],
    [188, 62, 59, 255],
    [72, 221, 234, 255],
  ];
  swatches.forEach((color, index) => {
    const startX = CONTACT_PANEL_SIZE * 2 + 32 + index * 52;
    for (let y = CONTACT_PANEL_SIZE + 116; y < CONTACT_PANEL_SIZE + 204; y += 1) {
      for (let x = startX; x < startX + 38; x += 1) setPixel(sheet, x, y, color);
    }
  });
  return sheet;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function relativeInputIdentity(root, filePath) {
  const relative = path.relative(root, filePath).split(path.sep).join('/');
  return relative.startsWith('../') ? path.basename(filePath) : relative;
}

async function loadBiomeCatalog(root) {
  const server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  try {
    const catalog = await server.ssrLoadModule('/src/world/BiomeCatalog.ts');
    if (typeof catalog.selectBiomeForChunk !== 'function' || !Array.isArray(catalog.BIOME_CATALOG)) {
      throw new Error('BiomeCatalog SSR module does not expose the expected selector and catalog.');
    }
    return {
      selectBiomeForChunk: catalog.selectBiomeForChunk,
      biomeCatalog: catalog.BIOME_CATALOG,
    };
  } finally {
    await server.close();
  }
}

async function writePng(outDirectory, name, png) {
  const buffer = PNG.sync.write(png, { colorType: 6, inputColorType: 6 });
  await writeFile(path.join(outDirectory, name), buffer);
  return { name, width: png.width, height: png.height, sha256: sha256(buffer) };
}

export async function renderSemanticReview(options) {
  const root = path.resolve(options.root ?? process.cwd());
  if (!options.descriptor) throw new Error('A descriptor path is required.');
  const descriptorPath = resolveFromRoot(root, options.descriptor);
  const regionGraphPath = resolveFromRoot(root, options.regionGraph ?? 'data/world/region_graph.json');
  const assetRegistryPath = resolveFromRoot(root, options.assetRegistry ?? 'data/world/asset_registry.json');
  const manifestPath = options.manifest ? resolveFromRoot(root, options.manifest) : null;
  const [descriptor, regionGraph, assetRegistry, manifest] = await Promise.all([
    readJson(descriptorPath, 'chunk descriptor'),
    readJson(regionGraphPath, 'region graph'),
    readJson(assetRegistryPath, 'asset registry'),
    manifestPath ? readJson(manifestPath, 'compiled manifest') : Promise.resolve(null),
  ]);
  const { chunkX, chunkZ } = validateReadyDescriptor(descriptor);
  const outDirectory = resolveFromRoot(
    root,
    options.out ?? `output/worldclaw/semantic-review/${descriptor.descriptorId}`,
  );
  const regionByRuntimeBiome = new Map();
  const regionById = new Map();
  for (const region of regionGraph.regions ?? []) {
    regionById.set(region.id, region);
    if (region.runtimeBiomeId) regionByRuntimeBiome.set(region.runtimeBiomeId, region);
  }
  const descriptorRegion = regionById.get(descriptor.regionId);
  if (!descriptorRegion) throw new Error(`Descriptor references unknown region ${descriptor.regionId}.`);
  const regionColor = hexColor(descriptorRegion.semanticColor, `${descriptor.regionId}.semanticColor`);
  const { selectBiomeForChunk, biomeCatalog } = await loadBiomeCatalog(root);
  const worldSeed = descriptor.runtimeRecord.worldSeed;
  const windowChunks = [];
  for (let windowZ = -1; windowZ <= 1; windowZ += 1) {
    for (let windowX = -1; windowX <= 1; windowX += 1) {
      const currentX = chunkX + windowX;
      const currentZ = chunkZ + windowZ;
      const selectedBiome = currentX === 0 && currentZ === 0
        ? biomeCatalog[0]
        : selectBiomeForChunk(currentX, currentZ, worldSeed);
      const region = regionByRuntimeBiome.get(selectedBiome.id);
      if (!region) throw new Error(`No region graph entry maps runtime biome ${selectedBiome.id}.`);
      windowChunks.push({
        windowX,
        windowZ,
        chunkCoordinates: [currentX, currentZ],
        biomeId: selectedBiome.id,
        regionId: region.id,
        semanticColor: region.semanticColor,
        color: hexColor(region.semanticColor, `${region.id}.semanticColor`),
      });
    }
  }
  const centerWindowChunk = windowChunks.find(({ windowX, windowZ }) => windowX === 0 && windowZ === 0);
  if (centerWindowChunk.biomeId !== descriptor.runtimeRecord.biomeId) {
    throw new Error(
      `Descriptor biome ${descriptor.runtimeRecord.biomeId} does not match BiomeCatalog selector ${centerWindowChunk.biomeId} at ${chunkX}:${chunkZ}.`,
    );
  }
  const heightSamples = Float32Array.from(descriptor.runtimeRecord.heightSamples, Math.fround);
  const terrainGrid = buildTerrainGrid(heightSamples);
  const { placements, countsByAsset } = collectPlacements(descriptor, assetRegistry);
  const landingCorridor = selectLandingCorridor(heightSamples, placements);
  const semanticWindow = renderSemanticWindow(windowChunks);
  const detailImages = renderTerrainImages(terrainGrid, regionColor, placements, landingCorridor);
  const contactSheet = renderContactSheet({
    semanticWindow,
    ...detailImages,
  });
  await mkdir(outDirectory, { recursive: true });
  const imageReports = [];
  imageReports.push(await writePng(outDirectory, 'semantic-window.png', semanticWindow));
  imageReports.push(await writePng(outDirectory, 'terrain-height.png', detailImages.height));
  imageReports.push(await writePng(outDirectory, 'slope-landability.png', detailImages.slope));
  imageReports.push(await writePng(outDirectory, 'placements.png', detailImages.placement));
  imageReports.push(await writePng(outDirectory, 'composite.png', detailImages.composite));
  imageReports.push(await writePng(outDirectory, 'contact-sheet.png', contactSheet));
  const report = {
    schemaVersion: '1.0.0',
    renderer: 'planes3d-worldclaw-bounded-semantic-review-v1',
    scope: 'bounded-review-only',
    globalMapClaimed: false,
    runtimeLoaded: false,
    outputPolicy: 'Review PNGs and report are offline evidence and are never runtime world authority.',
    inputs: {
      descriptor: relativeInputIdentity(root, descriptorPath),
      descriptorId: descriptor.descriptorId,
      descriptorContentHash: descriptor.runtimeRecord.contentHash,
      regionGraph: relativeInputIdentity(root, regionGraphPath),
      assetRegistry: relativeInputIdentity(root, assetRegistryPath),
      manifest: manifestPath ? relativeInputIdentity(root, manifestPath) : null,
      manifestHash: manifest?.manifestHash ?? null,
    },
    axes: {
      sourcePlane: 'chunk-local XZ in meters',
      imageX: 'left-to-right is -X to +X',
      imageY: 'top-to-bottom is -Z to +Z',
      imageOrigin: 'top-left is minimum X and minimum Z',
      upAxis: '+Y',
    },
    chunk: {
      id: descriptor.chunk.id,
      coordinates: [chunkX, chunkZ],
      centerWorldXYZ: descriptor.chunk.center,
      boundsXZ: descriptor.chunk.boundsXZ,
      regionId: descriptor.regionId,
      biomeId: descriptor.runtimeRecord.biomeId,
      sizeMeters: CHUNK_SIZE,
    },
    semanticWindow: {
      kind: '3-by-3-finite-review-window',
      chunkRange: {
        x: [chunkX - 1, chunkX + 1],
        z: [chunkZ - 1, chunkZ + 1],
      },
      cellsPerChunkSide: SEGMENTS,
      pixelsPerCell: 1,
      chunks: windowChunks.map(({ color, ...chunk }) => chunk),
    },
    terrain: {
      segmentsPerSide: SEGMENTS,
      samplesPerSide: SAMPLES,
      sampleCount: SAMPLE_COUNT,
      cells: SEGMENTS * SEGMENTS,
      cellSizeMeters: CELL_SIZE,
      triangleSplit: 'h00-h10-h01 when fractionX+fractionZ<=1; h11-h01-h10 otherwise',
      minimumHeightMeters: terrainGrid.minimumHeight,
      maximumHeightMeters: terrainGrid.maximumHeight,
      maximumTriangleSlopeDegrees: terrainGrid.maximumSlopeDegrees,
      cellsAtOrBelowFourDegrees: terrainGrid.cellsAtOrBelowFourDegrees,
      cellsAtOrBelowEightDegrees: terrainGrid.cellsAtOrBelowEightDegrees,
    },
    placements: {
      total: placements.length,
      countsByAsset,
      footprintPolicy: 'Registry-known prototype with conservative scaled XZ radius; no collision or gameplay claim.',
    },
    landingCorridor,
    images: imageReports,
  };
  await writeFile(path.join(outDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const report = await renderSemanticReview(args);
  process.stdout.write(`${JSON.stringify({
    descriptorId: report.inputs.descriptorId,
    scope: report.scope,
    chunk: report.chunk.id,
    landingCorridor: report.landingCorridor.status,
    images: report.images.map(({ name, width, height, sha256: hash }) => ({ name, width, height, sha256: hash })),
  }, null, 2)}\n`);
}

const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (executedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
