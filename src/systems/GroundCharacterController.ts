import * as THREE from 'three';
import type { CharacterIntent } from './CharacterInput';

export type CharacterAnimationState = 'idle' | 'walk' | 'run' | 'jump';

export type GroundCharacterSnapshot = {
  enabled: boolean;
  elapsed: number;
  position: THREE.Vector3;
  yaw: number;
  speed: number;
  verticalSpeed: number;
  grounded: boolean;
  moving: boolean;
  sprinting: boolean;
  blockedBySlope: boolean;
  terrainHeight: number;
  animation: CharacterAnimationState;
};

export type GroundCharacterDiagnostics = {
  fixedStep: number;
  accumulator: number;
  walkSpeed: number;
  runSpeed: number;
  jumpSpeed: number;
  maximumSlopeDegrees: number;
  maximumStepHeight: number;
  state: {
    enabled: boolean;
    grounded: boolean;
    blockedBySlope: boolean;
    animation: CharacterAnimationState;
    speed: number;
    verticalSpeed: number;
    terrainHeight: number;
    position: { x: number; y: number; z: number };
    yaw: number;
  };
};

export type TerrainHeightResolver = (worldX: number, worldZ: number) => number;

export type GroundCharacterControllerOptions = {
  surfaceHeightAt: TerrainHeightResolver;
  spawnPosition?: Readonly<THREE.Vector3>;
  spawnYaw?: number;
  /** Added to the movement yaw when the imported visual does not face local +Z. */
  visualYawOffset?: number;
  walkSpeed?: number;
  runSpeed?: number;
  groundAcceleration?: number;
  groundDeceleration?: number;
  airControl?: number;
  jumpSpeed?: number;
  gravity?: number;
  maximumSlopeRadians?: number;
  maximumStepHeight?: number;
  rotationResponse?: number;
};

const FIXED_STEP = 1 / 120;
const MAX_ACCUMULATED_TIME = 0.12;
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
const DEFAULT_WALK_SPEED = 2.35;
const DEFAULT_RUN_SPEED = 5.25;
const DEFAULT_GROUND_ACCELERATION = 18;
const DEFAULT_GROUND_DECELERATION = 24;
const DEFAULT_AIR_CONTROL = 0.38;
const DEFAULT_JUMP_SPEED = 4.65;
const DEFAULT_GRAVITY = 12.5;
const DEFAULT_MAXIMUM_SLOPE = 38 * Math.PI / 180;
const DEFAULT_MAXIMUM_STEP_HEIGHT = 0.48;
const DEFAULT_ROTATION_RESPONSE = 13;

const finiteOr = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? value as number : fallback;

const positiveOr = (value: number | undefined, fallback: number): number =>
  Math.max(0.001, finiteOr(value, fallback));

const shortestAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export class GroundCharacterController {
  private readonly surfaceHeightAt: TerrainHeightResolver;
  private readonly spawnPosition = new THREE.Vector3();
  private readonly inputForward = new THREE.Vector3();
  private readonly inputRight = new THREE.Vector3();
  private readonly desiredDirection = new THREE.Vector3();
  private readonly targetVelocity = new THREE.Vector3();
  private readonly horizontalVelocity = new THREE.Vector3();
  private readonly velocityDelta = new THREE.Vector3();
  private readonly candidatePosition = new THREE.Vector3();
  private readonly walkSpeed: number;
  private readonly runSpeed: number;
  private readonly groundAcceleration: number;
  private readonly groundDeceleration: number;
  private readonly airControl: number;
  private readonly jumpSpeed: number;
  private readonly gravity: number;
  private readonly maximumSlopeRadians: number;
  private readonly maximumStepHeight: number;
  private readonly rotationResponse: number;
  private readonly visualYawOffset: number;
  private readonly spawnYaw: number;
  private readonly mutableState: GroundCharacterSnapshot = {
    enabled: false,
    elapsed: 0,
    position: new THREE.Vector3(),
    yaw: 0,
    speed: 0,
    verticalSpeed: 0,
    grounded: true,
    moving: false,
    sprinting: false,
    blockedBySlope: false,
    terrainHeight: 0,
    animation: 'idle',
  };

  private enabledState = false;
  private accumulator = 0;
  private yaw = 0;
  private verticalSpeed = 0;
  private grounded = true;
  private jumpWasHeld = false;
  private blockedBySlope = false;
  private lastTerrainHeight = 0;

  constructor(
    private readonly root: THREE.Object3D,
    options: GroundCharacterControllerOptions,
  ) {
    this.surfaceHeightAt = options.surfaceHeightAt;
    this.spawnPosition.copy(options.spawnPosition ?? root.position);
    this.visualYawOffset = finiteOr(options.visualYawOffset, 0);
    this.spawnYaw = finiteOr(options.spawnYaw, root.rotation.y - this.visualYawOffset);
    this.walkSpeed = positiveOr(options.walkSpeed, DEFAULT_WALK_SPEED);
    this.runSpeed = Math.max(this.walkSpeed, positiveOr(options.runSpeed, DEFAULT_RUN_SPEED));
    this.groundAcceleration = positiveOr(
      options.groundAcceleration,
      DEFAULT_GROUND_ACCELERATION,
    );
    this.groundDeceleration = positiveOr(
      options.groundDeceleration,
      DEFAULT_GROUND_DECELERATION,
    );
    this.airControl = THREE.MathUtils.clamp(
      finiteOr(options.airControl, DEFAULT_AIR_CONTROL),
      0,
      1,
    );
    this.jumpSpeed = positiveOr(options.jumpSpeed, DEFAULT_JUMP_SPEED);
    this.gravity = positiveOr(options.gravity, DEFAULT_GRAVITY);
    this.maximumSlopeRadians = THREE.MathUtils.clamp(
      finiteOr(options.maximumSlopeRadians, DEFAULT_MAXIMUM_SLOPE),
      0,
      Math.PI / 2,
    );
    this.maximumStepHeight = Math.max(
      0,
      finiteOr(options.maximumStepHeight, DEFAULT_MAXIMUM_STEP_HEIGHT),
    );
    this.rotationResponse = positiveOr(options.rotationResponse, DEFAULT_ROTATION_RESPONSE);
    this.reset();
  }

  get state(): Readonly<GroundCharacterSnapshot> {
    return this.mutableState;
  }

  get diagnostics(): Readonly<GroundCharacterDiagnostics> {
    const state = this.mutableState;
    return {
      fixedStep: FIXED_STEP,
      accumulator: this.accumulator,
      walkSpeed: this.walkSpeed,
      runSpeed: this.runSpeed,
      jumpSpeed: this.jumpSpeed,
      maximumSlopeDegrees: this.maximumSlopeRadians * 180 / Math.PI,
      maximumStepHeight: this.maximumStepHeight,
      state: {
        enabled: state.enabled,
        grounded: state.grounded,
        blockedBySlope: state.blockedBySlope,
        animation: state.animation,
        speed: state.speed,
        verticalSpeed: state.verticalSpeed,
        terrainHeight: state.terrainHeight,
        position: {
          x: state.position.x,
          y: state.position.y,
          z: state.position.z,
        },
        yaw: state.yaw,
      },
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabledState = enabled;
    this.mutableState.enabled = enabled;
    if (enabled) return;

    this.accumulator = 0;
    this.horizontalVelocity.set(0, 0, 0);
    this.verticalSpeed = 0;
    this.grounded = true;
    this.jumpWasHeld = false;
    this.blockedBySlope = false;
    this.lastTerrainHeight = this.sampleTerrain(
      this.root.position.x,
      this.root.position.z,
      this.root.position.y,
    );
    this.root.position.y = this.lastTerrainHeight;
    this.syncState(false);
  }

  reset(position: Readonly<THREE.Vector3> = this.spawnPosition, yaw = this.spawnYaw): void {
    const safeX = finiteOr(position.x, this.spawnPosition.x);
    const safeZ = finiteOr(position.z, this.spawnPosition.z);
    this.lastTerrainHeight = this.sampleTerrain(safeX, safeZ, finiteOr(position.y, 0));
    this.root.position.set(safeX, this.lastTerrainHeight, safeZ);
    this.yaw = finiteOr(yaw, this.spawnYaw);
    this.root.rotation.set(0, this.yaw + this.visualYawOffset, 0);
    this.accumulator = 0;
    this.horizontalVelocity.set(0, 0, 0);
    this.verticalSpeed = 0;
    this.grounded = true;
    this.jumpWasHeld = false;
    this.blockedBySlope = false;
    this.mutableState.elapsed = 0;
    this.syncState(false);
  }

  update(
    deltaSeconds: number,
    intent: Readonly<CharacterIntent>,
    cameraForward: Readonly<THREE.Vector3> = WORLD_FORWARD,
  ): Readonly<GroundCharacterSnapshot> {
    if (!this.enabledState) return this.mutableState;
    const delta = Number.isFinite(deltaSeconds)
      ? THREE.MathUtils.clamp(deltaSeconds, 0, MAX_ACCUMULATED_TIME)
      : 0;
    this.accumulator = Math.min(MAX_ACCUMULATED_TIME, this.accumulator + delta);
    while (this.accumulator + Number.EPSILON >= FIXED_STEP) {
      this.step(FIXED_STEP, intent, cameraForward);
      this.accumulator -= FIXED_STEP;
    }
    this.syncState(intent.sprint);
    return this.mutableState;
  }

  private step(
    delta: number,
    intent: Readonly<CharacterIntent>,
    cameraForward: Readonly<THREE.Vector3>,
  ): void {
    this.mutableState.elapsed += delta;
    this.blockedBySlope = false;
    this.resolveCameraBasis(cameraForward);

    const inputMagnitude = Math.min(1, Math.hypot(intent.moveX, intent.moveZ));
    this.desiredDirection
      .copy(this.inputForward)
      .multiplyScalar(intent.moveZ)
      .addScaledVector(this.inputRight, intent.moveX);
    if (this.desiredDirection.lengthSq() > 1e-8) this.desiredDirection.normalize();
    else this.desiredDirection.set(0, 0, 0);

    const desiredSpeed = inputMagnitude * (intent.sprint ? this.runSpeed : this.walkSpeed);
    this.targetVelocity.copy(this.desiredDirection).multiplyScalar(desiredSpeed);
    const response = this.targetVelocity.lengthSq() > 0
      ? this.groundAcceleration * (this.grounded ? 1 : this.airControl)
      : this.groundDeceleration * (this.grounded ? 1 : this.airControl);
    this.moveHorizontalVelocityToward(this.targetVelocity, response * delta);

    const jumpPressed = intent.jump && !this.jumpWasHeld;
    this.jumpWasHeld = intent.jump;
    if (jumpPressed && this.grounded) {
      this.grounded = false;
      this.verticalSpeed = this.jumpSpeed;
    }

    this.integrateHorizontal(delta);
    this.integrateVertical(delta);

    if (this.desiredDirection.lengthSq() > 1e-8) {
      const targetYaw = Math.atan2(this.desiredDirection.x, this.desiredDirection.z);
      const yawAlpha = 1 - Math.exp(-this.rotationResponse * delta);
      this.yaw += shortestAngle(targetYaw - this.yaw) * yawAlpha;
    }
    this.root.rotation.set(0, this.yaw + this.visualYawOffset, 0);
  }

  private resolveCameraBasis(cameraForward: Readonly<THREE.Vector3>): void {
    this.inputForward.set(cameraForward.x, 0, cameraForward.z);
    if (this.inputForward.lengthSq() <= 1e-8) {
      this.inputForward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    } else {
      this.inputForward.normalize();
    }
    // Three.js cameras look down local -Z, so screen-right is forward x up.
    // The previous opposite cross product swapped Q/A and D for the player.
    this.inputRight.set(-this.inputForward.z, 0, this.inputForward.x);
  }

  private moveHorizontalVelocityToward(target: THREE.Vector3, maximumChange: number): void {
    this.velocityDelta.subVectors(target, this.horizontalVelocity);
    const difference = this.velocityDelta.length();
    if (difference <= maximumChange || difference <= 1e-8) {
      this.horizontalVelocity.copy(target);
      return;
    }
    this.horizontalVelocity.addScaledVector(this.velocityDelta, maximumChange / difference);
  }

  private integrateHorizontal(delta: number): void {
    const previousX = this.root.position.x;
    const previousZ = this.root.position.z;
    this.candidatePosition.copy(this.root.position).addScaledVector(this.horizontalVelocity, delta);
    const travel = Math.hypot(
      this.candidatePosition.x - previousX,
      this.candidatePosition.z - previousZ,
    );
    if (travel <= 1e-8) return;

    const previousGround = this.sampleTerrain(previousX, previousZ, this.lastTerrainHeight);
    const candidateGround = this.sampleTerrain(
      this.candidatePosition.x,
      this.candidatePosition.z,
      previousGround,
    );
    const rise = candidateGround - previousGround;
    const slope = Math.atan2(Math.abs(rise), travel);
    const impassableGround = this.grounded
      ? rise > this.maximumStepHeight || slope > this.maximumSlopeRadians
      : candidateGround > this.root.position.y + this.maximumStepHeight;

    if (impassableGround) {
      this.horizontalVelocity.set(0, 0, 0);
      this.blockedBySlope = true;
      this.lastTerrainHeight = previousGround;
      return;
    }

    this.root.position.x = this.candidatePosition.x;
    this.root.position.z = this.candidatePosition.z;
    this.lastTerrainHeight = candidateGround;
    if (this.grounded) this.root.position.y = candidateGround;
  }

  private integrateVertical(delta: number): void {
    this.lastTerrainHeight = this.sampleTerrain(
      this.root.position.x,
      this.root.position.z,
      this.lastTerrainHeight,
    );
    if (this.grounded) {
      this.root.position.y = this.lastTerrainHeight;
      this.verticalSpeed = 0;
      return;
    }

    this.verticalSpeed -= this.gravity * delta;
    this.root.position.y += this.verticalSpeed * delta;
    if (this.root.position.y <= this.lastTerrainHeight && this.verticalSpeed <= 0) {
      this.root.position.y = this.lastTerrainHeight;
      this.verticalSpeed = 0;
      this.grounded = true;
    }
  }

  private sampleTerrain(worldX: number, worldZ: number, fallback: number): number {
    const sampled = this.surfaceHeightAt(worldX, worldZ);
    return Number.isFinite(sampled) ? sampled : fallback;
  }

  private syncState(sprintRequested: boolean): void {
    const state = this.mutableState;
    const speed = Math.hypot(this.horizontalVelocity.x, this.horizontalVelocity.z);
    state.enabled = this.enabledState;
    state.position.copy(this.root.position);
    state.yaw = this.yaw;
    state.speed = speed;
    state.verticalSpeed = this.verticalSpeed;
    state.grounded = this.grounded;
    state.moving = speed > 0.06;
    state.sprinting = state.moving && sprintRequested && speed > this.walkSpeed * 1.05;
    state.blockedBySlope = this.blockedBySlope;
    state.terrainHeight = this.lastTerrainHeight;
    state.animation = !this.grounded
      ? 'jump'
      : state.sprinting
        ? 'run'
        : state.moving
          ? 'walk'
          : 'idle';
  }
}
