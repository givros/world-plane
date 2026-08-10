import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const FIXED_STEP = 1 / 120;
const FORWARD = new THREE.Vector3(0, 0, 1);

let vite;
let GroundCharacterController;

before(async () => {
  vite = await createServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  ({ GroundCharacterController } = await vite.ssrLoadModule(
    '/src/systems/GroundCharacterController.ts',
  ));
});

after(async () => {
  await vite?.close();
});

function intent(overrides = {}) {
  return {
    moveX: 0,
    moveZ: 0,
    sprint: false,
    jump: false,
    ...overrides,
  };
}

function createController(options = {}) {
  const root = new THREE.Object3D();
  const controller = new GroundCharacterController(root, {
    surfaceHeightAt: () => 0,
    ...options,
  });
  controller.setEnabled(true);
  return { controller, root };
}

function advance(controller, seconds, movement, cameraForward = FORWARD, delta = FIXED_STEP) {
  const updates = Math.round(seconds / delta);
  for (let index = 0; index < updates; index += 1) {
    controller.update(delta, movement, cameraForward);
  }
  return controller.state;
}

test('movement is camera-relative and diagonal input is normalized', () => {
  const forwardRig = createController();
  const diagonalRig = createController();
  const rotatedRig = createController();

  const forward = advance(forwardRig.controller, 2, intent({ moveZ: 1 }));
  const diagonal = advance(
    diagonalRig.controller,
    2,
    intent({ moveX: 1, moveZ: 1 }),
  );
  const rotated = advance(
    rotatedRig.controller,
    2,
    intent({ moveZ: 1 }),
    new THREE.Vector3(1, 0.4, 0),
  );

  assert.ok(forward.position.z > 3.5);
  assert.ok(Math.abs(forward.position.x) < 1e-8);
  assert.ok(rotated.position.x > 3.5);
  assert.ok(Math.abs(rotated.position.z) < 1e-8);
  assert.ok(Math.abs(diagonal.position.length() - forward.position.length()) < 1e-7);
  assert.equal(forward.animation, 'walk');
  assert.equal(forward.grounded, true);
});

test('Q and A move left while D moves right relative to the camera', () => {
  const leftRig = createController();
  const rightRig = createController();
  const cameraForward = new THREE.Vector3(0, 0, 1);
  const cameraRight = new THREE.Vector3(-1, 0, 0);

  const left = advance(
    leftRig.controller,
    0.75,
    intent({ moveX: -1 }),
    cameraForward,
  );
  const right = advance(
    rightRig.controller,
    0.75,
    intent({ moveX: 1 }),
    cameraForward,
  );

  assert.ok(left.position.dot(cameraRight) < -0.5, 'Q/A must move toward screen-left.');
  assert.ok(right.position.dot(cameraRight) > 0.5, 'D must move toward screen-right.');
});

test('sprint reaches a higher speed and selects the run animation', () => {
  const walkingRig = createController();
  const runningRig = createController();
  const walking = advance(walkingRig.controller, 1, intent({ moveZ: 1 }));
  const running = advance(
    runningRig.controller,
    1,
    intent({ moveZ: 1, sprint: true }),
  );

  assert.ok(running.speed > walking.speed * 1.8);
  assert.ok(running.position.z > walking.position.z * 1.7);
  assert.equal(running.sprinting, true);
  assert.equal(running.animation, 'run');
});

test('the feet follow traversable terrain and reject an excessive slope', () => {
  const traversableRig = createController({
    surfaceHeightAt: (_x, z) => z * 0.1,
  });
  const traversed = advance(traversableRig.controller, 1.5, intent({ moveZ: 1 }));

  assert.ok(traversed.position.z > 2);
  assert.ok(Math.abs(traversed.position.y - traversed.position.z * 0.1) < 1e-8);
  assert.equal(traversed.blockedBySlope, false);

  const steepRig = createController({
    surfaceHeightAt: (_x, z) => Math.max(0, z) * 4,
  });
  const blocked = advance(steepRig.controller, 0.5, intent({ moveZ: 1 }));
  assert.ok(Math.abs(blocked.position.z) < 1e-8);
  assert.equal(blocked.blockedBySlope, true);
  assert.equal(blocked.speed, 0);
});

test('jump is edge-triggered, rises above terrain, and lands once while held', () => {
  const { controller } = createController();
  const jumping = intent({ moveZ: 1, jump: true });
  let maximumHeight = 0;
  let landingCount = 0;
  let wasGrounded = true;

  for (let step = 0; step < 360; step += 1) {
    const state = controller.update(FIXED_STEP, jumping, FORWARD);
    maximumHeight = Math.max(maximumHeight, state.position.y);
    if (!wasGrounded && state.grounded) landingCount += 1;
    wasGrounded = state.grounded;
  }

  assert.ok(maximumHeight > 0.7);
  assert.equal(controller.state.grounded, true);
  assert.equal(controller.state.position.y, 0);
  assert.equal(landingCount, 1);
});

test('fixed-step results are stable across render update sizes', () => {
  const fineRig = createController();
  const coarseRig = createController();
  const movement = intent({ moveX: -1, moveZ: 1, sprint: true });
  const fine = advance(fineRig.controller, 2, movement, FORWARD, 1 / 120);
  const coarse = advance(coarseRig.controller, 2, movement, FORWARD, 1 / 30);

  assert.ok(fine.position.distanceTo(coarse.position) < 1e-8);
  assert.ok(Math.abs(fine.speed - coarse.speed) < 1e-8);
  assert.ok(Math.abs(fine.yaw - coarse.yaw) < 1e-8);
});

test('disable and reset clear momentum without changing the configured spawn', () => {
  const spawn = new THREE.Vector3(4, 99, -3);
  const { controller } = createController({
    spawnPosition: spawn,
    spawnYaw: 0.6,
    surfaceHeightAt: (x, z) => x * 0.05 - z * 0.02,
  });
  advance(controller, 0.75, intent({ moveZ: 1, sprint: true }));
  controller.setEnabled(false);

  assert.equal(controller.state.enabled, false);
  assert.equal(controller.state.speed, 0);
  assert.equal(controller.state.grounded, true);
  assert.equal(controller.state.position.y, controller.state.terrainHeight);

  controller.reset();
  assert.ok(Math.abs(controller.state.position.x - spawn.x) < 1e-8);
  assert.ok(Math.abs(controller.state.position.z - spawn.z) < 1e-8);
  assert.ok(Math.abs(controller.state.yaw - 0.6) < 1e-8);
  assert.equal(controller.state.animation, 'idle');
});
