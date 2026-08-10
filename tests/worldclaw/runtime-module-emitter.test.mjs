import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import typescript from 'typescript';
import {
  canonicalSha256,
  emitRuntimeModule,
  loadRuntimeModuleModel,
  renderRuntimeModule,
  RuntimeModuleEmitterError,
} from '../../scripts/worldclaw/emit-runtime-module.mjs';

function createRuntimeRecord({ chunkX, chunkZ, biomeId }) {
  return {
    schemaVersion: '1.0.0',
    generatorVersion: 'worldclaw-offline-v1',
    dataRevision: 'fixture-revision',
    worldSeed: 119278167,
    chunkX,
    chunkZ,
    biomeId,
    heightSamples: Array.from({ length: 1681 }, (_, index) => Math.fround(index * 0.001)),
    heightHash: `fnv1a32:${Math.abs(chunkX * 97 + chunkZ).toString(16).padStart(8, '0')}`,
    contentHash: `fnv1a32:${Math.abs(chunkX * 193 + chunkZ).toString(16).padStart(8, '0')}`,
  };
}

function createDescriptor({ id, descriptorPath, chunkX, chunkZ, biomeId, ready = true }) {
  return {
    descriptorId: id,
    runtimeRecordStatus: ready ? 'ready' : 'identity-only-height-export-deferred',
    runtimeRecord: ready ? createRuntimeRecord({ chunkX, chunkZ, biomeId }) : null,
    prototypeBatches: ready ? [{
      assetId: 'proto-biome-rock',
      transforms: [{
        translation: [0, 1, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
        colorLinearRgb: [0.25, Math.fround(0.3), Math.fround(0.2)],
      }],
    }] : [],
    artifactPaths: { descriptor: descriptorPath },
  };
}

function decodeFloat32Base64(payload) {
  const buffer = Buffer.from(payload, 'base64');
  const values = [];
  for (let offset = 0; offset < buffer.length; offset += Float32Array.BYTES_PER_ELEMENT) {
    values.push(buffer.readFloatLE(offset));
  }
  return values;
}

function assertExactFloatSequence(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} length`);
  actual.forEach((value, index) => {
    assert.ok(Object.is(value, expected[index]), `${label}[${index}]`);
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createFixture({
  firstReady = true,
  includeIgnoredNonReady = false,
  omitFirstDescriptor = false,
} = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'planes3d-runtime-emitter-'));
  const firstPath = 'data/world/regions/sunlit-meadow/chunk_-12_-5.json';
  const secondPath = 'data/world/regions/alpine-peaks/chunk_-20_-8.json';
  const first = createDescriptor({
    id: 'representative-sunlit-meadow',
    descriptorPath: firstPath,
    chunkX: -12,
    chunkZ: -5,
    biomeId: 'sunlit-meadow',
    ready: firstReady,
  });
  const second = createDescriptor({
    id: 'representative-alpine-peaks',
    descriptorPath: secondPath,
    chunkX: -20,
    chunkZ: -8,
    biomeId: 'alpine-peaks',
    ready: true,
  });
  if (!omitFirstDescriptor) await writeJson(path.join(rootDir, firstPath), first);
  await writeJson(path.join(rootDir, secondPath), second);

  const entries = [
    {
      id: first.descriptorId,
      path: firstPath,
      biomeId: 'sunlit-meadow',
      chunkCoordinates: [-12, -5],
      ready: true,
      runtimeRecordStatus: 'ready',
      sha256: canonicalSha256(first),
    },
    {
      id: second.descriptorId,
      path: secondPath,
      biomeId: 'alpine-peaks',
      chunkCoordinates: [-20, -8],
      ready: true,
      runtimeRecordStatus: 'ready',
      sha256: canonicalSha256(second),
    },
  ];
  const coverage = [
    { biomeId: 'sunlit-meadow', representativeCount: 1, readyCount: 1 },
    { biomeId: 'alpine-peaks', representativeCount: 1, readyCount: 1 },
  ];
  if (includeIgnoredNonReady) {
    entries.push({
      id: 'representative-sahara-pending',
      path: 'data/world/regions/sahara-dunes/chunk_-30_-9.json',
      biomeId: 'sahara-dunes',
      chunkCoordinates: [-30, -9],
      ready: false,
      runtimeRecordStatus: 'identity-only-height-export-deferred',
      sha256: 'f'.repeat(64),
    });
    coverage.push({ biomeId: 'sahara-dunes', representativeCount: 1, readyCount: 0 });
  }
  const manifestCore = {
    schemaVersion: '1.0.0',
    compiler: { id: 'fixture', version: '1.1.0', deterministic: true },
    chunkDescriptors: entries,
    biomeCoverage: coverage,
  };
  const manifest = { ...manifestCore, manifestHash: canonicalSha256(manifestCore) };
  await writeJson(path.join(rootDir, 'data/world/compiled/world_manifest.json'), manifest);
  return {
    rootDir,
    firstPath,
    secondPath,
    first,
    second,
    outputPath: path.join(rootDir, 'src/world/generated/CompiledWorldManifest.generated.ts'),
  };
}

async function removeFixture(fixture) {
  await rm(fixture.rootDir, { recursive: true, force: true });
}

test('renders deterministic base-safe TypeScript from sorted compact Float32 payloads', async () => {
  const fixture = await createFixture({ includeIgnoredNonReady: true });
  try {
    const firstModel = await loadRuntimeModuleModel({ rootDir: fixture.rootDir });
    const secondModel = await loadRuntimeModuleModel({ rootDir: fixture.rootDir });
    const firstSource = renderRuntimeModule(firstModel);
    const secondSource = renderRuntimeModule(secondModel);
    assert.equal(firstSource, secondSource);
    assert.deepEqual(firstModel.descriptors.map(({ summary }) => summary.path), [
      fixture.secondPath,
      fixture.firstPath,
    ]);
    assert.ok(firstSource.indexOf('"chunkKey":"-20:-8"') < firstSource.indexOf('"chunkKey":"-12:-5"'));
    assert.match(firstSource, /import type \{[\s\S]*AuthoredWorldChunkRecord[\s\S]*\} from "\.\.\/WorldChunkSource";/);
    assert.match(firstSource, /PACKED_COMPILED_DESCRIPTORS/);
    assert.match(firstSource, /heightSamplesFloat32Base64/);
    assert.match(firstSource, /transformsFloat32Base64/);
    assert.match(firstSource, /globalThis\.atob/);
    assert.match(firstSource, /COMPILED_AUTHORED_WORLD_CHUNK_RECORDS/);
    assert.match(firstSource, /COMPILED_PROTOTYPE_BATCHES_BY_CHUNK/);
    assert.match(firstSource, /COMPILED_WORLD_DESCRIPTOR_SUMMARIES/);
    assert.match(firstSource, /COMPILED_WORLD_BIOME_COVERAGE/);
    assert.doesNotMatch(firstSource, /\?raw|JSON\.parse/);
    assert.doesNotMatch(firstSource, /fetch\s*\(|https?:\/\/|generatedAt|compiledAt|timestamp|api[_-]?key|secret/i);
    assert.doesNotMatch(firstSource, new RegExp(fixture.rootDir.replaceAll('\\', '\\\\'), 'i'));
    const transpiled = typescript.transpileModule(firstSource, {
      compilerOptions: {
        target: typescript.ScriptTarget.ES2022,
        module: typescript.ModuleKind.ESNext,
      },
      reportDiagnostics: true,
    });
    const syntaxErrors = (transpiled.diagnostics ?? [])
      .filter(({ category }) => category === typescript.DiagnosticCategory.Error);
    assert.deepEqual(syntaxErrors, []);
    assert.deepEqual(firstModel.biomeCoverage, [
      { biomeId: 'alpine-peaks', representativeCount: 1, readyCount: 1 },
      { biomeId: 'sahara-dunes', representativeCount: 1, readyCount: 0 },
      { biomeId: 'sunlit-meadow', representativeCount: 1, readyCount: 1 },
    ]);
    assert.equal(firstModel.descriptors.length, 2);
    assert.equal(firstModel.descriptorSummaries.length, 3);
    firstModel.descriptors.forEach((descriptor) => {
      const packed = descriptor.packedDescriptor;
      assert.equal(packed.chunkKey, descriptor.chunkKey);
      assert.equal(packed.runtimeRecord.heightSampleCount, 1681);
      assertExactFloatSequence(
        decodeFloat32Base64(packed.runtimeRecord.heightSamplesFloat32Base64),
        descriptor.runtimeRecord.heightSamples,
        `${descriptor.chunkKey} heights`,
      );
      assert.equal(packed.prototypeBatches.length, descriptor.prototypeBatches.length);
      packed.prototypeBatches.forEach((packedBatch, batchIndex) => {
        const sourceBatch = descriptor.prototypeBatches[batchIndex];
        assert.equal(packedBatch.assetId, sourceBatch.assetId);
        assert.equal(packedBatch.transformCount, sourceBatch.transforms.length);
        assertExactFloatSequence(
          decodeFloat32Base64(packedBatch.transformsFloat32Base64),
          sourceBatch.transforms.flatMap((transform) => [
            ...transform.translation,
            ...transform.rotation,
            ...transform.scale,
            ...transform.colorLinearRgb,
          ]),
          `${descriptor.chunkKey} ${packedBatch.assetId} transforms`,
        );
      });
    });
  } finally {
    await removeFixture(fixture);
  }
});

test('writes an --out target and --check compares exact bytes without mutation', async () => {
  const fixture = await createFixture();
  try {
    const written = await emitRuntimeModule({ rootDir: fixture.rootDir });
    assert.equal(written.checked, false);
    assert.equal(await readFile(fixture.outputPath, 'utf8'), written.source);

    const checked = await emitRuntimeModule({ rootDir: fixture.rootDir, check: true });
    assert.equal(checked.checked, true);
    assert.equal(checked.source, written.source);

    await writeFile(fixture.outputPath, `${written.source}// drift\n`, 'utf8');
    await assert.rejects(
      emitRuntimeModule({ rootDir: fixture.rootDir, check: true }),
      (error) => error instanceof RuntimeModuleEmitterError && /module is stale/.test(error.message),
    );

    const alternateOutput = 'generated/runtime.ts';
    const alternate = await emitRuntimeModule({
      rootDir: fixture.rootDir,
      outputPath: alternateOutput,
    });
    assert.equal(alternate.outputPath, path.join(fixture.rootDir, alternateOutput));
    assert.match(alternate.source, /from "\.\.\/src\/world\/WorldChunkSource";/);
    assert.doesNotMatch(alternate.source, /\?raw|JSON\.parse/);
  } finally {
    await removeFixture(fixture);
  }
});

test('rejects a manifest-ready descriptor whose runtime record is non-ready or missing', async () => {
  const fixture = await createFixture({ firstReady: false });
  try {
    await assert.rejects(
      loadRuntimeModuleModel({ rootDir: fixture.rootDir }),
      (error) => error instanceof RuntimeModuleEmitterError && /has non-ready status/.test(error.message),
    );
  } finally {
    await removeFixture(fixture);
  }
});

test('rejects missing ready descriptor files and descriptor hash drift', async () => {
  const missingFixture = await createFixture({ omitFirstDescriptor: true });
  try {
    await assert.rejects(
      loadRuntimeModuleModel({ rootDir: missingFixture.rootDir }),
      (error) => error instanceof RuntimeModuleEmitterError && /is missing/.test(error.message),
    );
  } finally {
    await removeFixture(missingFixture);
  }

  const driftFixture = await createFixture();
  try {
    driftFixture.first.prototypeBatches = [];
    await writeJson(path.join(driftFixture.rootDir, driftFixture.firstPath), driftFixture.first);
    await assert.rejects(
      loadRuntimeModuleModel({ rootDir: driftFixture.rootDir }),
      (error) => error instanceof RuntimeModuleEmitterError && /hash mismatch/.test(error.message),
    );
  } finally {
    await removeFixture(driftFixture);
  }
});

test('rejects manifest hash drift before generating code', async () => {
  const fixture = await createFixture();
  try {
    const manifestPath = path.join(fixture.rootDir, 'data/world/compiled/world_manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.compiler.version = 'tampered';
    await writeJson(manifestPath, manifest);
    await assert.rejects(
      loadRuntimeModuleModel({ rootDir: fixture.rootDir }),
      (error) => error instanceof RuntimeModuleEmitterError && /manifest hash mismatch/i.test(error.message),
    );
  } finally {
    await removeFixture(fixture);
  }
});
