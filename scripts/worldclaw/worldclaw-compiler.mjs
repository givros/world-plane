import { createHash } from 'node:crypto';
import { readFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';

export const WORLDCLAW_COMPILER_VERSION = '1.1.0';

const SOURCE_FILES = [
  ['worldSpec', 'data/world/world_spec.json'],
  ['regionGraph', 'data/world/region_graph.json'],
  ['assetRegistry', 'data/world/asset_registry.json'],
  ['gameplayRoutes', 'data/world/gameplay_routes.json'],
];

const SCHEMA_FILES = [
  ['worldSpec', 'data/world/schemas/world_spec.schema.json'],
  ['regionGraph', 'data/world/schemas/region_graph.schema.json'],
  ['assetRegistry', 'data/world/schemas/asset_registry.schema.json'],
  ['gameplayRoutes', 'data/world/schemas/gameplay_routes.schema.json'],
  ['chunkDescriptor', 'data/world/schemas/chunk_descriptor.schema.json'],
];

const PILOT_DESCRIPTOR_FILE = 'data/world/pilots/chunk_0_1.json';
const DESCRIPTOR_ROOTS = ['data/world/pilots', 'data/world/regions'];
const CARDINAL_EDGES = ['north', 'east', 'south', 'west'];
const EDGE_RULES = {
  north: { delta: [0, -1], opposite: 'south' },
  east: { delta: [1, 0], opposite: 'west' },
  south: { delta: [0, 1], opposite: 'north' },
  west: { delta: [-1, 0], opposite: 'east' },
};

function compareStable(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function normalizeRepositoryPath(filePath) {
  return filePath.split(path.sep).join('/');
}

export class WorldClawValidationError extends Error {
  constructor(issues) {
    const ordered = [...issues].sort(compareStable);
    super(`WorldClaw validation failed with ${ordered.length} issue(s):\n- ${ordered.join('\n- ')}`);
    this.name = 'WorldClawValidationError';
    this.issues = ordered;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalValue(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Canonical JSON cannot contain a non-finite number.');
  }
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareStable)
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

export function canonicalStringify(value, { pretty = false } = {}) {
  return `${JSON.stringify(canonicalValue(value), null, pretty ? 2 : 0)}\n`;
}

export function sha256(value) {
  const payload = typeof value === 'string' || Buffer.isBuffer(value)
    ? value
    : canonicalStringify(value);
  return createHash('sha256').update(payload).digest('hex');
}

function valuesEqual(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function resolvesType(value, expected) {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return isPlainObject(value);
  if (expected === 'integer') return Number.isInteger(value) && Number.isFinite(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expected;
}

function resolveLocalReference(rootSchema, reference) {
  if (!reference.startsWith('#/')) return undefined;
  return reference
    .slice(2)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((current, token) => current?.[token], rootSchema);
}

function collectSchemaIssues(value, schema, instancePath, rootSchema, issues) {
  if (typeof schema === 'boolean') {
    if (!schema) issues.push(`${instancePath}: rejected by boolean schema`);
    return;
  }

  if (schema.$ref) {
    const resolved = resolveLocalReference(rootSchema, schema.$ref);
    if (!resolved) {
      issues.push(`${instancePath}: unresolved schema reference ${schema.$ref}`);
      return;
    }
    collectSchemaIssues(value, resolved, instancePath, rootSchema, issues);
    return;
  }

  if (schema.anyOf) {
    const alternatives = schema.anyOf.map((candidate) => {
      const candidateIssues = [];
      collectSchemaIssues(value, candidate, instancePath, rootSchema, candidateIssues);
      return candidateIssues;
    });
    if (!alternatives.some((candidateIssues) => candidateIssues.length === 0)) {
      issues.push(`${instancePath}: does not match any allowed schema alternative`);
    }
    return;
  }

  if (schema.const !== undefined && !valuesEqual(value, schema.const)) {
    issues.push(`${instancePath}: expected constant ${JSON.stringify(schema.const)}`);
    return;
  }

  if (schema.enum && !schema.enum.some((candidate) => valuesEqual(candidate, value))) {
    issues.push(`${instancePath}: expected one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    return;
  }

  if (schema.type) {
    const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!expectedTypes.some((expected) => resolvesType(value, expected))) {
      issues.push(`${instancePath}: expected ${expectedTypes.join(' or ')}, received ${describeType(value)}`);
      return;
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push(`${instancePath}: string is shorter than ${schema.minLength}`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) {
      issues.push(`${instancePath}: value does not match ${schema.pattern}`);
    }
    if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      issues.push(`${instancePath}: expected an ISO calendar date`);
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push(`${instancePath}: expected a value greater than or equal to ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push(`${instancePath}: expected a value less than or equal to ${schema.maximum}`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      issues.push(`${instancePath}: expected a value greater than ${schema.exclusiveMinimum}`);
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      issues.push(`${instancePath}: expected a value less than ${schema.exclusiveMaximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      issues.push(`${instancePath}: expected at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      issues.push(`${instancePath}: expected at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      value.forEach((item, index) => {
        const identity = canonicalStringify(item);
        if (seen.has(identity)) issues.push(`${instancePath}[${index}]: duplicate array item`);
        seen.add(identity);
      });
    }
    if (schema.items) {
      value.forEach((item, index) => collectSchemaIssues(item, schema.items, `${instancePath}[${index}]`, rootSchema, issues));
    }
  }

  if (isPlainObject(value)) {
    for (const requiredKey of schema.required ?? []) {
      if (!Object.hasOwn(value, requiredKey)) {
        issues.push(`${instancePath}: missing required property ${requiredKey}`);
      }
    }
    for (const [key, propertyValue] of Object.entries(value)) {
      if (schema.properties?.[key]) {
        collectSchemaIssues(propertyValue, schema.properties[key], `${instancePath}.${key}`, rootSchema, issues);
      } else if (schema.additionalProperties === false) {
        issues.push(`${instancePath}.${key}: property is not allowed`);
      } else if (isPlainObject(schema.additionalProperties)) {
        collectSchemaIssues(propertyValue, schema.additionalProperties, `${instancePath}.${key}`, rootSchema, issues);
      }
    }
  }
}

export function validateJsonSchema(value, schema, label = '$') {
  const issues = [];
  collectSchemaIssues(value, schema, label, schema, issues);
  return issues;
}

function duplicateIssues(items, collectionPath) {
  const seen = new Set();
  const issues = [];
  items.forEach((item, index) => {
    if (seen.has(item.id)) issues.push(`${collectionPath}[${index}].id: duplicate stable ID ${item.id}`);
    seen.add(item.id);
  });
  return issues;
}

function addMissingReference(issues, knownIds, id, sourcePath, targetName) {
  if (!knownIds.has(id)) issues.push(`${sourcePath}: unknown ${targetName} ${id}`);
}

function parseChunkId(chunkId) {
  const match = /^chunk:(-?\d+):(-?\d+)$/.exec(chunkId);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function isSafeRepositoryPath(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  if (candidate.startsWith('/') || candidate.includes('\\') || /^[A-Za-z]:/.test(candidate)) return false;
  const segments = candidate.split('/');
  return !segments.includes('..') && !segments.includes('.') && !candidate.includes('?') && !candidate.includes('#');
}

function viteUrl(baseUrl, repositoryPath) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${repositoryPath}`.replace(/\/{2,}/g, '/');
}

function approximatelyEqual(left, right, epsilon = 1e-9) {
  return Math.abs(left - right) <= epsilon;
}

function createRuntimeHashState() {
  return { value: 0x811c9dc5 };
}

function updateRuntimeHashByte(state, byte) {
  state.value ^= byte & 0xff;
  state.value = Math.imul(state.value, 0x01000193) >>> 0;
}

function updateRuntimeHashText(state, value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    updateRuntimeHashByte(state, code);
    updateRuntimeHashByte(state, code >>> 8);
  }
  updateRuntimeHashByte(state, 0xff);
}

function finishRuntimeHash(state) {
  return `fnv1a32:${state.value.toString(16).padStart(8, '0')}`;
}

export function hashRuntimeWorldChunkHeightSamples(samples) {
  const state = createRuntimeHashState();
  const buffer = Buffer.alloc(4);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (typeof sample !== 'number' || !Number.isFinite(sample)) {
      throw new WorldClawValidationError([`runtimeRecord.heightSamples[${index}]: expected a finite number`]);
    }
    buffer.writeFloatLE(Math.fround(sample), 0);
    updateRuntimeHashByte(state, buffer[0]);
    updateRuntimeHashByte(state, buffer[1]);
    updateRuntimeHashByte(state, buffer[2]);
    updateRuntimeHashByte(state, buffer[3]);
  }
  return finishRuntimeHash(state);
}

export function hashRuntimeWorldChunkContent(input) {
  const state = createRuntimeHashState();
  updateRuntimeHashText(state, input.schemaVersion);
  updateRuntimeHashText(state, input.generatorVersion);
  updateRuntimeHashText(state, input.dataRevision);
  updateRuntimeHashText(state, String(input.worldSeed >>> 0));
  updateRuntimeHashText(state, String(input.chunkX));
  updateRuntimeHashText(state, String(input.chunkZ));
  updateRuntimeHashText(state, input.biomeId);
  updateRuntimeHashText(state, input.heightHash);
  return finishRuntimeHash(state);
}

function validateChunkDescriptor(descriptor, registry, worldSpec, regionIds, regionById) {
  const issues = [];
  const chunkSize = worldSpec.worldScale.chunk.sizeMeters;
  const halfSize = chunkSize * 0.5;
  const coordinatesFromId = parseChunkId(descriptor.chunk.id);
  const [chunkX, chunkZ] = descriptor.chunk.coordinates;
  const center = descriptor.chunk.center;

  if (!coordinatesFromId || coordinatesFromId[0] !== chunkX || coordinatesFromId[1] !== chunkZ) {
    issues.push('pilotDescriptor.chunk.id: chunk ID does not match chunk coordinates');
  }
  const expectedCenter = [chunkX * chunkSize, 0, chunkZ * chunkSize];
  expectedCenter.forEach((value, index) => {
    if (!approximatelyEqual(center[index], value)) {
      issues.push(`pilotDescriptor.chunk.center[${index}]: expected ${value} from centered chunk coordinates`);
    }
  });
  const expectedMinimum = [expectedCenter[0] - halfSize, expectedCenter[2] - halfSize];
  const expectedMaximum = [expectedCenter[0] + halfSize, expectedCenter[2] + halfSize];
  for (let index = 0; index < 2; index += 1) {
    if (!approximatelyEqual(descriptor.chunk.boundsXZ.minimum[index], expectedMinimum[index])) {
      issues.push(`pilotDescriptor.chunk.boundsXZ.minimum[${index}]: expected ${expectedMinimum[index]}`);
    }
    if (!approximatelyEqual(descriptor.chunk.boundsXZ.maximum[index], expectedMaximum[index])) {
      issues.push(`pilotDescriptor.chunk.boundsXZ.maximum[${index}]: expected ${expectedMaximum[index]}`);
    }
    if (!(descriptor.chunk.boundsXZ.minimum[index] < descriptor.chunk.boundsXZ.maximum[index])) {
      issues.push(`pilotDescriptor.chunk.boundsXZ: minimum must be less than maximum on axis ${index}`);
    }
  }

  addMissingReference(issues, regionIds, descriptor.regionId, 'pilotDescriptor.regionId', 'region ID');

  const identity = descriptor.runtimeRecordIdentity;
  const seedHex = worldSpec.worldScale.biomeGenerator.defaultSeedHex;
  const expectedSeed = Number.parseInt(seedHex.slice(2), 16) >>> 0;
  if (identity.schemaVersion !== descriptor.schemaVersion) {
    issues.push('pilotDescriptor.runtimeRecordIdentity.schemaVersion: must match descriptor schemaVersion');
  }
  if (identity.dataRevision !== descriptor.dataRevision) {
    issues.push('pilotDescriptor.runtimeRecordIdentity.dataRevision: must match descriptor dataRevision');
  }
  if (identity.worldSeed !== expectedSeed) {
    issues.push(`pilotDescriptor.runtimeRecordIdentity.worldSeed: expected default seed ${expectedSeed}`);
  }
  if (identity.chunkX !== chunkX || identity.chunkZ !== chunkZ) {
    issues.push('pilotDescriptor.runtimeRecordIdentity: chunkX/chunkZ must match descriptor coordinates');
  }
  const runtimeBiomeId = regionById.get(descriptor.regionId)?.runtimeBiomeId;
  if (!runtimeBiomeId || identity.biomeId !== runtimeBiomeId) {
    issues.push(`pilotDescriptor.runtimeRecordIdentity.biomeId: expected runtime biome ${runtimeBiomeId ?? '(missing)'}`);
  }
  if (descriptor.runtimeRecordStatus === 'ready' && descriptor.runtimeRecord === null) {
    issues.push('pilotDescriptor.runtimeRecord: ready status requires an authored runtime record');
  }
  if (descriptor.runtimeRecordStatus !== 'ready' && descriptor.runtimeRecord !== null) {
    issues.push('pilotDescriptor.runtimeRecordStatus: a populated runtime record must use ready status');
  }
  if (descriptor.runtimeRecord !== null) {
    const runtimeRecord = descriptor.runtimeRecord;
    const runtimeIdentity = Object.fromEntries(
      Object.keys(identity).map((key) => [key, runtimeRecord[key]]),
    );
    if (!valuesEqual(runtimeIdentity, identity)) {
      issues.push('pilotDescriptor.runtimeRecord: runtime identity fields do not match runtimeRecordIdentity');
    }
    const expectedHeightHash = hashRuntimeWorldChunkHeightSamples(runtimeRecord.heightSamples);
    if (runtimeRecord.heightHash !== expectedHeightHash) {
      issues.push(`pilotDescriptor.runtimeRecord.heightHash: expected ${expectedHeightHash}`);
    }
    const expectedContentHash = hashRuntimeWorldChunkContent({
      ...identity,
      heightHash: expectedHeightHash,
    });
    if (runtimeRecord.contentHash !== expectedContentHash) {
      issues.push(`pilotDescriptor.runtimeRecord.contentHash: expected ${expectedContentHash}`);
    }
  }

  if (descriptor.terrain.mode === 'procedural-identity' && descriptor.terrain.heightPayload !== null) {
    issues.push('pilotDescriptor.terrain.heightPayload: procedural identity mode must not provide an authored payload');
  }
  if (descriptor.terrain.mode === 'authored-float32-grid' && descriptor.runtimeRecord === null) {
    issues.push('pilotDescriptor.runtimeRecord: authored terrain requires the Stage2 runtime record');
  }
  if (descriptor.terrain.mode === 'procedural-identity' && descriptor.runtimeRecord !== null) {
    issues.push('pilotDescriptor.terrain.mode: a populated runtime record requires authored-float32-grid mode');
  }

  const edgeNames = new Set();
  for (const [index, edge] of descriptor.terrain.sharedEdges.entries()) {
    if (edgeNames.has(edge.edge)) issues.push(`pilotDescriptor.terrain.sharedEdges[${index}].edge: duplicate edge ${edge.edge}`);
    edgeNames.add(edge.edge);
    const rule = EDGE_RULES[edge.edge];
    if (!rule) continue;
    const expectedNeighborId = `chunk:${chunkX + rule.delta[0]}:${chunkZ + rule.delta[1]}`;
    if (edge.neighborChunkId !== expectedNeighborId) {
      issues.push(`pilotDescriptor.terrain.sharedEdges[${index}].neighborChunkId: expected ${expectedNeighborId}`);
    }
    if (edge.neighborEdge !== rule.opposite) {
      issues.push(`pilotDescriptor.terrain.sharedEdges[${index}].neighborEdge: expected ${rule.opposite}`);
    }
    if (descriptor.terrain.mode === 'authored-float32-grid' && edge.payloadHash === null) {
      issues.push(`pilotDescriptor.terrain.sharedEdges[${index}].payloadHash: authored terrain requires an edge hash`);
    }
  }
  for (const edgeName of CARDINAL_EDGES) {
    if (!edgeNames.has(edgeName)) issues.push(`pilotDescriptor.terrain.sharedEdges: missing ${edgeName} validation hook`);
  }

  const assetById = new Map(registry.assets.map((asset) => [asset.id, asset]));
  const declaredAssetIds = new Set(descriptor.declaredAssetIds);
  for (const [index, assetId] of descriptor.declaredAssetIds.entries()) {
    addMissingReference(issues, new Set(assetById.keys()), assetId, `pilotDescriptor.declaredAssetIds[${index}]`, 'asset ID');
  }

  const capacityById = new Map();
  for (const [index, capacity] of descriptor.capacities.entries()) {
    if (capacityById.has(capacity.assetId)) {
      issues.push(`pilotDescriptor.capacities[${index}].assetId: duplicate capacity for ${capacity.assetId}`);
    }
    capacityById.set(capacity.assetId, capacity.maximumActiveInstances);
    const asset = assetById.get(capacity.assetId);
    if (!asset) {
      issues.push(`pilotDescriptor.capacities[${index}].assetId: unknown asset ID ${capacity.assetId}`);
      continue;
    }
    const registryCapacity = asset.sharedActiveCapacity ?? asset.capacityPerChunkSlot;
    if (registryCapacity === undefined) {
      issues.push(`pilotDescriptor.capacities[${index}]: ${capacity.assetId} has no registry capacity`);
    } else if (registryCapacity !== capacity.maximumActiveInstances) {
      issues.push(`pilotDescriptor.capacities[${index}].maximumActiveInstances: expected registry capacity ${registryCapacity}`);
    }
  }

  const batchIds = new Set();
  for (const [batchIndex, batch] of descriptor.prototypeBatches.entries()) {
    if (batchIds.has(batch.assetId)) {
      issues.push(`pilotDescriptor.prototypeBatches[${batchIndex}].assetId: duplicate batch for ${batch.assetId}`);
    }
    batchIds.add(batch.assetId);
    if (!declaredAssetIds.has(batch.assetId)) {
      issues.push(`pilotDescriptor.prototypeBatches[${batchIndex}].assetId: ${batch.assetId} is not declared`);
    }
    const maximum = capacityById.get(batch.assetId);
    if (maximum === undefined) {
      issues.push(`pilotDescriptor.prototypeBatches[${batchIndex}]: no capacity declared for ${batch.assetId}`);
    } else if (batch.transforms.length > maximum) {
      issues.push(`pilotDescriptor.prototypeBatches[${batchIndex}].transforms: ${batch.transforms.length} exceeds capacity ${maximum}`);
    }

    for (const [transformIndex, transform] of batch.transforms.entries()) {
      const transformPath = `pilotDescriptor.prototypeBatches[${batchIndex}].transforms[${transformIndex}]`;
      const [localX, , localZ] = transform.translation;
      if (localX < -halfSize || localX > halfSize || localZ < -halfSize || localZ > halfSize) {
        issues.push(`${transformPath}.translation: chunk-local X/Z must stay within [-${halfSize}, ${halfSize}]`);
      }
      const magnitude = Math.hypot(...transform.rotation);
      if (!approximatelyEqual(magnitude, 1, 1e-5)) {
        issues.push(`${transformPath}.rotation: quaternion must be normalized`);
      }
      if (descriptor.originReservation.enforced) {
        const worldX = center[0] + localX;
        const worldZ = center[2] + localZ;
        if (Math.max(Math.abs(worldX), Math.abs(worldZ)) < descriptor.originReservation.halfExtentMeters) {
          issues.push(`${transformPath}.translation: placement enters the protected origin reserve`);
        }
      }
    }
  }

  if (descriptor.originReservation.halfExtentMeters !== worldSpec.terrain.airportFlattening.propAndUrbanReserveHalfExtentMeters) {
    issues.push('pilotDescriptor.originReservation.halfExtentMeters: does not match world specification');
  }
  for (const [key, artifactPath] of Object.entries(descriptor.artifactPaths)) {
    if (key === 'runtimeResolution') continue;
    if (!isSafeRepositoryPath(artifactPath)) {
      issues.push(`pilotDescriptor.artifactPaths.${key}: path is not Vite-safe repository-relative data`);
    }
  }
  return issues;
}

function validateCrossReferences(inputs, rootDir) {
  const { worldSpec, regionGraph, assetRegistry, gameplayRoutes, pilotDescriptor } = inputs;
  const descriptorRecords = descriptorRecordsFromInputs(inputs);
  const issues = [];
  const regionIds = new Set(regionGraph.regions.map(({ id }) => id));
  const regionById = new Map(regionGraph.regions.map((region) => [region.id, region]));
  const zoneIds = new Set(regionGraph.zones.map(({ id }) => id));
  const landmarkIds = new Set(regionGraph.landmarks.map(({ id }) => id));
  const graphNodeIds = new Set([...regionIds, ...zoneIds, ...landmarkIds]);
  const assetIds = new Set(assetRegistry.assets.map(({ id }) => id));
  const materialSetIds = new Set(assetRegistry.materialSets.map(({ id }) => id));
  const actorIds = new Set(gameplayRoutes.actors.map(({ id }) => id));
  const spawnIds = new Set(gameplayRoutes.spawns.map(({ id }) => id));
  const routeIds = new Set(gameplayRoutes.routes.map(({ id }) => id));
  const gameplayZoneIds = new Set(gameplayRoutes.operationalZones.map(({ id }) => id));

  issues.push(...duplicateIssues(worldSpec.worldLayers, 'worldSpec.worldLayers'));
  issues.push(...duplicateIssues(regionGraph.regions, 'regionGraph.regions'));
  issues.push(...duplicateIssues(regionGraph.zones, 'regionGraph.zones'));
  issues.push(...duplicateIssues(regionGraph.landmarks, 'regionGraph.landmarks'));
  issues.push(...duplicateIssues(assetRegistry.materialSets, 'assetRegistry.materialSets'));
  issues.push(...duplicateIssues(assetRegistry.assets, 'assetRegistry.assets'));
  issues.push(...duplicateIssues(gameplayRoutes.actors, 'gameplayRoutes.actors'));
  issues.push(...duplicateIssues(gameplayRoutes.spawns, 'gameplayRoutes.spawns'));
  issues.push(...duplicateIssues(gameplayRoutes.operationalZones, 'gameplayRoutes.operationalZones'));
  issues.push(...duplicateIssues(gameplayRoutes.routes, 'gameplayRoutes.routes'));
  issues.push(...duplicateIssues(gameplayRoutes.visualOnlyPaths, 'gameplayRoutes.visualOnlyPaths'));

  const revisions = [worldSpec, regionGraph, assetRegistry, gameplayRoutes].map(({ sourceRevision }) => sourceRevision);
  if (!revisions.every((revision) => revision === revisions[0])) {
    issues.push('sourceRevision: all four source documents must share one revision');
  }
  if (pilotDescriptor.dataRevision !== worldSpec.sourceRevision) {
    issues.push('pilotDescriptor.dataRevision: must match the source document revision');
  }

  for (const [layerIndex, layer] of worldSpec.worldLayers.entries()) {
    for (const [regionIndex, regionId] of (layer.regionIds ?? []).entries()) {
      addMissingReference(issues, regionIds, regionId, `worldSpec.worldLayers[${layerIndex}].regionIds[${regionIndex}]`, 'region ID');
    }
  }
  for (const [key, materialSetId] of Object.entries(worldSpec.materials).filter(([key]) => key.endsWith('SetId'))) {
    addMissingReference(issues, materialSetIds, materialSetId, `worldSpec.materials.${key}`, 'material set ID');
  }

  for (const [regionIndex, region] of regionGraph.regions.entries()) {
    if (region.underlyingRegionId) addMissingReference(issues, regionIds, region.underlyingRegionId, `regionGraph.regions[${regionIndex}].underlyingRegionId`, 'region ID');
    for (const [index, id] of (region.routeIds ?? []).entries()) addMissingReference(issues, routeIds, id, `regionGraph.regions[${regionIndex}].routeIds[${index}]`, 'route ID');
    for (const [index, id] of (region.spawnIds ?? []).entries()) addMissingReference(issues, spawnIds, id, `regionGraph.regions[${regionIndex}].spawnIds[${index}]`, 'spawn ID');
    for (const [index, id] of (region.materialSetIds ?? []).entries()) addMissingReference(issues, materialSetIds, id, `regionGraph.regions[${regionIndex}].materialSetIds[${index}]`, 'material set ID');
    for (const [index, id] of (region.repeatedAssetIds ?? []).entries()) addMissingReference(issues, assetIds, id, `regionGraph.regions[${regionIndex}].repeatedAssetIds[${index}]`, 'asset ID');
    if (region.landmarkPatternId) addMissingReference(issues, landmarkIds, region.landmarkPatternId, `regionGraph.regions[${regionIndex}].landmarkPatternId`, 'landmark ID');
  }
  for (const [zoneIndex, zone] of regionGraph.zones.entries()) {
    addMissingReference(issues, regionIds, zone.parentRegionId, `regionGraph.zones[${zoneIndex}].parentRegionId`, 'region ID');
  }
  for (const [landmarkIndex, landmark] of regionGraph.landmarks.entries()) {
    addMissingReference(issues, regionIds, landmark.regionId, `regionGraph.landmarks[${landmarkIndex}].regionId`, 'region ID');
    addMissingReference(issues, assetIds, landmark.assetId, `regionGraph.landmarks[${landmarkIndex}].assetId`, 'asset ID');
    if (!landmark.position && !landmark.localPositionXZ) {
      issues.push(`regionGraph.landmarks[${landmarkIndex}]: expected position or localPositionXZ`);
    }
  }
  for (const [edgeIndex, edge] of regionGraph.edges.entries()) {
    addMissingReference(issues, graphNodeIds, edge.from, `regionGraph.edges[${edgeIndex}].from`, 'graph node ID');
    addMissingReference(issues, graphNodeIds, edge.to, `regionGraph.edges[${edgeIndex}].to`, 'graph node ID');
  }
  for (const [index, entry] of regionGraph.initialChunkWindowDerivedFromCurrentSeed.entries()) {
    addMissingReference(issues, regionIds, entry.regionId, `regionGraph.initialChunkWindowDerivedFromCurrentSeed[${index}].regionId`, 'region ID');
  }

  for (const [assetIndex, asset] of assetRegistry.assets.entries()) {
    if (!assetRegistry.classificationValues.includes(asset.classification)) {
      issues.push(`assetRegistry.assets[${assetIndex}].classification: unknown classification ${asset.classification}`);
    }
    const sourcePath = asset.source.split('#')[0];
    if (sourcePath.startsWith('src/') || sourcePath.startsWith('public/')) {
      if (!isSafeRepositoryPath(sourcePath)) issues.push(`assetRegistry.assets[${assetIndex}].source: unsafe source path`);
    }
  }
  for (const [index, id] of assetRegistry.pilot.existingAssetIds.entries()) {
    addMissingReference(issues, assetIds, id, `assetRegistry.pilot.existingAssetIds[${index}]`, 'asset ID');
  }
  for (const [index, id] of assetRegistry.pilot.requiredHeroAssetIds.entries()) {
    addMissingReference(issues, assetIds, id, `assetRegistry.pilot.requiredHeroAssetIds[${index}]`, 'asset ID');
  }

  for (const [actorIndex, actor] of gameplayRoutes.actors.entries()) {
    addMissingReference(issues, assetIds, actor.assetId, `gameplayRoutes.actors[${actorIndex}].assetId`, 'asset ID');
    for (const [index, id] of actor.spawnIds.entries()) addMissingReference(issues, spawnIds, id, `gameplayRoutes.actors[${actorIndex}].spawnIds[${index}]`, 'spawn ID');
  }
  for (const [spawnIndex, spawn] of gameplayRoutes.spawns.entries()) {
    addMissingReference(issues, regionIds, spawn.regionId, `gameplayRoutes.spawns[${spawnIndex}].regionId`, 'region ID');
    addMissingReference(issues, zoneIds, spawn.zoneId, `gameplayRoutes.spawns[${spawnIndex}].zoneId`, 'zone ID');
  }
  for (const [zoneIndex, zone] of gameplayRoutes.operationalZones.entries()) {
    if (zone.id !== 'zone-airport-origin-reserve') {
      addMissingReference(issues, zoneIds, zone.id, `gameplayRoutes.operationalZones[${zoneIndex}].id`, 'region-graph zone ID');
    }
  }
  for (const [routeIndex, route] of gameplayRoutes.routes.entries()) {
    for (const [index, id] of route.regionIds.entries()) addMissingReference(issues, regionIds, id, `gameplayRoutes.routes[${routeIndex}].regionIds[${index}]`, 'region ID');
    for (const [index, id] of route.actorIds.entries()) addMissingReference(issues, actorIds, id, `gameplayRoutes.routes[${routeIndex}].actorIds[${index}]`, 'actor ID');
    if (route.startSpawnId) addMissingReference(issues, spawnIds, route.startSpawnId, `gameplayRoutes.routes[${routeIndex}].startSpawnId`, 'spawn ID');
    if (route.toSpawnId) addMissingReference(issues, spawnIds, route.toSpawnId, `gameplayRoutes.routes[${routeIndex}].toSpawnId`, 'spawn ID');
  }
  for (const [pathIndex, visualPath] of gameplayRoutes.visualOnlyPaths.entries()) {
    for (const [index, id] of visualPath.regionIds.entries()) addMissingReference(issues, regionIds, id, `gameplayRoutes.visualOnlyPaths[${pathIndex}].regionIds[${index}]`, 'region ID');
  }

  for (const id of worldSpec.access.aircraft.criticalRouteIds) {
    addMissingReference(issues, routeIds, id, 'worldSpec.access.aircraft.criticalRouteIds', 'route ID');
  }
  addMissingReference(issues, spawnIds, worldSpec.access.aircraft.spawnId, 'worldSpec.access.aircraft.spawnId', 'spawn ID');
  addMissingReference(issues, regionIds, worldSpec.access.aircraft.runwayRegionId, 'worldSpec.access.aircraft.runwayRegionId', 'region ID');

  const pilotRecords = [worldSpec.pilot, regionGraph.pilot, assetRegistry.pilot, pilotDescriptor];
  if (!pilotRecords.every((pilot) => pilot.id === pilotRecords[0].id || pilot.descriptorId === pilotRecords[0].id)) {
    issues.push('pilot.id: pilot identity differs across source documents and descriptor');
  }
  if (worldSpec.pilot.chunkId !== regionGraph.pilot.chunkId || worldSpec.pilot.chunkId !== pilotDescriptor.chunk.id) {
    issues.push('pilot.chunkId: pilot chunk differs across source documents and descriptor');
  }
  if (worldSpec.pilot.regionId !== regionGraph.pilot.regionId || worldSpec.pilot.regionId !== pilotDescriptor.regionId) {
    issues.push('pilot.regionId: pilot region differs across source documents and descriptor');
  }
  if (!valuesEqual(worldSpec.pilot.chunkCoordinates, regionGraph.pilot.chunkCoordinates)
      || !valuesEqual(worldSpec.pilot.chunkCoordinates, pilotDescriptor.chunk.coordinates)) {
    issues.push('pilot.chunkCoordinates: pilot coordinates differ across source documents and descriptor');
  }

  const naturalCapacity = worldSpec.performanceBudgets.streaming.naturalInstancesPerFamilyMax;
  for (const [assetIndex, asset] of assetRegistry.assets.entries()) {
    if (asset.sharedActiveCapacity !== undefined && asset.sharedActiveCapacity !== naturalCapacity) {
      issues.push(`assetRegistry.assets[${assetIndex}].sharedActiveCapacity: expected world budget ${naturalCapacity}`);
    }
  }
  const expectedUrbanCapacities = new Map([
    ['existing-urban-box-pool', worldSpec.performanceBudgets.streaming.urbanBoxesPerSlotMax],
    ['existing-urban-roof-pool', worldSpec.performanceBudgets.streaming.urbanRoofsPerSlotMax],
  ]);
  for (const [assetId, expectedCapacity] of expectedUrbanCapacities.entries()) {
    const asset = assetRegistry.assets.find(({ id }) => id === assetId);
    if (!asset || asset.capacityPerChunkSlot !== expectedCapacity) {
      issues.push(`assetRegistry.assets.${assetId}: expected per-slot capacity ${expectedCapacity}`);
    }
  }

  const reserve = gameplayRoutes.operationalZones.find(({ id }) => id === 'zone-airport-origin-reserve');
  const reserveHalfExtent = worldSpec.terrain.airportFlattening.propAndUrbanReserveHalfExtentMeters;
  if (!reserve || !valuesEqual(reserve.boundsMeters, { x: [-reserveHalfExtent, reserveHalfExtent], z: [-reserveHalfExtent, reserveHalfExtent] })) {
    issues.push('gameplayRoutes.operationalZones.zone-airport-origin-reserve: bounds do not match world origin reservation');
  }

  for (const [key, linkedPath] of Object.entries(worldSpec.linkedSpecifications)) {
    if (!isSafeRepositoryPath(linkedPath)) issues.push(`worldSpec.linkedSpecifications.${key}: path is not repository-relative and Vite-safe`);
  }
  for (const [index, basePath] of worldSpec.artifactRequirements.viteBaseSafePaths.entries()) {
    if (!basePath.startsWith('/') || !basePath.endsWith('/')) issues.push(`worldSpec.artifactRequirements.viteBaseSafePaths[${index}]: base must start and end with /`);
  }
  if (!gameplayZoneIds.has('zone-airport-origin-reserve')) {
    issues.push('gameplayRoutes.operationalZones: origin reserve is missing');
  }

  const descriptorIds = new Map();
  const descriptorCoordinates = new Map();
  const descriptorPaths = new Set();
  for (const [descriptorIndex, record] of descriptorRecords.entries()) {
    const label = `chunkDescriptors[${descriptorIndex}](${record.path})`;
    const descriptor = record.descriptor;
    if (descriptorPaths.has(record.path)) {
      issues.push(`${label}: duplicate descriptor path ${record.path}`);
    }
    descriptorPaths.add(record.path);
    const previousIdPath = descriptorIds.get(descriptor.descriptorId);
    if (previousIdPath) {
      issues.push(`${label}.descriptorId: duplicate descriptor ID ${descriptor.descriptorId} also used by ${previousIdPath}`);
    } else {
      descriptorIds.set(descriptor.descriptorId, record.path);
    }
    const coordinateKey = `${descriptor.chunk.coordinates[0]}:${descriptor.chunk.coordinates[1]}`;
    const previousCoordinatePath = descriptorCoordinates.get(coordinateKey);
    if (previousCoordinatePath) {
      issues.push(`${label}.chunk.coordinates: duplicate chunk coordinates ${coordinateKey} also used by ${previousCoordinatePath}`);
    } else {
      descriptorCoordinates.set(coordinateKey, record.path);
    }
    if (!record.path.startsWith('data/world/pilots/')
        && !record.path.startsWith('data/world/regions/')) {
      issues.push(`${label}: descriptor path is outside an approved discovery root`);
    }
    if (!isSafeRepositoryPath(record.path) || !record.path.toLowerCase().endsWith('.json')) {
      issues.push(`${label}: descriptor path is not a safe repository-relative JSON path`);
    }
    if (descriptor.artifactPaths.descriptor !== record.path) {
      issues.push(`${label}.artifactPaths.descriptor: expected discovered path ${record.path}`);
    }
    if (record.path.startsWith('data/world/regions/')) {
      const pathSegments = record.path.split('/');
      const biomeDirectory = pathSegments[3];
      if (pathSegments.length < 5 || biomeDirectory !== descriptor.runtimeRecordIdentity.biomeId) {
        issues.push(`${label}: region descriptor must be stored under data/world/regions/${descriptor.runtimeRecordIdentity.biomeId}/`);
      }
    }
    if (descriptor.dataRevision !== worldSpec.sourceRevision) {
      issues.push(`${label}.dataRevision: must match source revision ${worldSpec.sourceRevision}`);
    }
    issues.push(...validateChunkDescriptor(
      descriptor,
      assetRegistry,
      worldSpec,
      regionIds,
      regionById,
    ).map((issue) => issue.replaceAll('pilotDescriptor', label)));
  }

  if (rootDir) {
    for (const [key, linkedPath] of Object.entries(worldSpec.linkedSpecifications)) {
      const resolved = path.resolve(rootDir, linkedPath);
      const relative = path.relative(rootDir, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        issues.push(`worldSpec.linkedSpecifications.${key}: path escapes the repository root`);
      }
    }
  }
  return issues;
}

export function validateWorldInputs(inputs, { rootDir } = {}) {
  const issues = [];
  const descriptorRecords = descriptorRecordsFromInputs(inputs);
  const schemaPairs = [
    ['worldSpec', inputs.worldSpec, inputs.schemas.worldSpec],
    ['regionGraph', inputs.regionGraph, inputs.schemas.regionGraph],
    ['assetRegistry', inputs.assetRegistry, inputs.schemas.assetRegistry],
    ['gameplayRoutes', inputs.gameplayRoutes, inputs.schemas.gameplayRoutes],
    ...descriptorRecords.map((record, index) => [
      `chunkDescriptors[${index}](${record.path})`,
      record.descriptor,
      inputs.schemas.chunkDescriptor,
    ]),
  ];
  if (descriptorRecords.length === 0) issues.push('chunkDescriptors: expected at least the pilot descriptor');
  for (const [label, value, schema] of schemaPairs) {
    issues.push(...validateJsonSchema(value, schema, label));
  }
  if (issues.length === 0) issues.push(...validateCrossReferences(inputs, rootDir));
  if (issues.length > 0) throw new WorldClawValidationError(issues);
  return { valid: true };
}

async function readJson(rootDir, relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  const contents = await readFile(absolutePath, 'utf8');
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new WorldClawValidationError([`${relativePath}: invalid JSON (${error.message})`]);
  }
}

async function discoverJsonFiles(rootDir, relativeDirectory, results) {
  const absoluteDirectory = path.resolve(rootDir, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  entries.sort((left, right) => compareStable(left.name, right.name));
  for (const entry of entries) {
    const relativePath = normalizeRepositoryPath(path.posix.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      await discoverJsonFiles(rootDir, relativePath, results);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      results.push(relativePath);
    }
  }
}

export async function discoverChunkDescriptorPaths(rootDir) {
  const paths = [];
  for (const descriptorRoot of DESCRIPTOR_ROOTS) {
    await discoverJsonFiles(rootDir, descriptorRoot, paths);
  }
  return paths.sort(compareStable);
}

function descriptorRecordsFromInputs(inputs) {
  const records = (inputs.chunkDescriptors ?? [{
    path: PILOT_DESCRIPTOR_FILE,
    descriptor: inputs.pilotDescriptor,
  }]).map((record) => ({
    path: normalizeRepositoryPath(record.path),
    descriptor: record.descriptor,
  }));
  const pilotId = inputs.worldSpec.pilot.id;
  let pilotIndex = records.findIndex((record) => record.path === PILOT_DESCRIPTOR_FILE);
  if (pilotIndex < 0) {
    pilotIndex = records.findIndex((record) => record.descriptor?.descriptorId === pilotId);
  }
  if (pilotIndex >= 0 && inputs.pilotDescriptor) {
    records[pilotIndex] = { ...records[pilotIndex], descriptor: inputs.pilotDescriptor };
  }
  return records.sort((left, right) => compareStable(left.path, right.path));
}

export async function loadWorldInputs(rootDir) {
  const inputs = { schemas: {} };
  for (const [key, relativePath] of SOURCE_FILES) inputs[key] = await readJson(rootDir, relativePath);
  for (const [key, relativePath] of SCHEMA_FILES) inputs.schemas[key] = await readJson(rootDir, relativePath);
  const descriptorPaths = await discoverChunkDescriptorPaths(rootDir);
  inputs.chunkDescriptors = await Promise.all(descriptorPaths.map(async (relativePath) => ({
    path: relativePath,
    descriptor: await readJson(rootDir, relativePath),
  })));
  const pilotId = inputs.worldSpec.pilot.id;
  const pilotRecord = inputs.chunkDescriptors.find((record) => record.path === PILOT_DESCRIPTOR_FILE)
    ?? inputs.chunkDescriptors.find((record) => record.descriptor.descriptorId === pilotId);
  if (!pilotRecord) {
    throw new WorldClawValidationError([
      `chunkDescriptors: required pilot descriptor ${pilotId} was not found under data/world/pilots`,
    ]);
  }
  inputs.pilotDescriptor = pilotRecord.descriptor;
  return inputs;
}

function hashEntries(entries, values) {
  return entries.map(([id, file]) => ({ id, path: file, sha256: sha256(values[id]) }));
}

function assertNoCompilerTimestamps(value, currentPath = 'manifest') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCompilerTimestamps(item, `${currentPath}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:generatedAt|compiledAt|createdAt|timestamp)$/i.test(key)) {
      throw new WorldClawValidationError([`${currentPath}.${key}: compiler timestamps are forbidden in hashed manifest content`]);
    }
    assertNoCompilerTimestamps(child, `${currentPath}.${key}`);
  }
}

export function compileWorldFromInputs(inputs, { rootDir } = {}) {
  validateWorldInputs(inputs, { rootDir });
  const sources = hashEntries(SOURCE_FILES, inputs);
  const schemas = hashEntries(SCHEMA_FILES, inputs.schemas);
  const descriptorRecords = descriptorRecordsFromInputs(inputs);
  const chunkDescriptors = descriptorRecords.map((record) => ({
    id: record.descriptor.descriptorId,
    path: record.path,
    biomeId: record.descriptor.runtimeRecordIdentity.biomeId,
    chunkCoordinates: record.descriptor.chunk.coordinates,
    runtimeRecordStatus: record.descriptor.runtimeRecordStatus,
    ready: record.descriptor.runtimeRecordStatus === 'ready' && record.descriptor.runtimeRecord !== null,
    sha256: sha256(record.descriptor),
  }));
  const biomeCoverageMap = new Map();
  for (const record of descriptorRecords) {
    const biomeId = record.descriptor.runtimeRecordIdentity.biomeId;
    const coverage = biomeCoverageMap.get(biomeId) ?? {
      biomeId,
      representativeCount: 0,
      readyCount: 0,
    };
    coverage.representativeCount += 1;
    if (record.descriptor.runtimeRecordStatus === 'ready' && record.descriptor.runtimeRecord !== null) {
      coverage.readyCount += 1;
    }
    biomeCoverageMap.set(biomeId, coverage);
  }
  const biomeCoverage = [...biomeCoverageMap.values()]
    .sort((left, right) => compareStable(left.biomeId, right.biomeId));
  const sourceSetHash = sha256({ sources, schemas, chunkDescriptors });
  const basePaths = inputs.worldSpec.artifactRequirements.viteBaseSafePaths;
  const manifestCore = {
    schemaVersion: '1.0.0',
    compiler: {
      id: 'planes3d-worldclaw-offline',
      version: WORLDCLAW_COMPILER_VERSION,
      deterministic: true,
      canonicalization: 'recursive-key-sort-json-v1',
      hashAlgorithm: 'sha256',
    },
    dataRevision: inputs.worldSpec.sourceRevision,
    sources,
    schemas,
    chunkDescriptors,
    biomeCoverage,
    sourceSetHash,
    inventory: {
      regionCount: inputs.regionGraph.regions.length,
      zoneCount: inputs.regionGraph.zones.length,
      landmarkCount: inputs.regionGraph.landmarks.length,
      materialSetCount: inputs.assetRegistry.materialSets.length,
      assetCount: inputs.assetRegistry.assets.length,
      criticalRouteCount: inputs.gameplayRoutes.routes.filter(({ critical }) => critical).length,
      descriptorCount: descriptorRecords.length,
      readyDescriptorCount: chunkDescriptors.filter(({ ready }) => ready).length,
      representedBiomeCount: biomeCoverage.length,
    },
    runtimePaths: {
      resolution: 'import.meta.env.BASE_URL',
      supportedBases: basePaths.map((baseUrl) => ({
        baseUrl,
        manifestUrl: viteUrl(baseUrl, inputs.pilotDescriptor.artifactPaths.manifest),
        pilotDescriptorUrl: viteUrl(baseUrl, inputs.pilotDescriptor.artifactPaths.descriptor),
      })),
    },
    pilot: {
      id: inputs.pilotDescriptor.descriptorId,
      chunkId: inputs.pilotDescriptor.chunk.id,
      chunkCoordinates: inputs.pilotDescriptor.chunk.coordinates,
      center: inputs.pilotDescriptor.chunk.center,
      boundsXZ: inputs.pilotDescriptor.chunk.boundsXZ,
      regionId: inputs.pilotDescriptor.regionId,
      runtimeRecordStatus: inputs.pilotDescriptor.runtimeRecordStatus,
      runtimeRecordIdentity: inputs.pilotDescriptor.runtimeRecordIdentity,
      runtimeRecordAvailable: inputs.pilotDescriptor.runtimeRecord !== null,
      runtimeRecordContract: {
        fields: [
          'schemaVersion',
          'generatorVersion',
          'dataRevision',
          'worldSeed',
          'chunkX',
          'chunkZ',
          'biomeId',
          'heightSamples',
          'heightHash',
          'contentHash',
        ],
        heightSampleCount: 1681,
        runtimeHash: 'fnv1a32',
      },
      terrainMode: inputs.pilotDescriptor.terrain.mode,
      sharedEdgeHooks: inputs.pilotDescriptor.terrain.sharedEdges.map(({ edge, neighborChunkId, neighborEdge, validation }) => ({
        edge,
        neighborChunkId,
        neighborEdge,
        validation,
      })),
      proceduralFallbackRequired: inputs.pilotDescriptor.fallback.required,
    },
  };
  assertNoCompilerTimestamps(manifestCore);
  return { ...manifestCore, manifestHash: sha256(manifestCore) };
}

export async function compileWorld(rootDir) {
  const inputs = await loadWorldInputs(rootDir);
  return compileWorldFromInputs(inputs, { rootDir });
}

function float32Bytes(samples) {
  const buffer = Buffer.alloc(samples.length * 4);
  samples.forEach((sample, index) => {
    if (typeof sample !== 'number' || !Number.isFinite(sample)) {
      throw new WorldClawValidationError([`sharedEdge.samples[${index}]: expected a finite number`]);
    }
    buffer.writeFloatLE(sample, index * 4);
  });
  return buffer;
}

export function float32EdgeHash(samples) {
  return sha256(float32Bytes(samples));
}

export function validateSharedEdgePair(pair, { expectedSamples = 41 } = {}) {
  const issues = [];
  const leftCoordinates = parseChunkId(pair.left.chunkId);
  const rightCoordinates = parseChunkId(pair.right.chunkId);
  const rule = EDGE_RULES[pair.left.edge];
  if (!leftCoordinates || !rightCoordinates || !rule) {
    issues.push('sharedEdge: invalid chunk ID or left edge');
  } else {
    const expectedRight = [leftCoordinates[0] + rule.delta[0], leftCoordinates[1] + rule.delta[1]];
    if (!valuesEqual(rightCoordinates, expectedRight)) issues.push(`sharedEdge.right.chunkId: expected chunk:${expectedRight[0]}:${expectedRight[1]}`);
    if (pair.right.edge !== rule.opposite) issues.push(`sharedEdge.right.edge: expected ${rule.opposite}`);
  }
  if (pair.left.samples.length !== expectedSamples || pair.right.samples.length !== expectedSamples) {
    issues.push(`sharedEdge.samples: both edges must contain ${expectedSamples} samples`);
  } else {
    const leftBytes = float32Bytes(pair.left.samples);
    const rightBytes = float32Bytes(pair.right.samples);
    if (!leftBytes.equals(rightBytes)) issues.push('sharedEdge.samples: float32 samples are not bit-identical');
  }
  const leftHash = float32EdgeHash(pair.left.samples);
  const rightHash = float32EdgeHash(pair.right.samples);
  if (pair.left.payloadHash && pair.left.payloadHash !== leftHash) issues.push('sharedEdge.left.payloadHash: does not match samples');
  if (pair.right.payloadHash && pair.right.payloadHash !== rightHash) issues.push('sharedEdge.right.payloadHash: does not match samples');
  if (issues.length > 0) throw new WorldClawValidationError(issues);
  return { valid: true, sha256: leftHash, sampleCount: expectedSamples };
}

export async function assertLinkedSpecificationFilesExist(rootDir, worldSpec) {
  const issues = [];
  for (const [key, linkedPath] of Object.entries(worldSpec.linkedSpecifications)) {
    try {
      await access(path.resolve(rootDir, linkedPath));
    } catch {
      issues.push(`worldSpec.linkedSpecifications.${key}: file does not exist (${linkedPath})`);
    }
  }
  if (issues.length > 0) throw new WorldClawValidationError(issues);
  return { valid: true };
}
