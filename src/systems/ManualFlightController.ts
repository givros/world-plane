import * as THREE from 'three';
import type {
  AircraftMotionRig,
  FlightRunwayLayout,
  FlightSnapshot,
} from './FlightSequence';
import type { PilotIntent } from './PilotInput';

export interface ManualFlightOptions {
  runway?: Partial<FlightRunwayLayout> & {
    width?: number;
    southThresholdZ?: number;
    northThresholdZ?: number;
  };
  aircraftGroundOffset?: number;
  propellerSpinAxis?: THREE.Vector3;
  wheelSpinAxis?: THREE.Vector3;
  mainWheelRadius?: number;
  auxiliaryWheelRadius?: number;
  propellerSafetyRadius?: number;
  surfaceHeightAt?: (worldX: number, worldZ: number) => number;
}

const FIXED_STEP = 1 / 120;
const MAX_ACCUMULATED_TIME = 0.12;
const TWO_PI = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;
const GRAVITY = 9.81;
const TAKEOFF_SPEED = 29;
const STALL_SPEED = 25;
const MAX_SPEED = 78;
const MAX_PITCH = 27 * DEG_TO_RAD;
const MIN_PITCH = -22 * DEG_TO_RAD;
const MAX_BANK = 52 * DEG_TO_RAD;
const MAX_FLIGHT_PATH_CLIMB = 30 * DEG_TO_RAD;
const MAX_FLIGHT_PATH_DESCENT = -38 * DEG_TO_RAD;
const MAX_PITCH_RATE = 34 * DEG_TO_RAD;
const MAX_ROLL_RATE = 78 * DEG_TO_RAD;
const MAX_RUDDER_YAW_RATE = 19 * DEG_TO_RAD;
const TRIM_PITCH = 2.4 * DEG_TO_RAD;
const ZERO_LIFT_COEFFICIENT = 0.18;
const LIFT_CURVE_SLOPE = 4.4;
const CRITICAL_ANGLE_OF_ATTACK = 14 * DEG_TO_RAD;
const FULL_STALL_ANGLE = 24 * DEG_TO_RAD;
const DYNAMIC_PRESSURE_SCALE = 0.018;
const ZERO_LIFT_DRAG = 0.032;
const INDUCED_DRAG_FACTOR = 0.052;
const MAX_ENGINE_ACCELERATION = 10.8;
const TAKEOFF_POWER_THRESHOLD = 0.5;
const LIFTOFF_CONTACT_GRACE_SECONDS = 0.22;
const LIFTOFF_SUPPORT_CLEARANCE = 0.06;
const TOUCHDOWN_CONTACT_GUARD_SECONDS = 0.2;
const TERRAIN_SLOPE_SAMPLE_DISTANCE = 2.5;
const MAX_LANDING_SLOPE = 12 * DEG_TO_RAD;
const MIN_SAFE_TOUCHDOWN_SPEED = 10;
const MAX_SAFE_TOUCHDOWN_SPEED = 56;
const MAX_SAFE_TOUCHDOWN_SINK_RATE = 5.2;
const MAX_FLARED_TOUCHDOWN_SINK_RATE = 7.2;
const MAX_SAFE_TOUCHDOWN_BANK = 18 * DEG_TO_RAD;
const MIN_SAFE_TOUCHDOWN_PITCH = -5 * DEG_TO_RAD;
const MAX_SAFE_TOUCHDOWN_PITCH = 16 * DEG_TO_RAD;

const DEFAULT_RUNWAY: FlightRunwayLayout & {
  width: number;
  southThresholdZ: number;
  northThresholdZ: number;
} = {
  centerlineX: 0,
  surfaceY: 0,
  parkingZ: -112,
  takeoffEndZ: 105,
  touchdownZ: -104,
  finalStopZ: 124,
  width: 24,
  southThresholdZ: -150,
  northThresholdZ: 150,
};

const clamp01 = (value: number): number => THREE.MathUtils.clamp(value, 0, 1);

const damp = (current: number, target: number, response: number, delta: number): number =>
  THREE.MathUtils.lerp(current, target, 1 - Math.exp(-response * delta));

const shortestAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export class ManualFlightController {
  private readonly root: THREE.Object3D;
  private readonly propeller?: THREE.Object3D;
  private readonly mainWheels: THREE.Object3D[];
  private readonly auxiliaryWheel?: THREE.Object3D;
  private readonly propellerBaseQuaternion?: THREE.Quaternion;
  private readonly mainWheelBaseQuaternions: THREE.Quaternion[];
  private readonly auxiliaryWheelBaseQuaternion?: THREE.Quaternion;
  private readonly propellerAxis = new THREE.Vector3(0, 0, 1);
  private readonly wheelAxis = new THREE.Vector3(1, 0, 0);
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private readonly pitchAxis = new THREE.Vector3(1, 0, 0);
  private readonly forwardAxis = new THREE.Vector3(0, 0, 1);
  private readonly yawQuaternion = new THREE.Quaternion();
  private readonly pitchQuaternion = new THREE.Quaternion();
  private readonly bankQuaternion = new THREE.Quaternion();
  private readonly orientationQuaternion = new THREE.Quaternion();
  private readonly spinQuaternion = new THREE.Quaternion();
  private readonly supportPoint = new THREE.Vector3();
  private readonly runway: FlightRunwayLayout & {
    width: number;
    southThresholdZ: number;
    northThresholdZ: number;
  };
  private readonly groundRootY: number;
  private readonly mainWheelRadius: number;
  private readonly auxiliaryWheelRadius: number;
  private readonly propellerSafetyRadius: number;
  private readonly aircraftGroundOffset: number;
  private readonly surfaceHeightResolver?: (worldX: number, worldZ: number) => number;
  private readonly mutableState: FlightSnapshot = {
    mode: 'manual',
    phase: 'parked',
    phaseProgress: 0,
    normalizedProgress: 0,
    elapsed: 0,
    airborneSeconds: 0,
    airborneProgress: 0,
    speed: 0,
    altitude: 0,
    verticalSpeed: 0,
    throttle: 0,
    stall: false,
    crashed: false,
    onGround: true,
    propellerRpm: 0,
    propellerAngle: 0,
    wheelRotation: 0,
    wheelContact: { main: true, auxiliary: true, all: true },
    pitch: 0,
    bank: 0,
    yaw: 0,
    cameraShot: 'aerial-chase',
    completed: false,
    running: false,
    inspectionAllowed: true,
    position: new THREE.Vector3(),
  };

  private active = false;
  private accumulator = 0;
  private speed = 0;
  private throttle = 0;
  private pitch = 0;
  private bank = 0;
  private yaw = 0;
  private pitchRate = 0;
  private rollRate = 0;
  private yawRate = 0;
  private flightPathAngle = 0;
  private angleOfAttack = 0;
  private stallSeverity = 0;
  private verticalSpeed = 0;
  private onGround = true;
  private hasBeenAirborne = false;
  private landingRollActive = false;
  private liftoffSeconds = 0;
  private touchdownSeconds = 0;
  private propellerAngle = 0;
  private mainWheelAngle = 0;
  private auxiliaryWheelAngle = 0;
  private mainWheelAngularSpeed = 0;
  private auxiliaryWheelAngularSpeed = 0;

  constructor(rig: AircraftMotionRig, options: ManualFlightOptions = {}) {
    this.root = rig.root;
    this.propeller = rig.propeller;
    this.mainWheels = Array.from(rig.mainWheels ?? []);
    this.auxiliaryWheel = rig.auxiliaryWheel;
    this.propellerBaseQuaternion = this.propeller?.quaternion.clone();
    this.mainWheelBaseQuaternions = this.mainWheels.map((wheel) => wheel.quaternion.clone());
    this.auxiliaryWheelBaseQuaternion = this.auxiliaryWheel?.quaternion.clone();

    this.runway = {
      centerlineX: options.runway?.centerlineX ?? DEFAULT_RUNWAY.centerlineX,
      surfaceY: options.runway?.surfaceY ?? DEFAULT_RUNWAY.surfaceY,
      parkingZ: options.runway?.parkingZ ?? DEFAULT_RUNWAY.parkingZ,
      takeoffEndZ: options.runway?.takeoffEndZ ?? DEFAULT_RUNWAY.takeoffEndZ,
      touchdownZ: options.runway?.touchdownZ ?? DEFAULT_RUNWAY.touchdownZ,
      finalStopZ: options.runway?.finalStopZ ?? DEFAULT_RUNWAY.finalStopZ,
      width: options.runway?.width ?? DEFAULT_RUNWAY.width,
      southThresholdZ: options.runway?.southThresholdZ ?? DEFAULT_RUNWAY.southThresholdZ,
      northThresholdZ: options.runway?.northThresholdZ ?? DEFAULT_RUNWAY.northThresholdZ,
    };
    this.aircraftGroundOffset = options.aircraftGroundOffset ?? 0;
    this.groundRootY = this.runway.surfaceY + this.aircraftGroundOffset;
    this.mainWheelRadius = Math.max(0.05, options.mainWheelRadius ?? 0.52);
    this.auxiliaryWheelRadius = Math.max(0.03, options.auxiliaryWheelRadius ?? 0.2);
    this.propellerSafetyRadius = Math.max(0.05, options.propellerSafetyRadius ?? 0);
    this.surfaceHeightResolver = options.surfaceHeightAt;
    if (options.propellerSpinAxis) this.propellerAxis.copy(options.propellerSpinAxis);
    if (options.wheelSpinAxis) this.wheelAxis.copy(options.wheelSpinAxis);
    this.propellerAxis.normalize();
    this.wheelAxis.normalize();
    this.reset();
  }

  get state(): Readonly<FlightSnapshot> {
    return this.mutableState;
  }

  start(): boolean {
    if (this.active) return false;
    if (this.mutableState.completed || this.mutableState.crashed) this.reset();
    this.active = true;
    this.mutableState.running = true;
    this.mutableState.inspectionAllowed = false;
    this.mutableState.phase = 'manual-ready';
    this.mutableState.propellerRpm = 720;
    return true;
  }

  reset(): void {
    this.active = false;
    this.accumulator = 0;
    this.speed = 0;
    this.throttle = 0;
    this.pitch = 0;
    this.bank = 0;
    this.yaw = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate = 0;
    this.flightPathAngle = 0;
    this.angleOfAttack = 0;
    this.stallSeverity = 0;
    this.verticalSpeed = 0;
    this.onGround = true;
    this.hasBeenAirborne = false;
    this.landingRollActive = false;
    this.liftoffSeconds = 0;
    this.touchdownSeconds = 0;
    this.propellerAngle = 0;
    this.mainWheelAngle = 0;
    this.auxiliaryWheelAngle = 0;
    this.mainWheelAngularSpeed = 0;
    this.auxiliaryWheelAngularSpeed = 0;

    this.root.position.set(this.runway.centerlineX, this.groundRootY, this.runway.parkingZ);
    this.root.quaternion.identity();
    const state = this.mutableState;
    state.mode = 'manual';
    state.phase = 'parked';
    state.phaseProgress = 0;
    state.normalizedProgress = 0;
    state.elapsed = 0;
    state.airborneSeconds = 0;
    state.airborneProgress = 0;
    state.speed = 0;
    state.altitude = 0;
    state.verticalSpeed = 0;
    state.throttle = 0;
    state.stall = false;
    state.crashed = false;
    state.onGround = true;
    state.propellerRpm = 0;
    state.propellerAngle = 0;
    state.wheelRotation = 0;
    state.wheelContact.main = true;
    state.wheelContact.auxiliary = true;
    state.wheelContact.all = true;
    state.pitch = 0;
    state.bank = 0;
    state.yaw = 0;
    state.cameraShot = 'aerial-chase';
    state.completed = false;
    state.running = false;
    state.inspectionAllowed = true;
    state.position.copy(this.root.position);
    this.applyMechanicalPose();
  }

  update(deltaSeconds: number, intent: Readonly<PilotIntent>): Readonly<FlightSnapshot> {
    if (!this.active) return this.mutableState;
    const delta = Number.isFinite(deltaSeconds)
      ? THREE.MathUtils.clamp(deltaSeconds, 0, MAX_ACCUMULATED_TIME)
      : 0;
    this.accumulator = Math.min(MAX_ACCUMULATED_TIME, this.accumulator + delta);
    while (this.accumulator >= FIXED_STEP) {
      this.step(FIXED_STEP, intent);
      this.accumulator -= FIXED_STEP;
      if (!this.active) break;
    }
    this.syncSnapshot();
    return this.mutableState;
  }

  private step(delta: number, intent: Readonly<PilotIntent>): void {
    const state = this.mutableState;
    state.elapsed += delta;
    const throttleRate = intent.throttle >= 0 ? 0.48 : 0.62;
    this.throttle = clamp01(this.throttle + intent.throttle * throttleRate * delta);

    if (this.onGround) this.stepGround(delta, intent);
    else this.stepAir(delta, intent);

    this.updateOrientation();
    if (this.onGround) {
      this.constrainGroundEnvelope();
    } else if (this.liftoffSeconds < LIFTOFF_CONTACT_GRACE_SECONDS) {
      // A taildragger rotates around its main gear, so the tail wheel is still very
      // close to the runway during the first frames of lift-off. Preserve a small,
      // explicit separation while positive lift develops instead of immediately
      // interpreting that authored support point as a second touchdown.
      this.constrainGroundEnvelope(LIFTOFF_SUPPORT_CLEARANCE, false);
    } else {
      this.evaluateAirborneGroundContact();
    }
    this.evaluateContact();
    this.updateMechanicalAnimation(delta);

  }

  private stepGround(delta: number, intent: Readonly<PilotIntent>): void {
    if (this.landingRollActive) this.touchdownSeconds += delta;

    const braking = intent.brake ? 17.5 : 0;
    const propellerEfficiency = 1 - 0.28 * clamp01(this.speed / MAX_SPEED);
    const engineForce = this.throttle * 13.2 * propellerEfficiency;
    const aerodynamicDrag = this.speed * this.speed * 0.0028;
    const rollingResistance = this.speed > 0 ? 0.58 + aerodynamicDrag : 0;
    this.speed = THREE.MathUtils.clamp(
      this.speed + (engineForce - rollingResistance - braking) * delta,
      0,
      MAX_SPEED,
    );

    // The aircraft faces local +Z, so the pilot's visual right is local -X.
    // Keep the input intent semantic (right = +1) and convert it here.
    const steeringAuthority = THREE.MathUtils.smoothstep(this.speed, 1.5, 19);
    const steerRateTarget = -(intent.roll * 0.58 + intent.yaw * 0.42) * steeringAuthority;
    this.yawRate = damp(this.yawRate, steerRateTarget, 5.2, delta);
    this.yaw += this.yawRate * delta;

    this.rollRate = damp(this.rollRate, -this.bank * 4.5, 6.5, delta);
    this.bank = THREE.MathUtils.clamp(this.bank + this.rollRate * delta, -8 * DEG_TO_RAD, 8 * DEG_TO_RAD);

    const elevatorAuthority = THREE.MathUtils.smoothstep(this.speed, 15, 31);
    const groundPitchRateTarget = Math.max(0, intent.pitch)
      * 24 * DEG_TO_RAD
      * elevatorAuthority
      - this.pitch * 1.65;
    this.pitchRate = damp(this.pitchRate, groundPitchRateTarget, 3.4, delta);
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + this.pitchRate * delta,
      0,
      12.5 * DEG_TO_RAD,
    );
    this.flightPathAngle = 0;
    this.angleOfAttack = this.pitch;
    this.stallSeverity = 0;
    this.verticalSpeed = 0;

    this.root.position.x += Math.sin(this.yaw) * this.speed * delta;
    this.root.position.z += Math.cos(this.yaw) * this.speed * delta;

    // Take-off is a reusable transition rather than a one-shot mission gate. This
    // also permits a touch-and-go when the pilot keeps power on after touchdown.
    const contactGuardSatisfied = !this.landingRollActive
      || this.touchdownSeconds >= TOUCHDOWN_CONTACT_GUARD_SECONDS;
    if (
      contactGuardSatisfied
      && this.throttle >= TAKEOFF_POWER_THRESHOLD
      && this.speed >= TAKEOFF_SPEED
      && this.pitch > 5 * DEG_TO_RAD
    ) {
      this.onGround = false;
      this.hasBeenAirborne = true;
      this.landingRollActive = false;
      this.liftoffSeconds = 0;
      this.touchdownSeconds = 0;
      this.flightPathAngle = 1.2 * DEG_TO_RAD;
      this.verticalSpeed = Math.sin(this.flightPathAngle) * this.speed;
      this.root.position.y += 0.08;
      this.mutableState.phase = 'liftoff';
      this.mutableState.completed = false;
      this.mutableState.running = true;
      this.mutableState.inspectionAllowed = false;
      return;
    }

    if (this.landingRollActive) {
      const takeoffPowerApplied = this.throttle >= TAKEOFF_POWER_THRESHOLD;
      if (takeoffPowerApplied) {
        this.mutableState.phase = this.speed > TAKEOFF_SPEED * 0.82 && this.pitch > 1.5 * DEG_TO_RAD
          ? 'rotation'
          : 'takeoff-roll';
      } else {
        this.mutableState.phase = this.touchdownSeconds < 0.9 ? 'touchdown' : 'rollout';
      }
      if (this.speed < 0.75 && this.throttle < 0.04) {
        this.speed = 0;
        this.pitch = damp(this.pitch, 0, 5.5, delta);
        this.pitchRate = damp(this.pitchRate, 0, 7, delta);
        this.rollRate = damp(this.rollRate, 0, 7, delta);
        this.yawRate = damp(this.yawRate, 0, 7, delta);
        this.landingRollActive = false;
        this.touchdownSeconds = 0;
        this.mutableState.phase = 'manual-ready';
        this.mutableState.completed = false;
        this.mutableState.running = true;
        this.mutableState.inspectionAllowed = false;
      }
    } else if (this.speed < 0.3 && this.throttle < 0.03) {
      this.mutableState.phase = 'manual-ready';
    } else if (this.speed > TAKEOFF_SPEED * 0.82 && this.pitch > 1.5 * DEG_TO_RAD) {
      this.mutableState.phase = 'rotation';
    } else {
      this.mutableState.phase = 'takeoff-roll';
    }
  }

  private stepAir(delta: number, intent: Readonly<PilotIntent>): void {
    this.liftoffSeconds += delta;
    this.mutableState.airborneSeconds += delta;
    const speedAuthority = 0.18 + 0.82 * THREE.MathUtils.smoothstep(this.speed, 16, 43);

    // Stick inputs request angular velocity, not attitude. Angular inertia and
    // aerodynamic damping make release, reversal and low-speed control distinct.
    const pitchRateTarget = intent.pitch * MAX_PITCH_RATE * speedAuthority
      + (TRIM_PITCH - this.pitch) * 0.34;
    const rollRateTarget = intent.roll * MAX_ROLL_RATE * speedAuthority
      - this.bank * 0.42;
    this.pitchRate = damp(this.pitchRate, pitchRateTarget, 2.25, delta);
    this.rollRate = damp(this.rollRate, rollRateTarget, 2.55, delta);
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + this.pitchRate * delta,
      MIN_PITCH,
      MAX_PITCH,
    );
    this.bank = THREE.MathUtils.clamp(
      this.bank + this.rollRate * delta,
      -MAX_BANK,
      MAX_BANK,
    );

    this.angleOfAttack = THREE.MathUtils.clamp(
      shortestAngle(this.pitch - this.flightPathAngle),
      -35 * DEG_TO_RAD,
      35 * DEG_TO_RAD,
    );
    const absoluteAngleOfAttack = Math.abs(this.angleOfAttack);
    const angleStall = THREE.MathUtils.smoothstep(
      absoluteAngleOfAttack,
      CRITICAL_ANGLE_OF_ATTACK,
      FULL_STALL_ANGLE,
    );
    const lowSpeedStall = 1 - THREE.MathUtils.smoothstep(
      this.speed,
      STALL_SPEED - 5,
      STALL_SPEED + 5,
    );
    this.stallSeverity = Math.max(angleStall, lowSpeedStall);

    const linearLiftCoefficient = ZERO_LIFT_COEFFICIENT
      + LIFT_CURVE_SLOPE * this.angleOfAttack;
    const separatedLiftCoefficient = Math.sign(linearLiftCoefficient || 1)
      * THREE.MathUtils.lerp(0.72, 0.38, angleStall);
    const liftCoefficient = THREE.MathUtils.lerp(
      linearLiftCoefficient,
      separatedLiftCoefficient,
      angleStall,
    );
    const dynamicPressure = this.speed * this.speed * DYNAMIC_PRESSURE_SCALE;
    const liftAcceleration = dynamicPressure * liftCoefficient;
    const dragCoefficient = ZERO_LIFT_DRAG
      + INDUCED_DRAG_FACTOR * liftCoefficient * liftCoefficient
      + angleStall * 0.24;
    const dragAcceleration = dynamicPressure * dragCoefficient;
    const propellerEfficiency = 1 - 0.48 * clamp01(this.speed / MAX_SPEED);
    const thrustAcceleration = this.throttle * MAX_ENGINE_ACCELERATION * propellerEfficiency;

    // Point-mass energy model: climbing consumes speed, descending restores it,
    // while bank angle reduces the lift available to hold altitude.
    const tangentialAcceleration = thrustAcceleration
      - dragAcceleration
      - GRAVITY * Math.sin(this.flightPathAngle);
    this.speed = THREE.MathUtils.clamp(
      this.speed + THREE.MathUtils.clamp(tangentialAcceleration, -13, 9) * delta,
      11,
      MAX_SPEED,
    );
    const verticalLiftAcceleration = liftAcceleration * Math.cos(this.bank);
    const flightPathAngularAcceleration = (
      verticalLiftAcceleration - GRAVITY * Math.cos(this.flightPathAngle)
    ) / Math.max(this.speed, 11);
    this.flightPathAngle = THREE.MathUtils.clamp(
      this.flightPathAngle
        + THREE.MathUtils.clamp(flightPathAngularAcceleration, -0.62, 0.42) * delta,
      MAX_FLIGHT_PATH_DESCENT,
      MAX_FLIGHT_PATH_CLIMB,
    );

    if (this.stallSeverity > 0) {
      this.pitchRate -= this.stallSeverity * 13 * DEG_TO_RAD * delta;
    }

    const horizontalSpeed = Math.cos(this.flightPathAngle) * this.speed;
    const coordinatedTurn = -GRAVITY
      * Math.tan(this.bank)
      * (1 - this.stallSeverity * 0.6)
      / Math.max(horizontalSpeed, 14);
    const rudderTurn = -intent.yaw * MAX_RUDDER_YAW_RATE * speedAuthority;
    this.yawRate = damp(this.yawRate, coordinatedTurn + rudderTurn, 3.5, delta);
    this.yaw += this.yawRate * delta;

    this.verticalSpeed = Math.sin(this.flightPathAngle) * this.speed;
    this.root.position.x += Math.sin(this.yaw) * horizontalSpeed * delta;
    this.root.position.z += Math.cos(this.yaw) * horizontalSpeed * delta;
    this.root.position.y += this.verticalSpeed * delta;

    const altitude = this.root.position.y - this.groundReferenceYAt(
      this.root.position.x,
      this.root.position.z,
    );

    if (this.liftoffSeconds < 1.15) this.mutableState.phase = 'liftoff';
    else if (this.verticalSpeed > 1.4) this.mutableState.phase = 'climb';
    else if (this.verticalSpeed < -1.6 && altitude < 18) this.mutableState.phase = 'final-approach';
    else if (this.verticalSpeed < -1.6) this.mutableState.phase = 'descent';
    else this.mutableState.phase = 'manual-flight';
  }

  private evaluateAirborneGroundContact(): void {
    let mainClearance = Number.POSITIVE_INFINITY;
    for (const wheel of this.mainWheels) {
      mainClearance = Math.min(
        mainClearance,
        this.supportClearance(wheel.position, this.mainWheelRadius),
      );
    }
    const auxiliaryClearance = this.auxiliaryWheel
      ? this.supportClearance(this.auxiliaryWheel.position, this.auxiliaryWheelRadius)
      : Number.POSITIVE_INFINITY;
    const wheelClearance = Math.min(mainClearance, auxiliaryClearance);

    if (wheelClearance <= 0) {
      if (this.verticalSpeed <= 0) {
        // The production taildragger's auxiliary wheel sits 5.39 m behind the
        // mains. During an ordinary flare it therefore touches first while both
        // main wheels are still visibly clear of the terrain. Treat that as a
        // supported flared touchdown, not as a terminal one-point impact.
        const auxiliaryTouchedFirst = auxiliaryClearance <= 0 && mainClearance > 0;
        this.handleGroundImpact(wheelClearance, auxiliaryTouchedFirst);
        if (this.onGround || this.mutableState.crashed) return;
      } else {
        // A support can still be fractionally below the surface while the aircraft
        // is separating after lift-off. Resolve that overlap without turning an
        // upward-moving wheel into a landing event.
        this.root.position.y -= wheelClearance;
      }
    }

    const propellerClearance = this.propeller && this.propellerSafetyRadius > 0
      ? this.supportClearance(this.propeller.position, this.propellerSafetyRadius)
      : Number.POSITIVE_INFINITY;

    if (propellerClearance <= 0) {
      // Keep the visible propeller envelope tangent to the terrain at the instant
      // of a genuine prop strike. Wheel contact is evaluated first so an ordinary
      // gear-first touchdown cannot be misclassified by a same-step overlap.
      this.root.position.y -= propellerClearance;
      this.recoverGroundContact();
    }
  }

  private handleGroundImpact(wheelClearance: number, auxiliaryTouchedFirst: boolean): void {
    if (wheelClearance < 0) this.root.position.y -= wheelClearance;
    const lateralOffset = Math.abs(this.root.position.x - this.runway.centerlineX);
    const mainGearHalfTrack = this.mainWheels.reduce(
      (maximum, wheel) => Math.max(maximum, Math.abs(wheel.position.x)),
      0,
    );
    const insideRunway = lateralOffset <= Math.max(0, this.runway.width * 0.5 - mainGearHalfTrack)
      && this.root.position.z >= this.runway.southThresholdZ - 8
      && this.root.position.z <= this.runway.northThresholdZ + 8;
    const runwayHeadingError = Math.min(
      Math.abs(shortestAngle(this.yaw)),
      Math.abs(shortestAngle(this.yaw - Math.PI)),
    );
    const surfaceSlope = this.surfaceSlopeAt(this.root.position.x, this.root.position.z);
    const maximumSinkRate = auxiliaryTouchedFirst
      ? MAX_FLARED_TOUCHDOWN_SINK_RATE
      : MAX_SAFE_TOUCHDOWN_SINK_RATE;
    const safe = this.verticalSpeed >= -maximumSinkRate
      && this.speed >= MIN_SAFE_TOUCHDOWN_SPEED
      && this.speed <= MAX_SAFE_TOUCHDOWN_SPEED
      && Math.abs(this.bank) <= MAX_SAFE_TOUCHDOWN_BANK
      && this.pitch >= MIN_SAFE_TOUCHDOWN_PITCH
      && this.pitch <= MAX_SAFE_TOUCHDOWN_PITCH
      && surfaceSlope <= MAX_LANDING_SLOPE
      && (!insideRunway || runwayHeadingError <= 42 * DEG_TO_RAD);

    if (!safe) {
      this.recoverGroundContact();
      return;
    }

    this.onGround = true;
    this.landingRollActive = true;
    this.touchdownSeconds = 0;
    this.speed *= Math.cos(this.flightPathAngle);
    this.flightPathAngle = 0;
    this.angleOfAttack = 0;
    this.stallSeverity = 0;
    this.verticalSpeed = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate *= 0.35;
    this.bank = 0;
    this.pitch = 0;
    // All authored wheel bottoms are coplanar in the neutral ground pose. Settle
    // to that pose immediately so a valid landing cannot remain balanced on the
    // tail wheel with the main gear suspended in mid-air.
    this.updateOrientation();
    this.constrainGroundEnvelope();
    this.mutableState.phase = 'touchdown';
    this.mutableState.completed = false;
    this.mutableState.running = true;
    this.mutableState.inspectionAllowed = false;
  }

  private recoverGroundContact(): void {
    const horizontalSpeed = this.speed * Math.max(0, Math.cos(this.flightPathAngle));
    this.onGround = true;
    this.landingRollActive = true;
    this.liftoffSeconds = 0;
    this.touchdownSeconds = 0;
    this.speed = Number.isFinite(horizontalSpeed)
      ? THREE.MathUtils.clamp(horizontalSpeed, 0, MAX_SPEED)
      : 0;
    this.verticalSpeed = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.yawRate = 0;
    this.flightPathAngle = 0;
    this.angleOfAttack = 0;
    this.stallSeverity = 0;
    if (!Number.isFinite(this.root.position.x)) this.root.position.x = this.runway.centerlineX;
    if (!Number.isFinite(this.root.position.z)) this.root.position.z = this.runway.parkingZ;
    const groundReferenceY = this.groundReferenceYAt(
      this.root.position.x,
      this.root.position.z,
    );
    this.root.position.y = Math.max(
      groundReferenceY,
      Number.isFinite(this.root.position.y) ? this.root.position.y : groundReferenceY,
    );
    if (!Number.isFinite(this.yaw)) this.yaw = 0;
    // A terrain impulse cancels the downward component, not the aircraft's
    // forward momentum or the pilot's throttle setting. Preserve both, settle
    // onto the authored support envelope, and let rolling resistance, drag and
    // braking dissipate speed continuously in the normal 120 Hz ground model.
    this.pitch = 0;
    this.bank = 0;
    this.updateOrientation();
    this.constrainGroundEnvelope();
    this.mutableState.phase = 'touchdown';
    this.mutableState.crashed = false;
    this.mutableState.running = true;
    this.mutableState.completed = false;
    this.mutableState.inspectionAllowed = false;
  }

  private updateOrientation(): void {
    this.yaw = shortestAngle(this.yaw);
    this.yawQuaternion.setFromAxisAngle(this.upAxis, this.yaw);
    this.pitchQuaternion.setFromAxisAngle(this.pitchAxis, -this.pitch);
    this.bankQuaternion.setFromAxisAngle(this.forwardAxis, this.bank);
    this.orientationQuaternion
      .copy(this.yawQuaternion)
      .multiply(this.pitchQuaternion)
      .multiply(this.bankQuaternion);
    this.root.quaternion.copy(this.orientationQuaternion);
  }

  private evaluateContact(): void {
    const tolerance = 0.014;
    let mainClearance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.mainWheels.length; index += 1) {
      mainClearance = Math.min(
        mainClearance,
        this.supportClearance(this.mainWheels[index].position, this.mainWheelRadius),
      );
    }
    const auxiliaryClearance = this.auxiliaryWheel
      ? this.supportClearance(this.auxiliaryWheel.position, this.auxiliaryWheelRadius)
      : Number.POSITIVE_INFINITY;
    this.mutableState.wheelContact.main = mainClearance <= tolerance;
    this.mutableState.wheelContact.auxiliary = auxiliaryClearance <= tolerance;
    this.mutableState.wheelContact.all = this.mutableState.wheelContact.main
      && this.mutableState.wheelContact.auxiliary;
  }

  private constrainGroundEnvelope(targetClearance = 0, allowLowering = true): void {
    let minimumClearance = Number.POSITIVE_INFINITY;
    for (const wheel of this.mainWheels) {
      minimumClearance = Math.min(
        minimumClearance,
        this.supportClearance(wheel.position, this.mainWheelRadius),
      );
    }
    if (this.auxiliaryWheel) {
      minimumClearance = Math.min(
        minimumClearance,
        this.supportClearance(this.auxiliaryWheel.position, this.auxiliaryWheelRadius),
      );
    }
    if (this.propeller && this.propellerSafetyRadius > 0) {
      minimumClearance = Math.min(
        minimumClearance,
        this.supportClearance(this.propeller.position, this.propellerSafetyRadius),
      );
    }
    if (Number.isFinite(minimumClearance)) {
      const correction = targetClearance - minimumClearance;
      if (allowLowering || correction > 0) this.root.position.y += correction;
    }
  }

  private supportClearance(localCenter: THREE.Vector3, radius: number): number {
    this.supportPoint.copy(localCenter).applyQuaternion(this.orientationQuaternion);
    const worldX = this.root.position.x + this.supportPoint.x;
    const worldZ = this.root.position.z + this.supportPoint.z;
    return this.root.position.y + this.supportPoint.y - radius
      - this.surfaceHeightAt(worldX, worldZ);
  }

  private surfaceHeightAt(worldX: number, worldZ: number): number {
    const sampled = this.surfaceHeightResolver?.(worldX, worldZ);
    return Number.isFinite(sampled) ? sampled as number : this.runway.surfaceY;
  }

  private groundReferenceYAt(worldX: number, worldZ: number): number {
    return this.surfaceHeightAt(worldX, worldZ) + this.aircraftGroundOffset;
  }

  private surfaceSlopeAt(worldX: number, worldZ: number): number {
    const offset = TERRAIN_SLOPE_SAMPLE_DISTANCE;
    const riseX = this.surfaceHeightAt(worldX + offset, worldZ)
      - this.surfaceHeightAt(worldX - offset, worldZ);
    const riseZ = this.surfaceHeightAt(worldX, worldZ + offset)
      - this.surfaceHeightAt(worldX, worldZ - offset);
    return Math.atan(Math.hypot(riseX, riseZ) / (offset * 2));
  }

  private updateMechanicalAnimation(delta: number): void {
    const rpm = this.active ? 720 + this.throttle * 1780 : 0;
    this.mutableState.propellerRpm = rpm;
    this.propellerAngle = (this.propellerAngle + (rpm * TWO_PI * delta) / 60) % TWO_PI;

    if (this.mutableState.wheelContact.main) this.mainWheelAngularSpeed = this.speed / this.mainWheelRadius;
    else this.mainWheelAngularSpeed *= Math.exp(-delta / 2.4);
    if (this.mutableState.wheelContact.auxiliary) {
      this.auxiliaryWheelAngularSpeed = this.speed / this.auxiliaryWheelRadius;
    } else {
      this.auxiliaryWheelAngularSpeed *= Math.exp(-delta / 1.8);
    }
    this.mainWheelAngle = (this.mainWheelAngle + this.mainWheelAngularSpeed * delta) % TWO_PI;
    this.auxiliaryWheelAngle = (
      this.auxiliaryWheelAngle + this.auxiliaryWheelAngularSpeed * delta
    ) % TWO_PI;
    this.applyMechanicalPose();
  }

  private applyMechanicalPose(): void {
    if (this.propeller && this.propellerBaseQuaternion) {
      this.spinQuaternion.setFromAxisAngle(this.propellerAxis, this.propellerAngle);
      this.propeller.quaternion.copy(this.propellerBaseQuaternion).multiply(this.spinQuaternion);
    }
    this.spinQuaternion.setFromAxisAngle(this.wheelAxis, this.mainWheelAngle);
    for (let index = 0; index < this.mainWheels.length; index += 1) {
      this.mainWheels[index].quaternion
        .copy(this.mainWheelBaseQuaternions[index])
        .multiply(this.spinQuaternion);
    }
    if (this.auxiliaryWheel && this.auxiliaryWheelBaseQuaternion) {
      this.spinQuaternion.setFromAxisAngle(this.wheelAxis, this.auxiliaryWheelAngle);
      this.auxiliaryWheel.quaternion
        .copy(this.auxiliaryWheelBaseQuaternion)
        .multiply(this.spinQuaternion);
    }
  }

  private syncSnapshot(): void {
    const state = this.mutableState;
    state.speed = this.speed;
    state.altitude = this.onGround
      ? 0
      : Math.max(
        0,
        this.root.position.y - this.groundReferenceYAt(
          this.root.position.x,
          this.root.position.z,
        ),
      );
    state.verticalSpeed = this.verticalSpeed;
    state.throttle = this.throttle;
    state.stall = !this.onGround && this.stallSeverity >= 0.38;
    state.onGround = this.onGround;
    state.pitch = this.pitch;
    state.bank = this.bank;
    state.yaw = this.yaw;
    state.propellerAngle = this.propellerAngle;
    state.wheelRotation = this.mainWheelAngle;
    state.position.copy(this.root.position);
    state.phaseProgress = this.phaseProgress();
    state.normalizedProgress = this.missionProgress();
    state.airborneProgress = this.hasBeenAirborne ? clamp01(state.airborneSeconds / 45) : 0;
    state.cameraShot = 'aerial-chase';
  }

  private phaseProgress(): number {
    switch (this.mutableState.phase) {
      case 'manual-ready': return this.throttle;
      case 'takeoff-roll': return clamp01(this.speed / TAKEOFF_SPEED);
      case 'rotation': return clamp01(this.pitch / (8 * DEG_TO_RAD));
      case 'liftoff': return clamp01(this.liftoffSeconds / 1.15);
      case 'touchdown': return clamp01(this.touchdownSeconds / 0.9);
      case 'rollout': return 1 - clamp01(this.speed / 45);
      case 'complete':
      case 'crashed': return 1;
      default: return clamp01(this.mutableState.altitude / 55);
    }
  }

  private missionProgress(): number {
    if (this.mutableState.crashed) return 0;
    if (this.mutableState.completed) return 1;
    if (!this.hasBeenAirborne) return clamp01(this.speed / TAKEOFF_SPEED) * 0.25;
    if (!this.onGround) return 0.5;
    if (this.landingRollActive && this.throttle < TAKEOFF_POWER_THRESHOLD) {
      return 0.75 + (1 - clamp01(this.speed / 45)) * 0.25;
    }
    return clamp01(this.speed / TAKEOFF_SPEED) * 0.25;
  }
}
