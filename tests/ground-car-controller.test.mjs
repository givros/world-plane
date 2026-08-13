import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const FIXED_STEP = 1 / 120;

let vite;
let GroundCarController;

before(async () => {
  vite = await createServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  ({ GroundCarController } = await vite.ssrLoadModule(
    '/src/systems/GroundCarController.ts',
  ));
});

after(async () => {
  await vite?.close();
});

function intent(overrides = {}) {
  return {
    throttle: 0,
    pitch: 0,
    roll: 0,
    yaw: 0,
    brake: false,
    ...overrides,
  };
}

function createController(surfaceHeightAt = () => 0) {
  const root = new THREE.Object3D();
  const wheelPivots = Array.from({ length: 4 }, () => new THREE.Object3D());
  const controller = new GroundCarController(root, {
    surfaceHeightAt,
    wheelPivots,
    wheelbase: 2.441834,
    wheelRadius: 0.379796,
  });
  controller.setEnabled(true);
  return { controller, root, wheelPivots };
}

function advance(controller, seconds, input, delta = FIXED_STEP) {
  const updates = Math.round(seconds / delta);
  for (let index = 0; index < updates; index += 1) {
    controller.update(delta, input);
  }
  return controller.state;
}

test('Q and A steer left while D steers right for a +Z-forward car', () => {
  const left = createController();
  const right = createController();
  const leftState = advance(left.controller, 1.2, intent({ throttle: 1, roll: -1 }));
  const rightState = advance(right.controller, 1.2, intent({ throttle: 1, roll: 1 }));

  assert.ok(leftState.steeringAngle > 0.1);
  assert.ok(leftState.yaw > 0.1);
  assert.ok(leftState.position.x > 0.2, 'Q/A must turn toward visual left (+X).');
  assert.ok(rightState.steeringAngle < -0.1);
  assert.ok(rightState.yaw < -0.1);
  assert.ok(rightState.position.x < -0.2, 'D must turn toward visual right (-X).');
});

test('braking dissipates momentum over time and S then selects reverse', () => {
  const { controller } = createController();
  const moving = advance(controller, 1, intent({ throttle: 1 }));
  assert.ok(moving.speed > 7);
  const movingSpeed = moving.speed;
  const movingZ = moving.position.z;

  const firstBrakeStep = controller.update(FIXED_STEP, intent({ brake: true }));
  assert.ok(firstBrakeStep.speed > 0);
  assert.ok(firstBrakeStep.speed < movingSpeed);
  const stopped = advance(controller, 0.5, intent({ brake: true }));
  assert.equal(stopped.speed, 0);

  const reverse = advance(controller, 0.8, intent({ throttle: -1 }));
  assert.ok(reverse.speed < -3);
  assert.equal(reverse.gear, 'reverse');
  assert.ok(reverse.position.z < movingZ);
});

test('four-wheel terrain support follows a plane without tire penetration', () => {
  const terrain = (x, z) => x * 0.04 + z * 0.025;
  const { controller, root } = createController(terrain);
  controller.update(FIXED_STEP, intent());

  const halfTrack = 0.84;
  const halfWheelbase = 2.441834 * 0.5;
  const localContacts = [
    new THREE.Vector3(-halfTrack, 0, halfWheelbase),
    new THREE.Vector3(halfTrack, 0, halfWheelbase),
    new THREE.Vector3(-halfTrack, 0, -halfWheelbase),
    new THREE.Vector3(halfTrack, 0, -halfWheelbase),
  ];
  root.updateMatrixWorld(true);
  const clearances = localContacts.map((contact) => {
    const world = root.localToWorld(contact.clone());
    return world.y - terrain(world.x, world.z);
  });
  assert.ok(Math.min(...clearances) > -1e-5);
  assert.ok(Math.max(...clearances) < 0.01);
  assert.ok(controller.state.pitch < 0);
  assert.ok(controller.state.roll > 0);
});

test('fixed-step driving is stable across render update sizes', () => {
  const fine = createController();
  const coarse = createController();
  const input = intent({ throttle: 1, roll: 0.35 });
  const fineState = advance(fine.controller, 2, input, FIXED_STEP);
  const coarseState = advance(coarse.controller, 2, input, 1 / 30);

  assert.ok(fineState.position.distanceTo(coarseState.position) < 1e-6);
  assert.ok(Math.abs(fineState.speed - coarseState.speed) < 1e-8);
  assert.ok(Math.abs(fineState.yaw - coarseState.yaw) < 1e-8);
  assert.ok(Math.abs(fineState.wheelRotation - coarseState.wheelRotation) < 1e-8);
});
