import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const FIXED_STEP = 1 / 120;
const DEG_TO_RAD = Math.PI / 180;

let vite;
let ManualFlightController;

before(async () => {
  vite = await createServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  ({ ManualFlightController } = await vite.ssrLoadModule(
    '/src/systems/ManualFlightController.ts',
  ));
});

after(async () => {
  await vite?.close();
});

function neutralIntent(overrides = {}) {
  return {
    throttle: 0,
    pitch: 0,
    roll: 0,
    yaw: 0,
    brake: false,
    ...overrides,
  };
}

function horizontalSpeedAtContact(speed, verticalSpeed) {
  return Math.sqrt(Math.max(0, speed * speed - verticalSpeed * verticalSpeed));
}

function createController({ fullScaleGear = false, surfaceHeightAt = () => 0 } = {}) {
  const root = new THREE.Object3D();
  const propeller = new THREE.Object3D();
  const leftMainWheel = new THREE.Object3D();
  const rightMainWheel = new THREE.Object3D();
  const tailWheel = new THREE.Object3D();

  const mainWheelRadius = fullScaleGear ? 0.52 : 0.5;
  const propellerSafetyRadius = fullScaleGear ? 1.86 : 1.2;
  if (fullScaleGear) {
    propeller.position.set(0, 2.42, 4.34);
    leftMainWheel.position.set(-1.76, mainWheelRadius, 0.72);
    rightMainWheel.position.set(1.76, mainWheelRadius, 0.72);
    tailWheel.position.set(0, 0.2, -4.67);
  } else {
    propeller.position.set(0, 1.55, 2.6);
    leftMainWheel.position.set(-1, mainWheelRadius, 0.45);
    rightMainWheel.position.set(1, mainWheelRadius, 0.45);
    tailWheel.position.set(0, 0.2, -2);
  }

  const controller = new ManualFlightController(
    {
      root,
      propeller,
      mainWheels: [leftMainWheel, rightMainWheel],
      auxiliaryWheel: tailWheel,
    },
    {
      runway: {
        centerlineX: 0,
        surfaceY: 0,
        parkingZ: -112,
        takeoffEndZ: 105,
        touchdownZ: -104,
        finalStopZ: 124,
        width: 100_000,
        southThresholdZ: -100_000,
        northThresholdZ: 100_000,
      },
      mainWheelRadius,
      auxiliaryWheelRadius: 0.2,
      propellerSafetyRadius,
      surfaceHeightAt,
    },
  );

  return { controller, root };
}

function copyState(state) {
  return {
    phase: state.phase,
    running: state.running,
    crashed: state.crashed,
    completed: state.completed,
    onGround: state.onGround,
    speed: state.speed,
    altitude: state.altitude,
    verticalSpeed: state.verticalSpeed,
    throttle: state.throttle,
    pitch: state.pitch,
    bank: state.bank,
    yaw: state.yaw,
    propellerRpm: state.propellerRpm,
    position: state.position.clone(),
  };
}

function advanceUntil(controller, intent, predicate, maximumSteps, failureMessage) {
  for (let step = 0; step < maximumSteps; step += 1) {
    controller.update(FIXED_STEP, intent);
    if (predicate(controller.state)) return copyState(controller.state);
  }
  assert.fail(`${failureMessage}: ${JSON.stringify(copyState(controller.state))}`);
}

function takeOff(controller, { start = false } = {}) {
  if (start) assert.equal(controller.start(), true, 'The first flight should start once.');
  const intent = neutralIntent();
  const airborne = advanceUntil(
    controller,
    intent,
    (state) => {
      intent.throttle = state.throttle < 0.99 ? 1 : 0;
      intent.pitch = state.speed >= 29 ? 1 : 0;
      return !state.onGround || state.crashed;
    },
    4_500,
    'The aircraft did not take off',
  );

  assert.equal(airborne.crashed, false);
  assert.equal(airborne.onGround, false);
  assert.equal(airborne.phase, 'liftoff');
  assert.ok(airborne.speed >= 29);
  return airborne;
}

function establishDescent(controller, { hard = false } = {}) {
  const intent = neutralIntent();
  let previousState = copyState(controller.state);
  let hardSinkEstablished = false;

  for (let step = 0; step < 3_500; step += 1) {
    const state = controller.state;
    if (state.crashed) return previousState;

    const pitchDegrees = state.pitch / DEG_TO_RAD;
    intent.throttle = state.throttle > (hard ? 0.35 : 0.62) ? -1 : 0;
    if (hard) {
      if (!hardSinkEstablished && state.verticalSpeed < -7) hardSinkEstablished = true;
      intent.pitch = hardSinkEstablished
        ? (pitchDegrees < -3.5 ? 1 : 0)
        : -1;
      if (
        state.verticalSpeed < -5.5
        && pitchDegrees >= -4
        && pitchDegrees <= 10
        && state.speed >= 14
        && state.speed <= 56
      ) return copyState(state);
    } else {
      if (state.verticalSpeed > -1.5 && pitchDegrees > -3) intent.pitch = -1;
      else if (state.verticalSpeed < -4.5 || pitchDegrees < -3) intent.pitch = 1;
      else intent.pitch = 0;
      if (
        state.verticalSpeed <= -1
        && state.verticalSpeed >= -4.5
        && pitchDegrees >= -3
        && pitchDegrees <= 12
        && state.speed >= 14
        && state.speed <= 56
      ) return copyState(state);
    }

    previousState = copyState(state);
    controller.update(FIXED_STEP, intent);
  }

  assert.fail(`Could not establish a ${hard ? 'hard' : 'safe'} descent.`);
}

function contactGround(controller, root) {
  root.position.y = 0.08;
  return advanceUntil(
    controller,
    neutralIntent(),
    (state) => state.onGround || state.crashed,
    90,
    'The aircraft did not contact the ground',
  );
}

function landSafely(controller, root) {
  // Give the deterministic probe enough airborne room to settle into a controlled
  // approach without depending on a camera, rendered terrain, or wall-clock time.
  root.position.y = 24;
  controller.update(FIXED_STEP, neutralIntent());
  const beforeContact = establishDescent(controller);
  assert.ok(beforeContact.verticalSpeed >= -4.5 && beforeContact.verticalSpeed <= -1);
  assert.ok(beforeContact.speed >= 14 && beforeContact.speed <= 56);
  assert.ok(Math.abs(beforeContact.bank) <= 18 * DEG_TO_RAD);

  const touchdown = contactGround(controller, root);
  assert.equal(touchdown.crashed, false);
  assert.equal(touchdown.onGround, true);
  assert.equal(touchdown.phase, 'touchdown');
  assert.equal(touchdown.altitude, 0);
  return touchdown;
}

function stopAfterLanding(controller) {
  const intent = neutralIntent({ brake: true });
  return advanceUntil(
    controller,
    intent,
    (state) => {
      intent.throttle = state.throttle > 0.005 ? -1 : 0;
      return state.speed <= 0.01;
    },
    2_500,
    'The aircraft did not come to a full stop',
  );
}

test('safe landing can be followed by a full-stop relaunch and a touch-and-go', () => {
  const { controller, root } = createController();

  const firstLiftoff = takeOff(controller, { start: true });
  assert.ok(firstLiftoff.propellerRpm > 2_000);

  landSafely(controller, root);
  const stopped = stopAfterLanding(controller);
  assert.equal(stopped.crashed, false);
  assert.equal(stopped.completed, false, 'A safe stop must not end manual flight.');
  assert.equal(stopped.running, true, 'Controls must remain active after landing.');
  assert.equal(stopped.onGround, true);
  assert.equal(stopped.speed, 0);

  const secondLiftoff = takeOff(controller);
  assert.equal(secondLiftoff.crashed, false);
  assert.ok(secondLiftoff.position.z > firstLiftoff.position.z);

  const secondTouchdown = landSafely(controller, root);
  assert.ok(secondTouchdown.speed >= 14, 'Touch-and-go must retain usable rolling speed.');

  // Recreate the exact bounce-prone case: after the second valid touchdown the
  // aircraft still has take-off speed, a raised nose, and more than half power.
  // Those three conditions must not bypass the contact guard and turn wheel
  // compression into an instantaneous second liftoff.
  Object.assign(controller, {
    speed: 32,
    pitch: 7 * DEG_TO_RAD,
    throttle: 0.65,
  });
  const touchAndGoIntent = neutralIntent({ pitch: 1 });
  const guardedGroundSteps = 23;
  for (let step = 0; step < guardedGroundSteps; step += 1) {
    controller.update(FIXED_STEP, touchAndGoIntent);
    assert.equal(
      controller.state.onGround,
      true,
      `Touchdown bounced back into flight after only ${(step + 1) * FIXED_STEP}s.`,
    );
    assert.equal(controller.state.crashed, false);
  }

  const guarded = copyState(controller.state);
  assert.ok(guardedGroundSteps * FIXED_STEP < 0.2);
  assert.ok(guarded.speed > 29);
  assert.ok(guarded.pitch > 5 * DEG_TO_RAD);
  assert.ok(guarded.throttle > 0.5);

  const thirdLiftoff = advanceUntil(
    controller,
    touchAndGoIntent,
    (state) => !state.onGround || state.crashed,
    30,
    'Power was reapplied but the touch-and-go did not lift off after the contact guard',
  );
  assert.equal(thirdLiftoff.crashed, false);
  assert.equal(thirdLiftoff.onGround, false);
  assert.equal(thirdLiftoff.phase, 'liftoff');
  assert.ok(thirdLiftoff.position.z > secondTouchdown.position.z);
});

test('residual speed and pitch stay grounded until take-off power is reapplied', () => {
  const { controller, root } = createController();
  takeOff(controller, { start: true });
  landSafely(controller, root);

  Object.assign(controller, {
    speed: 32,
    pitch: 7 * DEG_TO_RAD,
    throttle: 0.35,
  });
  const holdPitchIntent = neutralIntent({ pitch: 1 });

  // Wait beyond the contact guard. Speed and rotation alone must not bounce the
  // aircraft back into flight while power remains below the take-off threshold.
  for (let step = 0; step < 36; step += 1) {
    controller.update(FIXED_STEP, holdPitchIntent);
    assert.equal(controller.state.onGround, true);
    assert.equal(controller.state.crashed, false);
  }
  const lowPowerRoll = copyState(controller.state);
  assert.ok(lowPowerRoll.speed > 29);
  assert.ok(lowPowerRoll.pitch > 5 * DEG_TO_RAD);
  assert.ok(lowPowerRoll.throttle < 0.5);

  const powerIntent = neutralIntent({ throttle: 1, pitch: 1 });
  const liftoff = advanceUntil(
    controller,
    powerIntent,
    (state) => !state.onGround || state.crashed,
    120,
    'The aircraft did not perform a powered touch-and-go',
  );
  assert.equal(liftoff.crashed, false);
  assert.equal(liftoff.phase, 'liftoff');
  assert.ok(liftoff.throttle >= 0.5, 'Liftoff occurred before take-off power was reapplied.');
});

test('an upright mild-sink touchdown is accepted near minimum flight speed', () => {
  const { controller, root } = createController();
  takeOff(controller, { start: true });

  // Cross the post-liftoff contact grace period normally, then place the flight
  // model on a precise boundary approach. TypeScript `private` state is used here
  // intentionally so this regression test does not depend on wall-clock timing or
  // an autopilot that might hide the 11-13 m/s landing classification itself.
  root.position.y = 18;
  for (let step = 0; step < 36; step += 1) {
    controller.update(FIXED_STEP, neutralIntent());
  }

  const approachSpeed = 12.25;
  const sinkRate = -2.1;
  Object.assign(controller, {
    speed: approachSpeed,
    throttle: 0.18,
    pitch: 2 * DEG_TO_RAD,
    bank: 1.5 * DEG_TO_RAD,
    flightPathAngle: Math.asin(sinkRate / approachSpeed),
    verticalSpeed: sinkRate,
  });

  const touchdown = contactGround(controller, root);
  assert.equal(touchdown.crashed, false);
  assert.equal(touchdown.onGround, true);
  assert.equal(touchdown.phase, 'touchdown');
  assert.ok(touchdown.speed >= 11 && touchdown.speed < 13);
  assert.equal(touchdown.altitude, 0);
});

test('a flared touchdown with the production taildragger gear remains landable', () => {
  for (const approachSpeed of [11, 30, 55]) {
    const { controller, root } = createController({ fullScaleGear: true });
    assert.equal(controller.start(), true);

    const sinkRate = -6.2;
    Object.assign(controller, {
      onGround: false,
      hasBeenAirborne: true,
      liftoffSeconds: 1,
      speed: approachSpeed,
      throttle: 0.15,
      pitch: 8 * DEG_TO_RAD,
      bank: 1 * DEG_TO_RAD,
      flightPathAngle: Math.asin(sinkRate / approachSpeed),
      verticalSpeed: sinkRate,
    });
    root.position.set(400, 0.2, 400);

    controller.update(FIXED_STEP, neutralIntent());

    assert.equal(controller.state.crashed, false, `touchdown crashed at ${approachSpeed} m/s`);
    assert.equal(controller.state.onGround, true);
    assert.equal(controller.state.running, true);
    assert.equal(controller.state.phase, 'touchdown');
    assert.equal(controller.state.wheelContact.main, true);
    assert.equal(controller.state.wheelContact.auxiliary, true);
    assert.equal(controller.state.wheelContact.all, true);
    assert.ok(Math.abs(controller.state.pitch) < 0.01 * DEG_TO_RAD);
    assert.ok(Math.abs(controller.state.bank) < 0.01 * DEG_TO_RAD);
  }
});

test('a destructive flared impact settles on all three wheels without ending play', () => {
  const { controller, root } = createController({ fullScaleGear: true });
  assert.equal(controller.start(), true);

  const approachSpeed = 30;
  const sinkRate = -9;
  Object.assign(controller, {
    onGround: false,
    hasBeenAirborne: true,
    liftoffSeconds: 1,
    speed: approachSpeed,
    throttle: 0.15,
    pitch: 8 * DEG_TO_RAD,
    bank: 1 * DEG_TO_RAD,
    flightPathAngle: Math.asin(sinkRate / approachSpeed),
    verticalSpeed: sinkRate,
  });
  root.position.set(400, 0.2, 400);

  controller.update(FIXED_STEP, neutralIntent());

  assert.equal(controller.state.crashed, false);
  assert.equal(controller.state.running, true);
  assert.equal(controller.state.completed, false);
  assert.equal(controller.state.onGround, true);
  assert.equal(controller.state.phase, 'touchdown');
  assert.ok(Math.abs(
    controller.state.speed - horizontalSpeedAtContact(approachSpeed, sinkRate)
  ) < 0.4);
  assert.equal(controller.state.verticalSpeed, 0);
  assert.equal(controller.state.throttle, 0.15);
  assert.equal(controller.state.wheelContact.main, true);
  assert.equal(controller.state.wheelContact.auxiliary, true);
  assert.equal(controller.state.wheelContact.all, true);
  assert.ok(Math.abs(controller.state.pitch) < 0.01 * DEG_TO_RAD);
  assert.ok(Math.abs(controller.state.bank) < 0.01 * DEG_TO_RAD);
});

test('a controlled off-airport touchdown remains valid on moderate terrain', () => {
  const slope = Math.tan(10 * DEG_TO_RAD);
  const surfaceHeightAt = (worldX) => worldX * slope;
  const { controller, root } = createController({ fullScaleGear: true, surfaceHeightAt });
  assert.equal(controller.start(), true);

  const approachSpeed = 30;
  const sinkRate = -2.1;
  Object.assign(controller, {
    onGround: false,
    hasBeenAirborne: true,
    liftoffSeconds: 1,
    speed: approachSpeed,
    throttle: 0.15,
    pitch: 8 * DEG_TO_RAD,
    bank: 0,
    flightPathAngle: Math.asin(sinkRate / approachSpeed),
    verticalSpeed: sinkRate,
  });
  root.position.set(40, surfaceHeightAt(40) + 0.2, 400);

  controller.update(FIXED_STEP, neutralIntent());

  assert.equal(controller.state.crashed, false);
  assert.equal(controller.state.onGround, true);
  assert.equal(controller.state.running, true);
  assert.equal(controller.state.phase, 'touchdown');
});

test('contacts outside the nominal landing envelope remain recoverable', () => {
  const scenarios = [
    {
      name: 'overspeed',
      speed: 70,
      pitch: 2 * DEG_TO_RAD,
      bank: 0,
      yaw: 0,
      surfaceHeightAt: () => 0,
      position: new THREE.Vector3(0, 0.08, 400),
    },
    {
      name: 'excessive bank',
      speed: 30,
      pitch: 2 * DEG_TO_RAD,
      bank: 30 * DEG_TO_RAD,
      yaw: 0,
      surfaceHeightAt: () => 0,
      position: new THREE.Vector3(0, 0.2, 400),
    },
    {
      name: 'cross-runway heading',
      speed: 30,
      pitch: 2 * DEG_TO_RAD,
      bank: 0,
      yaw: Math.PI / 2,
      surfaceHeightAt: () => 0,
      position: new THREE.Vector3(0, 0.08, 400),
    },
    {
      name: 'steep terrain',
      speed: 30,
      pitch: 2 * DEG_TO_RAD,
      bank: 0,
      yaw: 0,
      surfaceHeightAt: (worldX) => worldX * Math.tan(20 * DEG_TO_RAD),
      position: new THREE.Vector3(
        40,
        40 * Math.tan(20 * DEG_TO_RAD) + 0.2,
        400,
      ),
    },
  ];

  for (const scenario of scenarios) {
    const { controller, root } = createController({
      fullScaleGear: true,
      surfaceHeightAt: scenario.surfaceHeightAt,
    });
    assert.equal(controller.start(), true, scenario.name);
    const sinkRate = -2;
    Object.assign(controller, {
      onGround: false,
      hasBeenAirborne: true,
      liftoffSeconds: 1,
      speed: scenario.speed,
      throttle: 0.7,
      pitch: scenario.pitch,
      bank: scenario.bank,
      yaw: scenario.yaw,
      flightPathAngle: Math.asin(sinkRate / scenario.speed),
      verticalSpeed: sinkRate,
    });
    root.position.copy(scenario.position);

    const recovered = advanceUntil(
      controller,
      neutralIntent(),
      (state) => state.onGround,
      30,
      `${scenario.name} did not resolve to a ground state`,
    );

    assert.equal(recovered.crashed, false, scenario.name);
    assert.equal(recovered.running, true, scenario.name);
    assert.equal(recovered.completed, false, scenario.name);
    assert.equal(recovered.phase, 'touchdown', scenario.name);
    assert.ok(Number.isFinite(recovered.speed), scenario.name);
    assert.ok(Math.abs(
      recovered.speed - horizontalSpeedAtContact(scenario.speed, sinkRate)
    ) < 0.5, scenario.name);
    assert.equal(recovered.throttle, 0.7, scenario.name);
    assert.ok(Number.isFinite(recovered.position.x), scenario.name);
    assert.ok(Number.isFinite(recovered.position.y), scenario.name);
    assert.ok(Number.isFinite(recovered.position.z), scenario.name);
    const throttleBeforeInput = controller.state.throttle;
    controller.update(FIXED_STEP, neutralIntent({ throttle: 1 }));
    assert.ok(
      controller.state.throttle > throttleBeforeInput,
      `${scenario.name} ignored live pilot input`,
    );
  }
});

test('high-speed ground contact keeps rolling momentum and braking acts over time', () => {
  const makeOverspeedContact = () => {
    const { controller, root } = createController({ fullScaleGear: true });
    assert.equal(controller.start(), true);
    const speed = 70;
    const sinkRate = -2;
    Object.assign(controller, {
      onGround: false,
      hasBeenAirborne: true,
      liftoffSeconds: 1,
      speed,
      throttle: 0,
      pitch: 2 * DEG_TO_RAD,
      bank: 0,
      flightPathAngle: Math.asin(sinkRate / speed),
      verticalSpeed: sinkRate,
    });
    root.position.set(0, 0.08, 400);
    const contact = advanceUntil(
      controller,
      neutralIntent(),
      (state) => state.onGround,
      30,
      'The overspeed aircraft did not contact the ground',
    );
    return { controller, contact };
  };

  const unbraked = makeOverspeedContact();
  const braked = makeOverspeedContact();
  const expectedContactSpeed = horizontalSpeedAtContact(70, -2);
  assert.ok(Math.abs(unbraked.contact.speed - expectedContactSpeed) < 0.5);
  assert.ok(Math.abs(braked.contact.speed - expectedContactSpeed) < 0.5);

  unbraked.controller.update(FIXED_STEP, neutralIntent());
  braked.controller.update(FIXED_STEP, neutralIntent({ brake: true }));
  assert.ok(unbraked.controller.state.speed > unbraked.contact.speed * 0.98);
  assert.ok(braked.controller.state.speed > braked.contact.speed * 0.97);
  assert.ok(unbraked.controller.state.position.distanceTo(unbraked.contact.position) > 0.5);
  assert.ok(braked.controller.state.position.distanceTo(braked.contact.position) > 0.5);

  for (let step = 1; step < 120; step += 1) {
    unbraked.controller.update(FIXED_STEP, neutralIntent());
    braked.controller.update(FIXED_STEP, neutralIntent({ brake: true }));
  }

  const unbrakedDistance = unbraked.controller.state.position.distanceTo(
    unbraked.contact.position,
  );
  const brakedDistance = braked.controller.state.position.distanceTo(braked.contact.position);
  assert.ok(unbrakedDistance > 50, `Unbraked roll was only ${unbrakedDistance.toFixed(2)} m.`);
  assert.ok(brakedDistance > 35, `Braked roll stopped unrealistically at ${brakedDistance.toFixed(2)} m.`);
  assert.ok(unbrakedDistance > brakedDistance + 5);
  assert.ok(unbraked.controller.state.speed > braked.controller.state.speed + 10);
  assert.equal(unbraked.controller.state.running, true);
  assert.equal(braked.controller.state.running, true);
  assert.equal(unbraked.controller.state.crashed, false);
  assert.equal(braked.controller.state.crashed, false);
});

test('a propeller-first strike returns to controllable ground operation', () => {
  const { controller, root } = createController({ fullScaleGear: true });
  assert.equal(controller.start(), true);

  const speed = 30;
  const sinkRate = -1;
  Object.assign(controller, {
    onGround: false,
    hasBeenAirborne: true,
    liftoffSeconds: 1,
    speed,
    throttle: 0.8,
    pitch: -12 * DEG_TO_RAD,
    bank: 0,
    flightPathAngle: Math.asin(sinkRate / speed),
    verticalSpeed: sinkRate,
  });
  root.position.set(400, 0.35, 400);

  controller.update(FIXED_STEP, neutralIntent());

  assert.equal(controller.state.crashed, false);
  assert.equal(controller.state.running, true);
  assert.equal(controller.state.completed, false);
  assert.equal(controller.state.onGround, true);
  assert.equal(controller.state.phase, 'touchdown');
  assert.ok(Math.abs(
    controller.state.speed - horizontalSpeedAtContact(speed, sinkRate)
  ) < 0.4);
  assert.equal(controller.state.verticalSpeed, 0);
  assert.equal(controller.state.throttle, 0.8);
  assert.equal(controller.state.wheelContact.all, true);
  const contactPosition = controller.state.position.clone();
  controller.update(FIXED_STEP, neutralIntent({ throttle: 1 }));
  assert.ok(controller.state.position.distanceTo(contactPosition) > 0.2);
  assert.ok(controller.state.throttle > 0.8, 'A propeller strike must leave pilot input active.');
});

test('a hard landing can be followed by a relaunch without reset or restart', () => {
  const { controller, root } = createController();
  takeOff(controller, { start: true });
  root.position.y = 50;
  controller.update(FIXED_STEP, neutralIntent());
  const beforeImpact = establishDescent(controller, { hard: true });
  assert.ok(beforeImpact.verticalSpeed < -5.2);

  const recovered = contactGround(controller, root);
  assert.equal(recovered.phase, 'touchdown');
  assert.equal(recovered.crashed, false);
  assert.equal(recovered.completed, false);
  assert.equal(recovered.running, true);
  assert.equal(recovered.onGround, true);
  const expectedGroundSpeed = horizontalSpeedAtContact(
    beforeImpact.speed,
    beforeImpact.verticalSpeed,
  );
  assert.ok(Math.abs(recovered.speed - expectedGroundSpeed) < 0.75);
  assert.equal(recovered.throttle, beforeImpact.throttle);
  assert.ok(recovered.propellerRpm >= 700);

  const relaunch = takeOff(controller);
  assert.equal(relaunch.crashed, false);
  assert.equal(relaunch.completed, false);
  assert.equal(relaunch.running, true);
  assert.equal(relaunch.onGround, false);
  assert.equal(relaunch.phase, 'liftoff');
  assert.ok(relaunch.position.distanceTo(recovered.position) > 1);
});
