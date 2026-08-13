import * as THREE from 'three';
import type { PilotIntent } from './PilotInput';

export type CarGear = 'drive' | 'neutral' | 'reverse';

export type GroundCarSnapshot = {
  enabled: boolean;
  elapsed: number;
  position: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  steeringAngle: number;
  throttle: number;
  brake: boolean;
  terrainHeight: number;
  wheelRotation: number;
  engineRpm: number;
  gear: CarGear;
};

export type GroundCarDiagnostics = {
  physics: 'custom-kinematic-bicycle';
  fixedStep: number;
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  wheelbase: number;
  wheelRadius: number;
  state: {
    enabled: boolean;
    speed: number;
    steeringAngle: number;
    throttle: number;
    brake: boolean;
    wheelRotation: number;
    engineRpm: number;
    gear: CarGear;
    terrainHeight: number;
    position: { x: number; y: number; z: number };
    yaw: number;
    pitch: number;
    roll: number;
  };
};

export type GroundCarControllerOptions = {
  surfaceHeightAt: (worldX: number, worldZ: number) => number;
  wheelPivots: readonly THREE.Object3D[];
  wheelbase: number;
  wheelRadius: number;
  halfTrack?: number;
  maxForwardSpeed?: number;
  maxReverseSpeed?: number;
};

const FIXED_STEP = 1 / 120;
const MAX_ACCUMULATED_TIME = 0.2;
const MAX_STEERING_ANGLE = THREE.MathUtils.degToRad(32);
const MAX_FORWARD_SPEED = 38;
const MAX_REVERSE_SPEED = 9;
const FORWARD_ACCELERATION = 8.2;
const REVERSE_ACCELERATION = 4.6;
const SERVICE_BRAKE_DECELERATION = 17;
const HANDBRAKE_DECELERATION = 25;
const ROLLING_DECELERATION = 1.05;
const AERODYNAMIC_DRAG = 0.012;
const STEERING_RESPONSE = 5.8;

const moveToward = (value: number, target: number, maximumDelta: number): number => {
  if (Math.abs(target - value) <= maximumDelta) return target;
  return value + Math.sign(target - value) * maximumDelta;
};

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

export class GroundCarController {
  private readonly spawnPosition = new THREE.Vector3();
  private readonly spawnYaw: number;
  private readonly wheelPivots: readonly THREE.Object3D[];
  private readonly surfaceHeightAt: GroundCarControllerOptions['surfaceHeightAt'];
  private readonly wheelbase: number;
  private readonly wheelRadius: number;
  private readonly halfTrack: number;
  private readonly maxForwardSpeed: number;
  private readonly maxReverseSpeed: number;
  private readonly mutableState: GroundCarSnapshot = {
    enabled: false,
    elapsed: 0,
    position: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: 0,
    steeringAngle: 0,
    throttle: 0,
    brake: false,
    terrainHeight: 0,
    wheelRotation: 0,
    engineRpm: 0,
    gear: 'neutral',
  };

  private enabledState = false;
  private accumulator = 0;
  private speed = 0;
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private steeringAngle = 0;
  private wheelRotation = 0;
  private terrainHeight = 0;
  private readonly terrainContact = new THREE.Vector3();

  constructor(
    private readonly root: THREE.Object3D,
    options: GroundCarControllerOptions,
  ) {
    this.surfaceHeightAt = options.surfaceHeightAt;
    this.wheelPivots = options.wheelPivots;
    this.wheelbase = Math.max(0.5, finiteOr(options.wheelbase, 2.44));
    this.wheelRadius = Math.max(0.1, finiteOr(options.wheelRadius, 0.38));
    this.halfTrack = Math.max(0.3, finiteOr(options.halfTrack ?? 0.84, 0.84));
    this.maxForwardSpeed = Math.max(1, finiteOr(options.maxForwardSpeed ?? MAX_FORWARD_SPEED, MAX_FORWARD_SPEED));
    this.maxReverseSpeed = Math.max(1, finiteOr(options.maxReverseSpeed ?? MAX_REVERSE_SPEED, MAX_REVERSE_SPEED));
    this.spawnPosition.copy(root.position);
    this.spawnYaw = root.rotation.y;
    this.reset();
  }

  get state(): Readonly<GroundCarSnapshot> {
    return this.mutableState;
  }

  get diagnostics(): Readonly<GroundCarDiagnostics> {
    const state = this.mutableState;
    return {
      physics: 'custom-kinematic-bicycle',
      fixedStep: FIXED_STEP,
      maxForwardSpeed: this.maxForwardSpeed,
      maxReverseSpeed: this.maxReverseSpeed,
      wheelbase: this.wheelbase,
      wheelRadius: this.wheelRadius,
      state: {
        enabled: state.enabled,
        speed: state.speed,
        steeringAngle: state.steeringAngle,
        throttle: state.throttle,
        brake: state.brake,
        wheelRotation: state.wheelRotation,
        engineRpm: state.engineRpm,
        gear: state.gear,
        terrainHeight: state.terrainHeight,
        position: { x: state.position.x, y: state.position.y, z: state.position.z },
        yaw: state.yaw,
        pitch: state.pitch,
        roll: state.roll,
      },
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabledState = enabled;
    this.mutableState.enabled = enabled;
    this.accumulator = 0;
    if (!enabled) {
      if (Math.abs(this.speed) <= 0.1) this.speed = 0;
      this.steeringAngle = 0;
      this.syncVisuals();
      this.syncState(0, false);
    }
  }

  reset(position: Readonly<THREE.Vector3> = this.spawnPosition, yaw = this.spawnYaw): void {
    this.root.position.set(
      finiteOr(position.x, this.spawnPosition.x),
      finiteOr(position.y, this.spawnPosition.y),
      finiteOr(position.z, this.spawnPosition.z),
    );
    this.yaw = finiteOr(yaw, this.spawnYaw);
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.steeringAngle = 0;
    this.wheelRotation = 0;
    this.accumulator = 0;
    this.mutableState.elapsed = 0;
    this.updateTerrainPose();
    this.syncVisuals();
    this.syncState(0, false);
  }

  update(deltaSeconds: number, intent: Readonly<PilotIntent>): Readonly<GroundCarSnapshot> {
    if (!this.enabledState) return this.mutableState;
    const delta = Number.isFinite(deltaSeconds)
      ? THREE.MathUtils.clamp(deltaSeconds, 0, MAX_ACCUMULATED_TIME)
      : 0;
    this.accumulator = Math.min(MAX_ACCUMULATED_TIME, this.accumulator + delta);
    while (this.accumulator + Number.EPSILON >= FIXED_STEP) {
      this.step(FIXED_STEP, intent);
      this.accumulator -= FIXED_STEP;
    }
    this.syncVisuals();
    this.syncState(intent.throttle, intent.brake);
    return this.mutableState;
  }

  private step(delta: number, intent: Readonly<PilotIntent>): void {
    this.mutableState.elapsed += delta;
    const throttle = THREE.MathUtils.clamp(finiteOr(intent.throttle, 0), -1, 1);
    // The car faces local +Z. In this right-handed +Y-up frame the driver's
    // visual right is local -X, so the input semantic (D/right = +1) needs the
    // same sign conversion as the airplane's ground steering.
    const steeringInput = -THREE.MathUtils.clamp(finiteOr(intent.roll, 0), -1, 1);
    const speedRatio = THREE.MathUtils.smoothstep(Math.abs(this.speed), 7, this.maxForwardSpeed);
    const targetSteering = steeringInput * MAX_STEERING_ANGLE * THREE.MathUtils.lerp(1, 0.38, speedRatio);
    this.steeringAngle = moveToward(
      this.steeringAngle,
      targetSteering,
      STEERING_RESPONSE * delta,
    );

    if (intent.brake) {
      this.speed = moveToward(this.speed, 0, HANDBRAKE_DECELERATION * delta);
    } else if (throttle > 0) {
      if (this.speed < -0.05) {
        this.speed = moveToward(this.speed, 0, SERVICE_BRAKE_DECELERATION * delta);
      } else {
        this.speed += FORWARD_ACCELERATION * throttle * delta;
      }
    } else if (throttle < 0) {
      if (this.speed > 0.05) {
        this.speed = moveToward(this.speed, 0, SERVICE_BRAKE_DECELERATION * delta);
      } else {
        this.speed -= REVERSE_ACCELERATION * -throttle * delta;
      }
    } else {
      const passiveDeceleration = ROLLING_DECELERATION
        + AERODYNAMIC_DRAG * this.speed * this.speed;
      this.speed = moveToward(this.speed, 0, passiveDeceleration * delta);
    }
    this.speed = THREE.MathUtils.clamp(this.speed, -this.maxReverseSpeed, this.maxForwardSpeed);

    if (Math.abs(this.speed) > 0.001) {
      this.yaw += this.speed / this.wheelbase * Math.tan(this.steeringAngle) * delta;
      const travel = this.speed * delta;
      this.root.position.x += Math.sin(this.yaw) * travel;
      this.root.position.z += Math.cos(this.yaw) * travel;
      this.wheelRotation += travel / this.wheelRadius;
    }
    this.updateTerrainPose();
  }

  private updateTerrainPose(): void {
    const halfWheelbase = this.wheelbase * 0.5;
    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    const sample = (localX: number, localZ: number): number => {
      const worldX = this.root.position.x + localX * cosYaw + localZ * sinYaw;
      const worldZ = this.root.position.z - localX * sinYaw + localZ * cosYaw;
      return finiteOr(this.surfaceHeightAt(worldX, worldZ), this.root.position.y);
    };
    const frontLeft = sample(-this.halfTrack, halfWheelbase);
    const frontRight = sample(this.halfTrack, halfWheelbase);
    const rearLeft = sample(-this.halfTrack, -halfWheelbase);
    const rearRight = sample(this.halfTrack, -halfWheelbase);
    const front = (frontLeft + frontRight) * 0.5;
    const rear = (rearLeft + rearRight) * 0.5;
    const left = (frontLeft + rearLeft) * 0.5;
    const right = (frontRight + rearRight) * 0.5;
    this.terrainHeight = (front + rear) * 0.5;
    const targetPitch = THREE.MathUtils.clamp(
      -Math.atan2(front - rear, this.wheelbase),
      -Math.PI / 4,
      Math.PI / 4,
    );
    const targetRoll = THREE.MathUtils.clamp(
      Math.atan2(right - left, this.halfTrack * 2),
      -Math.PI / 4,
      Math.PI / 4,
    );
    // Match the four-wheel support plane immediately. Damping the angles while
    // snapping only Y makes opposite wheels visibly float or penetrate at the
    // runway edge. A rigid pose plus the highest wheel constraint guarantees
    // that no tire is ever placed below its sampled surface.
    this.pitch = targetPitch;
    this.roll = targetRoll;
    this.root.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    let supportedRootY = Number.NEGATIVE_INFINITY;
    for (const [localX, localZ, height] of [
      [-this.halfTrack, halfWheelbase, frontLeft],
      [this.halfTrack, halfWheelbase, frontRight],
      [-this.halfTrack, -halfWheelbase, rearLeft],
      [this.halfTrack, -halfWheelbase, rearRight],
    ] as const) {
      this.terrainContact.set(localX, 0, localZ).applyQuaternion(this.root.quaternion);
      supportedRootY = Math.max(supportedRootY, height - this.terrainContact.y);
    }
    this.root.position.y = finiteOr(supportedRootY, this.terrainHeight);
  }

  private syncVisuals(): void {
    for (let index = 0; index < this.wheelPivots.length; index += 1) {
      const pivot = this.wheelPivots[index];
      pivot.rotation.order = 'YXZ';
      pivot.rotation.x = this.wheelRotation;
      pivot.rotation.y = index < 2 ? this.steeringAngle : 0;
      pivot.rotation.z = 0;
    }
  }

  private syncState(throttle: number, brake: boolean): void {
    const state = this.mutableState;
    state.enabled = this.enabledState;
    state.position.copy(this.root.position);
    state.yaw = this.yaw;
    state.pitch = this.pitch;
    state.roll = this.roll;
    state.speed = this.speed;
    state.steeringAngle = this.steeringAngle;
    state.throttle = THREE.MathUtils.clamp(finiteOr(throttle, 0), -1, 1);
    state.brake = brake;
    state.terrainHeight = this.terrainHeight;
    state.wheelRotation = this.wheelRotation;
    state.engineRpm = this.enabledState
      ? 850 + Math.abs(this.speed) / this.maxForwardSpeed * 4_300 + Math.abs(state.throttle) * 900
      : 0;
    state.gear = this.speed < -0.15 || (Math.abs(this.speed) <= 0.15 && state.throttle < 0)
      ? 'reverse'
      : this.speed > 0.15 || state.throttle > 0 ? 'drive' : 'neutral';
  }
}
