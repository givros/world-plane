import * as THREE from 'three';

export const FLIGHT_AIRBORNE_SECONDS = 30;

export type FlightPhase =
  | 'parked'
  | 'manual-ready'
  | 'manual-flight'
  | 'crashed'
  | 'anticipation'
  | 'prop-spin-up'
  | 'takeoff-roll'
  | 'rotation'
  | 'liftoff'
  | 'climb'
  | 'scenic-outbound'
  | 'scenic-turn'
  | 'return'
  | 'descent'
  | 'final-approach'
  | 'touchdown'
  | 'rollout'
  | 'stopping'
  | 'finale'
  | 'complete';

export type FlightMode = 'inspection' | 'manual' | 'autopilot';

export type CinematicShotName =
  | 'inspection'
  | 'runway-side'
  | 'rotation-track'
  | 'chase-climb'
  | 'wide-scenic'
  | 'wing-side'
  | 'aerial-chase'
  | 'approach'
  | 'touchdown'
  | 'rollout'
  | 'final-hero';

export interface WheelContactState {
  main: boolean;
  auxiliary: boolean;
  all: boolean;
}

export interface FlightSnapshot {
  mode: FlightMode;
  phase: FlightPhase;
  phaseProgress: number;
  normalizedProgress: number;
  elapsed: number;
  airborneSeconds: number;
  airborneProgress: number;
  speed: number;
  altitude: number;
  verticalSpeed: number;
  throttle: number;
  stall: boolean;
  crashed: boolean;
  onGround: boolean;
  propellerRpm: number;
  propellerAngle: number;
  wheelRotation: number;
  wheelContact: WheelContactState;
  pitch: number;
  bank: number;
  yaw: number;
  cameraShot: CinematicShotName;
  completed: boolean;
  running: boolean;
  inspectionAllowed: boolean;
  position: THREE.Vector3;
}

export interface AircraftMotionRig {
  /** A neutral wrapper whose local nose points +Z and whose local up points +Y. */
  root: THREE.Object3D;
  propeller?: THREE.Object3D;
  mainWheels?: readonly THREE.Object3D[];
  auxiliaryWheel?: THREE.Object3D;
}

export interface FlightRunwayLayout {
  centerlineX: number;
  surfaceY: number;
  parkingZ: number;
  takeoffEndZ: number;
  touchdownZ: number;
  finalStopZ: number;
}

export interface FlightSequenceOptions {
  runway?: Partial<FlightRunwayLayout>;
  /** Root height above the runway when every wheel is planted. */
  aircraftGroundOffset?: number;
  /** Optional absolute world-space authored route. The first/last points are lift-off/touchdown. */
  routePoints?: readonly THREE.Vector3[];
  propellerSpinAxis?: THREE.Vector3;
  wheelSpinAxis?: THREE.Vector3;
  mainWheelRadius?: number;
  auxiliaryWheelRadius?: number;
  /** Conservative radius used to keep the spinning propeller envelope above the runway. */
  propellerSafetyRadius?: number;
}

interface TimedPhase {
  phase: Exclude<FlightPhase, 'parked' | 'complete'>;
  duration: number;
}

const TIMED_PHASES: readonly TimedPhase[] = [
  { phase: 'anticipation', duration: 1.6 },
  { phase: 'prop-spin-up', duration: 2.6 },
  { phase: 'takeoff-roll', duration: 5.4 },
  { phase: 'rotation', duration: 1.4 },
  { phase: 'liftoff', duration: 2.4 },
  { phase: 'climb', duration: 5.0 },
  { phase: 'scenic-outbound', duration: 5.0 },
  { phase: 'scenic-turn', duration: 6.0 },
  { phase: 'return', duration: 4.5 },
  { phase: 'descent', duration: 4.0 },
  { phase: 'final-approach', duration: 3.1 },
  { phase: 'touchdown', duration: 1.8 },
  { phase: 'rollout', duration: 7.4 },
  { phase: 'stopping', duration: 2.2 },
  { phase: 'finale', duration: 2.8 },
];

const PRE_AIRBORNE_SECONDS = 1.6 + 2.6 + 5.4 + 1.4;
export const FLIGHT_SEQUENCE_SECONDS = TIMED_PHASES.reduce(
  (total, segment) => total + segment.duration,
  0,
);

const TAKEOFF_GROUND_SECONDS = 5.4 + 1.4;
const TAKEOFF_ROLL_START_SECONDS = 1.6 + 2.6;
const ROUTE_SAMPLE_COUNT = 900;
const TWO_PI = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;

const DEFAULT_RUNWAY: FlightRunwayLayout = {
  centerlineX: 0,
  surfaceY: 0,
  parkingZ: -112,
  takeoffEndZ: 105,
  touchdownZ: -104,
  finalStopZ: 124,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function smootherstep(value: number): number {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function sinePulse(value: number, start: number, end: number): number {
  if (value <= start || value >= end) return 0;
  return Math.sin(((value - start) / (end - start)) * Math.PI);
}

function hermitePosition(
  start: number,
  end: number,
  startVelocity: number,
  endVelocity: number,
  duration: number,
  progress: number,
): number {
  const t = clamp01(progress);
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * start + h10 * duration * startVelocity + h01 * end + h11 * duration * endVelocity;
}

function hermiteVelocity(
  start: number,
  end: number,
  startVelocity: number,
  endVelocity: number,
  duration: number,
  progress: number,
): number {
  const t = clamp01(progress);
  const t2 = t * t;
  const dh00 = 6 * t2 - 6 * t;
  const dh10 = 3 * t2 - 4 * t + 1;
  const dh01 = -6 * t2 + 6 * t;
  const dh11 = 3 * t2 - 2 * t;
  return (
    dh00 * start +
    dh10 * duration * startVelocity +
    dh01 * end +
    dh11 * duration * endVelocity
  ) / duration;
}

export class FlightSequence {
  private readonly root: THREE.Object3D;
  private readonly propeller?: THREE.Object3D;
  private readonly mainWheels: THREE.Object3D[];
  private readonly auxiliaryWheel?: THREE.Object3D;
  private readonly propellerBaseQuaternion?: THREE.Quaternion;
  private readonly mainWheelBaseQuaternions: THREE.Quaternion[];
  private readonly auxiliaryWheelBaseQuaternion?: THREE.Quaternion;
  private readonly propellerAxis = new THREE.Vector3(0, 0, 1);
  private readonly wheelAxis = new THREE.Vector3(1, 0, 0);
  private readonly spinQuaternion = new THREE.Quaternion();
  private readonly yawQuaternion = new THREE.Quaternion();
  private readonly pitchQuaternion = new THREE.Quaternion();
  private readonly bankQuaternion = new THREE.Quaternion();
  private readonly orientationQuaternion = new THREE.Quaternion();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private readonly pitchAxis = new THREE.Vector3(1, 0, 0);
  private readonly forwardAxis = new THREE.Vector3(0, 0, 1);
  private readonly sampledPosition = new THREE.Vector3();
  private readonly sampledTangent = new THREE.Vector3(0, 0, 1);
  private readonly routeSamples: Float32Array;
  private readonly runway: FlightRunwayLayout;
  private readonly groundRootY: number;
  private readonly routeLength: number;
  private readonly routeStartZ: number;
  private readonly routeEndZ: number;
  private readonly mainWheelRadius: number;
  private readonly auxiliaryWheelRadius: number;
  private readonly propellerSafetyRadius: number;
  private readonly supportPoint = new THREE.Vector3();
  private readonly mutableState: FlightSnapshot = {
    mode: 'autopilot',
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
    cameraShot: 'inspection',
    completed: false,
    running: false,
    inspectionAllowed: true,
    position: new THREE.Vector3(),
  };

  private active = false;
  private propellerAngle = 0;
  private mainWheelAngle = 0;
  private auxiliaryWheelAngle = 0;
  private mainWheelAngularSpeed = 0;
  private auxiliaryWheelAngularSpeed = 0;

  constructor(rig: AircraftMotionRig, options: FlightSequenceOptions = {}) {
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
    };
    this.groundRootY = this.runway.surfaceY + (options.aircraftGroundOffset ?? 0);
    this.mainWheelRadius = Math.max(0.05, options.mainWheelRadius ?? 0.68);
    this.auxiliaryWheelRadius = Math.max(0.03, options.auxiliaryWheelRadius ?? 0.24);
    this.propellerSafetyRadius = Math.max(0.05, options.propellerSafetyRadius ?? 0);

    if (options.propellerSpinAxis) this.propellerAxis.copy(options.propellerSpinAxis);
    if (this.propellerAxis.lengthSq() < 0.0001) this.propellerAxis.set(0, 0, 1);
    this.propellerAxis.normalize();
    if (options.wheelSpinAxis) this.wheelAxis.copy(options.wheelSpinAxis);
    if (this.wheelAxis.lengthSq() < 0.0001) this.wheelAxis.set(1, 0, 0);
    this.wheelAxis.normalize();

    const routePoints = options.routePoints
      ? options.routePoints.map((point) => point.clone())
      : this.createDefaultRoute();
    if (routePoints.length < 4) {
      throw new Error('FlightSequence requires at least four airborne route points.');
    }
    this.routeStartZ = routePoints[0].z;
    this.routeEndZ = routePoints[routePoints.length - 1].z;
    const route = new THREE.CatmullRomCurve3(routePoints, false, 'centripetal', 0.5);
    route.arcLengthDivisions = ROUTE_SAMPLE_COUNT * 2;
    this.routeLength = route.getLength();
    this.routeSamples = new Float32Array((ROUTE_SAMPLE_COUNT + 1) * 3);
    const sample = new THREE.Vector3();
    for (let index = 0; index <= ROUTE_SAMPLE_COUNT; index += 1) {
      route.getPointAt(index / ROUTE_SAMPLE_COUNT, sample);
      const offset = index * 3;
      this.routeSamples[offset] = sample.x;
      this.routeSamples[offset + 1] = sample.y;
      this.routeSamples[offset + 2] = sample.z;
    }

    this.reset();
  }

  get state(): Readonly<FlightSnapshot> {
    return this.mutableState;
  }

  get totalDuration(): number {
    return FLIGHT_SEQUENCE_SECONDS;
  }

  get airborneDuration(): number {
    return FLIGHT_AIRBORNE_SECONDS;
  }

  start(): boolean {
    if (this.active) return false;
    if (this.mutableState.completed) this.reset();
    this.active = true;
    this.mutableState.running = true;
    this.evaluateTimeline();
    return true;
  }

  replay(): void {
    this.reset();
    this.start();
  }

  reset(): void {
    this.active = false;
    this.propellerAngle = 0;
    this.mainWheelAngle = 0;
    this.auxiliaryWheelAngle = 0;
    this.mainWheelAngularSpeed = 0;
    this.auxiliaryWheelAngularSpeed = 0;

    const state = this.mutableState;
    state.mode = 'autopilot';
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
    state.cameraShot = 'inspection';
    state.completed = false;
    state.running = false;
    state.inspectionAllowed = true;

    this.root.position.set(this.runway.centerlineX, this.groundRootY, this.runway.parkingZ);
    this.root.quaternion.identity();
    state.position.copy(this.root.position);
    this.applyMechanicalPose();
  }

  update(deltaSeconds: number): Readonly<FlightSnapshot> {
    if (!this.active) return this.mutableState;
    const delta = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
    const previousY = this.root.position.y;
    this.mutableState.elapsed = Math.min(
      FLIGHT_SEQUENCE_SECONDS,
      this.mutableState.elapsed + delta,
    );

    if (this.mutableState.elapsed >= FLIGHT_SEQUENCE_SECONDS) {
      this.active = false;
      this.mutableState.completed = true;
      this.mutableState.running = false;
    }

    this.evaluateTimeline();
    this.mutableState.verticalSpeed = delta > 0 ? (this.root.position.y - previousY) / delta : 0;
    this.updateMechanicalAnimation(delta);
    return this.mutableState;
  }

  private evaluateTimeline(): void {
    const state = this.mutableState;
    if (state.completed) {
      state.phase = 'complete';
      state.phaseProgress = 1;
    } else {
      let cursor = 0;
      for (const segment of TIMED_PHASES) {
        const end = cursor + segment.duration;
        if (state.elapsed < end) {
          state.phase = segment.phase;
          state.phaseProgress = clamp01((state.elapsed - cursor) / segment.duration);
          break;
        }
        cursor = end;
      }
    }

    state.normalizedProgress = clamp01(state.elapsed / FLIGHT_SEQUENCE_SECONDS);
    state.airborneSeconds = Math.min(
      FLIGHT_AIRBORNE_SECONDS,
      Math.max(0, state.elapsed - PRE_AIRBORNE_SECONDS),
    );
    state.airborneProgress = state.airborneSeconds / FLIGHT_AIRBORNE_SECONDS;
    state.running = this.active;
    state.inspectionAllowed = state.phase === 'parked' || state.phase === 'complete';
    state.cameraShot = this.selectCameraShot(state.phase, state.airborneSeconds);

    this.evaluatePose();
    state.altitude = Math.max(0, this.root.position.y - this.groundRootY);
    state.throttle = THREE.MathUtils.clamp(state.propellerRpm / 2450, 0, 1);
    state.stall = false;
    state.crashed = false;
    state.onGround = state.wheelContact.all;
    state.position.copy(this.root.position);
  }

  private evaluatePose(): void {
    const state = this.mutableState;
    let pitch = 0;
    let bank = 0;
    let yaw = 0;
    let speed = 0;

    switch (state.phase) {
      case 'parked':
      case 'manual-ready':
      case 'manual-flight':
      case 'crashed':
      case 'anticipation':
      case 'prop-spin-up':
        this.root.position.set(this.runway.centerlineX, this.groundRootY, this.runway.parkingZ);
        break;

      case 'takeoff-roll':
      case 'rotation': {
        const takeoffElapsed = state.elapsed - TAKEOFF_ROLL_START_SECONDS;
        const progress = clamp01(takeoffElapsed / TAKEOFF_GROUND_SECONDS);
        const accelerated = progress * progress;
        this.root.position.set(
          this.runway.centerlineX,
          this.groundRootY,
          lerp(this.runway.parkingZ, this.routeStartZ, accelerated),
        );
        speed = Math.abs(
          (2 * (this.routeStartZ - this.runway.parkingZ) * progress) / TAKEOFF_GROUND_SECONDS,
        );
        if (state.phase === 'rotation') {
          pitch = lerp(0, 9 * DEG_TO_RAD, smootherstep(state.phaseProgress));
        }
        break;
      }

      case 'liftoff':
      case 'climb':
      case 'scenic-outbound':
      case 'scenic-turn':
      case 'return':
      case 'descent':
      case 'final-approach': {
        this.sampleRoute(state.airborneProgress, this.sampledPosition, this.sampledTangent);
        this.root.position.copy(this.sampledPosition);
        speed = this.routeLength / FLIGHT_AIRBORNE_SECONDS;
        yaw = Math.atan2(this.sampledTangent.x, this.sampledTangent.z);
        const horizontalSpeed = Math.hypot(this.sampledTangent.x, this.sampledTangent.z);
        const flightPathPitch = Math.atan2(this.sampledTangent.y, horizontalSpeed);
        const cruiseBlend = smoothstep((state.airborneSeconds - 2) / 7);
        let angleOfAttack = lerp(3.2, 1.7, cruiseBlend) * DEG_TO_RAD;
        if (state.airborneSeconds > 23) {
          angleOfAttack = lerp(
            2.1,
            5.2,
            smootherstep((state.airborneSeconds - 23) / 7),
          ) * DEG_TO_RAD;
        }
        pitch = flightPathPitch + angleOfAttack;
        if (state.airborneSeconds > 28.4) {
          pitch = lerp(
            pitch,
            4.8 * DEG_TO_RAD,
            smootherstep((state.airborneSeconds - 28.4) / 1.6),
          );
        }
        bank = (
          -13 * sinePulse(state.airborneSeconds, 4.6, 12.2) -
          15 * sinePulse(state.airborneSeconds, 11.2, 21.5) +
          6 * sinePulse(state.airborneSeconds, 22.1, 26.8)
        ) * DEG_TO_RAD;
        break;
      }

      case 'touchdown': {
        const progress = state.phaseProgress;
        const entrySpeed = this.routeLength / FLIGHT_AIRBORNE_SECONDS;
        this.root.position.set(
          this.runway.centerlineX,
          this.groundRootY,
          hermitePosition(
            this.routeEndZ,
            -24,
            entrySpeed,
            38,
            1.8,
            progress,
          ),
        );
        speed = Math.max(0, hermiteVelocity(this.routeEndZ, -24, entrySpeed, 38, 1.8, progress));
        const flareProgress = smootherstep(progress / 0.58);
        pitch = lerp(4.8, 0, flareProgress) * DEG_TO_RAD;
        break;
      }

      case 'rollout': {
        const progress = state.phaseProgress;
        this.root.position.set(
          this.runway.centerlineX,
          this.groundRootY,
          hermitePosition(-24, 115, 38, 5.5, 7.4, progress),
        );
        speed = Math.max(0, hermiteVelocity(-24, 115, 38, 5.5, 7.4, progress));
        pitch = 0;
        break;
      }

      case 'stopping': {
        const progress = state.phaseProgress;
        this.root.position.set(
          this.runway.centerlineX,
          this.groundRootY,
          hermitePosition(115, this.runway.finalStopZ, 5.5, 0, 2.2, progress),
        );
        speed = Math.max(
          0,
          hermiteVelocity(115, this.runway.finalStopZ, 5.5, 0, 2.2, progress),
        );
        break;
      }

      case 'finale':
      case 'complete':
        this.root.position.set(
          this.runway.centerlineX,
          this.groundRootY,
          this.runway.finalStopZ,
        );
        break;
    }

    state.speed = speed;
    state.pitch = pitch;
    state.bank = bank;
    state.yaw = yaw;
    this.yawQuaternion.setFromAxisAngle(this.upAxis, yaw);
    this.pitchQuaternion.setFromAxisAngle(this.pitchAxis, -pitch);
    this.bankQuaternion.setFromAxisAngle(this.forwardAxis, bank);
    this.orientationQuaternion
      .copy(this.yawQuaternion)
      .multiply(this.pitchQuaternion)
      .multiply(this.bankQuaternion);
    this.root.quaternion.copy(this.orientationQuaternion);
    this.constrainGroundEnvelope();
    this.evaluateContact();
    state.propellerRpm = this.evaluatePropellerRpm();
  }

  private evaluateContact(): void {
    const state = this.mutableState;
    const contactTolerance = 0.012;
    const mainClearance = Math.min(
      ...this.mainWheels.map((wheel) => this.supportClearance(wheel.position, this.mainWheelRadius)),
    );
    const auxiliaryClearance = this.auxiliaryWheel
      ? this.supportClearance(this.auxiliaryWheel.position, this.auxiliaryWheelRadius)
      : Number.POSITIVE_INFINITY;

    state.wheelContact.main = mainClearance <= contactTolerance;
    state.wheelContact.auxiliary = auxiliaryClearance <= contactTolerance;
    state.wheelContact.all = state.wheelContact.main && state.wheelContact.auxiliary;
  }

  /**
   * Keeps the complete rolling/propeller support envelope above the runway while the
   * aircraft pitches through rotation and flare. This lets the root follow the authored
   * route without treating its world origin as a physical landing-gear pivot.
   */
  private constrainGroundEnvelope(): void {
    if (this.root.position.y - this.runway.surfaceY > 3) return;

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

    const targetClearance = this.targetGroundEnvelopeClearance();
    if (minimumClearance < targetClearance) {
      this.root.position.y += targetClearance - minimumClearance;
    }
  }

  private targetGroundEnvelopeClearance(): number {
    const state = this.mutableState;
    if (state.phase === 'rotation') return 0.06 * smootherstep(state.phaseProgress);
    if (state.phase === 'liftoff') return 0.06;
    if (state.phase === 'final-approach') return 0.08;
    if (state.phase !== 'touchdown') return 0;

    if (state.phaseProgress < 0.58) {
      return lerp(0.08, 0.025, smootherstep(state.phaseProgress / 0.58));
    }
    return lerp(
      0.025,
      0,
      smootherstep((state.phaseProgress - 0.58) / 0.18),
    );
  }

  private supportClearance(localCenter: THREE.Vector3, radius: number): number {
    this.supportPoint.copy(localCenter).applyQuaternion(this.orientationQuaternion);
    return this.root.position.y + this.supportPoint.y - radius - this.runway.surfaceY;
  }

  private evaluatePropellerRpm(): number {
    const state = this.mutableState;
    switch (state.phase) {
      case 'parked':
      case 'manual-ready':
      case 'manual-flight':
      case 'crashed':
      case 'anticipation':
      case 'complete':
        return 0;
      case 'prop-spin-up':
        return lerp(0, 2150, smootherstep(state.phaseProgress));
      case 'takeoff-roll':
        return lerp(2150, 2450, smoothstep(state.phaseProgress));
      case 'rotation':
      case 'liftoff':
      case 'climb':
        return 2450;
      case 'scenic-outbound':
      case 'scenic-turn':
        return 2180;
      case 'return':
        return 2050;
      case 'descent':
        return lerp(2050, 1780, smoothstep(state.phaseProgress));
      case 'final-approach':
        return lerp(1780, 1550, smoothstep(state.phaseProgress));
      case 'touchdown':
        return lerp(1550, 980, smoothstep(state.phaseProgress));
      case 'rollout':
        return lerp(980, 280, smootherstep(state.phaseProgress));
      case 'stopping':
        return lerp(280, 0, smootherstep(state.phaseProgress));
      case 'finale':
        return 0;
    }
  }

  private updateMechanicalAnimation(deltaSeconds: number): void {
    const state = this.mutableState;
    this.propellerAngle = (
      this.propellerAngle + (state.propellerRpm * TWO_PI * deltaSeconds) / 60
    ) % TWO_PI;

    if (state.wheelContact.main) {
      this.mainWheelAngularSpeed = state.speed / this.mainWheelRadius;
    } else {
      this.mainWheelAngularSpeed *= Math.exp(-deltaSeconds / 2.4);
    }
    if (state.wheelContact.auxiliary) {
      this.auxiliaryWheelAngularSpeed = state.speed / this.auxiliaryWheelRadius;
    } else {
      this.auxiliaryWheelAngularSpeed *= Math.exp(-deltaSeconds / 1.8);
    }
    this.mainWheelAngle = (this.mainWheelAngle + this.mainWheelAngularSpeed * deltaSeconds) % TWO_PI;
    this.auxiliaryWheelAngle = (
      this.auxiliaryWheelAngle + this.auxiliaryWheelAngularSpeed * deltaSeconds
    ) % TWO_PI;

    state.propellerAngle = this.propellerAngle;
    state.wheelRotation = this.mainWheelAngle;
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

  private sampleRoute(progress: number, position: THREE.Vector3, tangent: THREE.Vector3): void {
    const scaled = clamp01(progress) * ROUTE_SAMPLE_COUNT;
    const lower = Math.min(ROUTE_SAMPLE_COUNT - 1, Math.floor(scaled));
    const upper = lower + 1;
    const blend = scaled - lower;
    const lowerOffset = lower * 3;
    const upperOffset = upper * 3;

    position.set(
      lerp(this.routeSamples[lowerOffset], this.routeSamples[upperOffset], blend),
      lerp(this.routeSamples[lowerOffset + 1], this.routeSamples[upperOffset + 1], blend),
      lerp(this.routeSamples[lowerOffset + 2], this.routeSamples[upperOffset + 2], blend),
    );

    const before = Math.max(0, lower - 1) * 3;
    const after = Math.min(ROUTE_SAMPLE_COUNT, upper + 1) * 3;
    tangent.set(
      this.routeSamples[after] - this.routeSamples[before],
      this.routeSamples[after + 1] - this.routeSamples[before + 1],
      this.routeSamples[after + 2] - this.routeSamples[before + 2],
    );
    if (tangent.lengthSq() < 0.000001) tangent.set(0, 0, 1);
    else tangent.normalize();
  }

  private selectCameraShot(phase: FlightPhase, airborneSeconds: number): CinematicShotName {
    switch (phase) {
      case 'parked':
      case 'manual-ready':
      case 'manual-flight':
      case 'crashed':
        return 'inspection';
      case 'anticipation':
      case 'prop-spin-up':
      case 'takeoff-roll':
        return 'runway-side';
      case 'rotation':
        return 'rotation-track';
      case 'liftoff':
      case 'climb':
      case 'scenic-outbound':
      case 'scenic-turn':
      case 'return':
      case 'descent':
      case 'final-approach':
        if (airborneSeconds < 5.5) return 'chase-climb';
        if (airborneSeconds < 10.3) return 'wide-scenic';
        if (airborneSeconds < 14.7) return 'wing-side';
        if (airborneSeconds < 21.7) return 'aerial-chase';
        if (airborneSeconds < 27.1) return 'wide-scenic';
        return 'approach';
      case 'touchdown':
        return 'touchdown';
      case 'rollout':
      case 'stopping':
        return 'rollout';
      case 'finale':
      case 'complete':
        return 'final-hero';
    }
  }

  private createDefaultRoute(): THREE.Vector3[] {
    const x = this.runway.centerlineX;
    const y = this.groundRootY;
    return [
      new THREE.Vector3(x, y, this.runway.takeoffEndZ),
      new THREE.Vector3(x, y + 16, 160),
      new THREE.Vector3(x, y + 50, 250),
      new THREE.Vector3(x + 35, y + 78, 340),
      new THREE.Vector3(x + 120, y + 96, 385),
      new THREE.Vector3(x + 205, y + 108, 330),
      new THREE.Vector3(x + 240, y + 110, 185),
      new THREE.Vector3(x + 232, y + 108, 15),
      new THREE.Vector3(x + 210, y + 102, -155),
      new THREE.Vector3(x + 175, y + 90, -275),
      new THREE.Vector3(x + 110, y + 78, -350),
      new THREE.Vector3(x + 35, y + 64, -370),
      new THREE.Vector3(x - 25, y + 52, -335),
      new THREE.Vector3(x - 55, y + 42, -270),
      new THREE.Vector3(x - 32, y + 34, -215),
      new THREE.Vector3(x - 6, y + 24, -190),
      new THREE.Vector3(x, y + 15, -165),
      new THREE.Vector3(x, y + 6, -128),
      new THREE.Vector3(x, y, this.runway.touchdownZ),
    ];
  }
}
