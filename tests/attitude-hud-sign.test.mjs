import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const hudSource = await readFile(
  new URL('../src/systems/FlightHud.ts', import.meta.url),
  'utf8',
);
const stylesSource = await readFile(
  new URL('../src/styles.css', import.meta.url),
  'utf8',
);

function readAssignmentExpression(variableName) {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = hudSource.match(new RegExp(`const\\s+${escapedName}\\s*=\\s*([^;]+);`));
  assert.ok(match, `Expected to find the ${variableName} assignment in FlightHud.ts`);
  return match[1];
}

function evaluateHudExpression(expression, snapshot) {
  return Function(
    'snapshot',
    'Math',
    `'use strict'; return (${expression});`,
  )(snapshot, Math);
}

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('attitude horizon keeps the corrected bank sign before CSS rotation', () => {
  const bankExpression = readAssignmentExpression('bankDegrees');

  assertClose(
    evaluateHudExpression(bankExpression, { bank: 15 * Math.PI / 180 }),
    15,
  );
  assertClose(
    evaluateHudExpression(bankExpression, { bank: -15 * Math.PI / 180 }),
    -15,
  );
  assert.equal(evaluateHudExpression(bankExpression, { bank: Math.PI / 2 }), 50);
  assert.equal(evaluateHudExpression(bankExpression, { bank: -Math.PI / 2 }), -50);
});

test('nose-up pitch still moves the horizon down and remains clamped', () => {
  const pitchExpression = readAssignmentExpression('pitchOffset');

  assertClose(evaluateHudExpression(pitchExpression, { pitch: 0.2 }), 11.6);
  assertClose(evaluateHudExpression(pitchExpression, { pitch: -0.2 }), -11.6);
  assert.equal(evaluateHudExpression(pitchExpression, { pitch: 2 }), 26);
  assert.equal(evaluateHudExpression(pitchExpression, { pitch: -2 }), -26);
});

test('the moving horizon consumes the signed HUD variables directly', () => {
  const horizonRule = stylesSource.match(/#attitude-horizon\s*\{([\s\S]*?)\}/);
  assert.ok(horizonRule, 'Expected to find the #attitude-horizon CSS rule');
  assert.match(
    horizonRule[1],
    /transform:\s*translateY\(var\(--attitude-pitch\)\)\s*rotate\(var\(--attitude-bank\)\)\s*;/,
  );
});
