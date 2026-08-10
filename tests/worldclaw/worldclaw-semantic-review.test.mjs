import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import {
  renderSemanticReview,
  SEMANTIC_REVIEW_IMAGE_DIMENSIONS,
} from '../../scripts/worldclaw/render-semantic-map.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const REGION_GRAPH = path.join(ROOT, 'data/world/region_graph.json');
const ASSET_REGISTRY = path.join(ROOT, 'data/world/asset_registry.json');
const PILOT_DESCRIPTOR = path.join(ROOT, 'data/world/pilots/chunk_0_1.json');

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function createReadyDescriptor(base) {
  const descriptor = structuredClone(base);
  const heightSamples = [];
  for (let z = 0; z < 41; z += 1) {
    for (let x = 0; x < 41; x += 1) {
      heightSamples.push(Math.fround((x - 20) * 0.1 + (z - 20) * 0.05));
    }
  }
  descriptor.runtimeRecordStatus = 'ready';
  descriptor.runtimeRecord = {
    ...descriptor.runtimeRecordIdentity,
    heightSamples,
    heightHash: 'fnv1a32:11111111',
    contentHash: 'fnv1a32:22222222',
  };
  descriptor.terrain.mode = 'authored-float32-grid';
  descriptor.prototypeBatches = [
    {
      assetId: 'proto-biome-rock',
      transforms: [{
        translation: [-500, 0, -500],
        rotation: [0, 0, 0, 1],
        scale: [2, 2, 2],
        colorLinearRgb: [0.25, 0.25, 0.25],
      }],
    },
    {
      assetId: 'proto-biome-deadwood',
      transforms: [{
        translation: [500, 0, 500],
        rotation: [0, 0, 0, 1],
        scale: [2, 5, 2],
        colorLinearRgb: [0.2, 0.14, 0.08],
      }],
    },
  ];
  return descriptor;
}

test('bounded semantic review output is deterministic, exact-sized, and explicitly non-runtime', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'planes3d-semantic-review-'));
  try {
    const descriptorPath = path.join(temporaryDirectory, 'ready-descriptor.json');
    const outputA = path.join(temporaryDirectory, 'first');
    const outputB = path.join(temporaryDirectory, 'second');
    const descriptor = createReadyDescriptor(await readJson(PILOT_DESCRIPTOR));
    await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');

    const common = {
      root: ROOT,
      descriptor: descriptorPath,
      regionGraph: REGION_GRAPH,
      assetRegistry: ASSET_REGISTRY,
    };
    const first = await renderSemanticReview({ ...common, out: outputA });
    const second = await renderSemanticReview({ ...common, out: outputB });

    assert.deepEqual(first, second);
    assert.equal(first.scope, 'bounded-review-only');
    assert.equal(first.globalMapClaimed, false);
    assert.equal(first.runtimeLoaded, false);
    assert.equal(first.axes.imageX, 'left-to-right is -X to +X');
    assert.equal(first.axes.imageY, 'top-to-bottom is -Z to +Z');
    assert.equal(first.semanticWindow.chunks.length, 9);
    assert.deepEqual(first.semanticWindow.chunkRange, { x: [-1, 1], z: [0, 2] });
    assert.equal(first.terrain.samplesPerSide, 41);
    assert.equal(first.terrain.cells, 1600);
    assert.match(first.terrain.triangleSplit, /fractionX\+fractionZ<=1/);
    assert.equal(first.placements.total, 2);
    assert.deepEqual(first.placements.countsByAsset, {
      'proto-biome-rock': 1,
      'proto-biome-deadwood': 1,
    });
    assert.equal(first.landingCorridor.status, 'found');
    assert.equal(first.landingCorridor.reviewOnly, true);
    assert.equal(first.landingCorridor.lengthMeters, 160);
    assert.equal(first.landingCorridor.widthMeters, 30);
    assert.ok(first.landingCorridor.edgeMarginMeters >= 96);
    assert.ok(first.landingCorridor.maximumSlopeDegrees <= 4);
    assert.ok(first.landingCorridor.minimumPlacementFootprintClearanceMeters >= 0);

    for (const [fileName, [expectedWidth, expectedHeight]] of Object.entries(SEMANTIC_REVIEW_IMAGE_DIMENSIONS)) {
      const firstBytes = await readFile(path.join(outputA, fileName));
      const secondBytes = await readFile(path.join(outputB, fileName));
      assert.deepEqual(firstBytes, secondBytes, `${fileName} must be byte-identical`);
      const png = PNG.sync.read(firstBytes);
      assert.equal(png.width, expectedWidth, `${fileName} width`);
      assert.equal(png.height, expectedHeight, `${fileName} height`);
    }
    assert.deepEqual(
      await readFile(path.join(outputA, 'report.json')),
      await readFile(path.join(outputB, 'report.json')),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('semantic review fails clearly when the runtime record is not ready', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'planes3d-semantic-deferred-'));
  try {
    const descriptorPath = path.join(temporaryDirectory, 'deferred-descriptor.json');
    const deferred = await readJson(PILOT_DESCRIPTOR);
    deferred.runtimeRecordStatus = 'identity-only-height-export-deferred';
    deferred.runtimeRecord = null;
    deferred.terrain.mode = 'procedural-identity';
    await writeFile(descriptorPath, `${JSON.stringify(deferred, null, 2)}\n`, 'utf8');
    await assert.rejects(
      () => renderSemanticReview({
        root: ROOT,
        descriptor: descriptorPath,
        regionGraph: REGION_GRAPH,
        assetRegistry: ASSET_REGISTRY,
      }),
      /not review-ready: runtimeRecordStatus must be "ready"/,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
