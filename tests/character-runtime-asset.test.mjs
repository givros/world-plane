import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHARACTER_DIR = path.join(PROJECT_ROOT, 'src', 'assets', 'character');
const REPORT_PATH = path.join(CHARACTER_DIR, 'CharacterRuntime_export.json');
const RUNTIME_GLB_PATH = path.join(CHARACTER_DIR, 'CharacterRuntime.glb');
const SOURCE_BLEND_PATH = path.join(CHARACTER_DIR, 'CharacterBase.blend');
const PLAYABLE_CHARACTER_PATH = path.join(
  PROJECT_ROOT,
  'src',
  'entities',
  'PlayableCharacter.ts',
);

const EXPECTED_ANIMATIONS = ['Idle', 'Walk', 'Run', 'Jump'];
const EXPECTED_NODES = ['CharacterBase', 'CharacterRig', 'LongSleeveShirt', 'Pants'];
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK_TYPE = 0x4e4f534a;

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function parseGlb(buffer) {
  assert.ok(buffer.length >= 20, 'The runtime GLB is too short to contain a valid header.');
  assert.equal(buffer.readUInt32LE(0), GLB_MAGIC, 'The runtime asset is not a GLB file.');
  assert.equal(buffer.readUInt32LE(4), 2, 'The runtime asset must use glTF 2.0.');
  assert.equal(
    buffer.readUInt32LE(8),
    buffer.length,
    'The GLB header length must match the checked file.',
  );

  let jsonChunk;
  let offset = 12;
  while (offset < buffer.length) {
    assert.ok(offset + 8 <= buffer.length, 'The GLB contains a truncated chunk header.');
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    assert.ok(chunkEnd <= buffer.length, 'The GLB contains a truncated chunk payload.');
    if (chunkType === JSON_CHUNK_TYPE) {
      assert.equal(jsonChunk, undefined, 'The GLB must contain one JSON chunk.');
      jsonChunk = buffer.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd;
  }

  assert.equal(offset, buffer.length, 'The GLB chunk table must consume the complete file.');
  assert.ok(jsonChunk, 'The runtime GLB does not contain a JSON chunk.');
  return JSON.parse(jsonChunk.toString('utf8').replace(/[\u0000\u0020]+$/u, ''));
}

function findNonEmptyExtensionMaps(value, location = '$', matches = []) {
  if (!value || typeof value !== 'object') return matches;
  if (
    !Array.isArray(value)
    && Object.hasOwn(value, 'extensions')
    && value.extensions
    && Object.keys(value.extensions).length > 0
  ) {
    matches.push(`${location}.extensions`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findNonEmptyExtensionMaps(entry, `${location}[${index}]`, matches));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      findNonEmptyExtensionMaps(entry, `${location}.${key}`, matches);
    }
  }
  return matches;
}

test('the CharacterRuntime export report records a canonical, unchanged source', async () => {
  const report = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
  const sourceBlend = await readFile(SOURCE_BLEND_PATH);

  assert.equal(report.passed, true);
  assert.equal(report.source_unchanged, true);
  assert.equal(report.source_saved, false);
  assert.equal(report.source_sha256_before, report.source_sha256_after);
  assert.equal(sha256(sourceBlend), report.source_sha256_after);
  assert.equal(path.basename(report.source_blend), 'CharacterBase.blend');

  for (const [label, blends] of [
    ['before', report.source_blends_before],
    ['after', report.source_blends_after],
  ]) {
    assert.ok(Array.isArray(blends), `The ${label} canonical blend list must be recorded.`);
    assert.equal(blends.length, 1, `Exactly one canonical blend must exist ${label} export.`);
    assert.equal(path.basename(blends[0]), 'CharacterBase.blend');
  }
  assert.deepEqual(report.source_blends_before, report.source_blends_after);

  assert.deepEqual(sorted(report.glb.animation_names), sorted(EXPECTED_ANIMATIONS));
  assert.deepEqual(sorted(Object.keys(report.glb.animations)), sorted(EXPECTED_ANIMATIONS));
  assert.equal(report.glb.draco, false);
  assert.deepEqual(report.glb.extensions_used, []);
  assert.deepEqual(report.glb.extensions_required, []);
  assert.deepEqual(report.glb.skin_joint_counts, [49]);
  assert.equal(report.source.bone_count, 49);
});

test('the checked runtime GLB contains only the four required clips and an uncompressed 49-joint skin', async () => {
  const [reportText, glbBuffer] = await Promise.all([
    readFile(REPORT_PATH, 'utf8'),
    readFile(RUNTIME_GLB_PATH),
  ]);
  const report = JSON.parse(reportText);
  const gltf = parseGlb(glbBuffer);

  assert.equal(path.basename(report.runtime_glb), 'CharacterRuntime.glb');
  assert.equal(glbBuffer.length, report.runtime_glb_bytes);
  assert.equal(sha256(glbBuffer), report.runtime_glb_sha256);
  assert.deepEqual(sorted(gltf.animations.map((animation) => animation.name)), sorted(EXPECTED_ANIMATIONS));
  assert.deepEqual(gltf.extensionsUsed ?? [], []);
  assert.deepEqual(gltf.extensionsRequired ?? [], []);
  assert.deepEqual(findNonEmptyExtensionMaps(gltf), []);
  assert.doesNotMatch(JSON.stringify(gltf), /KHR_draco_mesh_compression/i);

  assert.equal(gltf.skins.length, 1);
  assert.equal(gltf.skins[0].joints.length, 49);
  const nodeNames = new Set(gltf.nodes.map((node) => node.name).filter(Boolean));
  for (const nodeName of EXPECTED_NODES) {
    assert.ok(nodeNames.has(nodeName), `The runtime GLB is missing ${nodeName}.`);
  }
});

test('PlayableCharacter uses the single GLTF loading path', async () => {
  const source = await readFile(PLAYABLE_CHARACTER_PATH, 'utf8');

  assert.match(source, /\bGLTFLoader\b/);
  assert.doesNotMatch(source, /\bFBXLoader\b/);
  assert.doesNotMatch(source, /\bDRACOLoader\b/);
});
