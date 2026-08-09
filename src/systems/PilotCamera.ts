import * as THREE from 'three';
import type { FlightSnapshot } from './FlightSequence';

export class PilotCamera {
  private readonly aircraftPosition = new THREE.Vector3();
  private readonly aircraftQuaternion = new THREE.Quaternion();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly desiredPosition = new THREE.Vector3();
  private readonly currentPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly currentTarget = new THREE.Vector3();
  private initialized = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly aircraft: THREE.Object3D,
  ) {}

  update(deltaSeconds: number, snapshot: Readonly<FlightSnapshot>): void {
    const delta = Number.isFinite(deltaSeconds) ? THREE.MathUtils.clamp(deltaSeconds, 0, 0.1) : 0;
    this.aircraft.getWorldPosition(this.aircraftPosition);
    this.aircraft.getWorldQuaternion(this.aircraftQuaternion);
    this.forward.set(0, 0, 1).applyQuaternion(this.aircraftQuaternion).normalize();
    // This model's nose is +Z, making the pilot's right-hand side local -X.
    this.right.set(-1, 0, 0).applyQuaternion(this.aircraftQuaternion).normalize();

    const speed01 = THREE.MathUtils.clamp(snapshot.speed / 72, 0, 1);
    const airborne01 = THREE.MathUtils.smoothstep(snapshot.altitude, 0.5, 8);
    const followDistance = THREE.MathUtils.lerp(17, 24, speed01);
    const followHeight = THREE.MathUtils.lerp(5.6, 8.2, airborne01);
    const sideOffset = THREE.MathUtils.lerp(4.2, 2.1, airborne01);

    this.desiredPosition
      .copy(this.aircraftPosition)
      .addScaledVector(this.forward, -followDistance)
      .addScaledVector(this.worldUp, followHeight)
      .addScaledVector(this.right, sideOffset);
    this.desiredTarget
      .copy(this.aircraftPosition)
      .addScaledVector(this.forward, THREE.MathUtils.lerp(12, 24, speed01))
      .addScaledVector(this.worldUp, 2.1 + Math.max(0, snapshot.pitch) * 5);

    if (!this.initialized) {
      this.currentPosition.copy(this.desiredPosition);
      this.currentTarget.copy(this.desiredTarget);
      this.initialized = true;
    }

    const positionAlpha = 1 - Math.exp(-delta * 5.2);
    const targetAlpha = 1 - Math.exp(-delta * 7.2);
    this.currentPosition.lerp(this.desiredPosition, positionAlpha);
    this.currentTarget.lerp(this.desiredTarget, targetAlpha);
    this.camera.position.copy(this.currentPosition);
    this.camera.up.copy(this.worldUp);
    this.camera.lookAt(this.currentTarget);

    const targetFov = THREE.MathUtils.lerp(43, 52, speed01);
    const nextFov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-delta * 4.5));
    if (Math.abs(nextFov - this.camera.fov) > 0.001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  reset(): void {
    this.initialized = false;
  }
}
