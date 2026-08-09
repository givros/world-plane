import * as THREE from 'three';

export interface FlightVfxState {
  phase: string;
  speed: number;
  altitude: number;
  propellerRpm: number;
  wheelContact?: boolean;
}

type Particle = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  life: number;
};

const SMOKE_COUNT = 56;
const DUST_COUNT = 42;
const TRAIL_POINTS = 72;

export class FlightVfx {
  readonly group = new THREE.Group();

  private readonly smokeParticles = this.createParticles(SMOKE_COUNT);
  private readonly dustParticles = this.createParticles(DUST_COUNT);
  private readonly smokePositions = new Float32Array(SMOKE_COUNT * 3);
  private readonly smokeColors = new Float32Array(SMOKE_COUNT * 3);
  private readonly dustPositions = new Float32Array(DUST_COUNT * 3);
  private readonly dustColors = new Float32Array(DUST_COUNT * 3);
  private readonly smokeGeometry = new THREE.BufferGeometry();
  private readonly dustGeometry = new THREE.BufferGeometry();
  private readonly smokeMaterial = new THREE.PointsMaterial({
    size: 0.34,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.NormalBlending,
  });
  private readonly dustMaterial = new THREE.PointsMaterial({
    size: 0.44,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    vertexColors: true,
  });
  private readonly leftTrail = this.createTrail('#fff4d8');
  private readonly rightTrail = this.createTrail('#f5a21a');
  private readonly tempPosition = new THREE.Vector3();
  private readonly tempPositionB = new THREE.Vector3();
  private readonly tempForward = new THREE.Vector3();
  private readonly tempUp = new THREE.Vector3();
  private smokeCursor = 0;
  private dustCursor = 0;
  private smokeAccumulator = 0;
  private dustAccumulator = 0;
  private trailAccumulator = 0;
  private randomState = 0x9e3779b9;

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'flight-vfx';
    this.smokeGeometry.setAttribute('position', new THREE.BufferAttribute(this.smokePositions, 3));
    this.smokeGeometry.setAttribute('color', new THREE.BufferAttribute(this.smokeColors, 3));
    this.dustGeometry.setAttribute('position', new THREE.BufferAttribute(this.dustPositions, 3));
    this.dustGeometry.setAttribute('color', new THREE.BufferAttribute(this.dustColors, 3));

    const smoke = new THREE.Points(this.smokeGeometry, this.smokeMaterial);
    smoke.name = 'engine-smoke';
    smoke.frustumCulled = false;
    const dust = new THREE.Points(this.dustGeometry, this.dustMaterial);
    dust.name = 'runway-dust';
    dust.frustumCulled = false;
    this.group.add(smoke, dust, this.leftTrail, this.rightTrail);
    this.scene.add(this.group);
    this.reset();
  }

  update(delta: number, aircraft: THREE.Object3D, state: FlightVfxState): void {
    const dt = Math.min(delta, 0.05);
    const rpm01 = Math.min(1, Math.max(0, state.propellerRpm / 2300));
    const speed01 = Math.min(1, Math.max(0, state.speed / 48));

    aircraft.getWorldDirection(this.tempForward).normalize();
    this.tempUp.set(0, 1, 0).applyQuaternion(aircraft.quaternion).normalize();

    if (rpm01 > 0.16) {
      this.smokeAccumulator += dt * (3 + rpm01 * 13);
      while (this.smokeAccumulator >= 1) {
        this.smokeAccumulator -= 1;
        this.spawnSmoke(aircraft, state.speed, rpm01);
      }
    }

    const onFastRoll = Boolean(state.wheelContact) && state.speed > 8;
    if (onFastRoll) {
      this.dustAccumulator += dt * (2 + speed01 * 20);
      while (this.dustAccumulator >= 1) {
        this.dustAccumulator -= 1;
        this.spawnDust(aircraft, state.speed);
      }
    }

    this.updateParticles(this.smokeParticles, this.smokePositions, this.smokeColors, dt, false);
    this.updateParticles(this.dustParticles, this.dustPositions, this.dustColors, dt, true);
    (this.smokeGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.smokeGeometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.dustGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.dustGeometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    const airborne = state.altitude > 7 && state.speed > 18;
    const trailOpacity = airborne ? Math.min(0.28, (state.altitude - 7) * 0.012 + speed01 * 0.09) : 0;
    (this.leftTrail.material as THREE.LineBasicMaterial).opacity = trailOpacity;
    (this.rightTrail.material as THREE.LineBasicMaterial).opacity = trailOpacity * 0.75;
    if (airborne) {
      this.trailAccumulator += dt;
      if (this.trailAccumulator >= 0.075) {
        this.trailAccumulator = 0;
        this.pushTrailPoint(this.leftTrail, aircraft, -4.55);
        this.pushTrailPoint(this.rightTrail, aircraft, 4.55);
      }
    } else {
      this.collapseTrails(aircraft.position);
    }
  }

  reset(): void {
    for (const particle of [...this.smokeParticles, ...this.dustParticles]) {
      particle.age = 10;
      particle.life = 1;
      particle.position.set(0, -1000, 0);
      particle.velocity.set(0, 0, 0);
    }
    this.smokePositions.fill(-1000);
    this.dustPositions.fill(-1000);
    this.smokeColors.fill(0);
    this.dustColors.fill(0);
    this.smokeCursor = 0;
    this.dustCursor = 0;
    this.smokeAccumulator = 0;
    this.dustAccumulator = 0;
    this.trailAccumulator = 0;
    this.collapseTrails(new THREE.Vector3(0, -1000, 0));
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.smokeGeometry.dispose();
    this.dustGeometry.dispose();
    this.smokeMaterial.dispose();
    this.dustMaterial.dispose();
    for (const trail of [this.leftTrail, this.rightTrail]) {
      trail.geometry.dispose();
      (trail.material as THREE.Material).dispose();
    }
  }

  private createParticles(count: number): Particle[] {
    return Array.from({ length: count }, () => ({
      position: new THREE.Vector3(0, -1000, 0),
      velocity: new THREE.Vector3(),
      age: 10,
      life: 1,
    }));
  }

  private createTrail(color: THREE.ColorRepresentation): THREE.Line {
    const positions = new Float32Array(TRAIL_POINTS * 3);
    positions.fill(-1000);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.name = color === '#f5a21a' ? 'right-wing-vapor' : 'left-wing-vapor';
    return line;
  }

  private spawnSmoke(aircraft: THREE.Object3D, speed: number, rpm01: number): void {
    const particle = this.smokeParticles[this.smokeCursor];
    this.smokeCursor = (this.smokeCursor + 1) % this.smokeParticles.length;
    this.tempPosition.set(-0.72, 0.25, 2.15);
    aircraft.localToWorld(this.tempPosition);
    particle.position.copy(this.tempPosition);
    particle.position.x += (this.random() - 0.5) * 0.08;
    particle.position.y += (this.random() - 0.5) * 0.06;
    particle.velocity
      .copy(this.tempForward)
      .multiplyScalar(-1.2 - speed * 0.055)
      .addScaledVector(this.tempUp, 0.22 + this.random() * 0.28);
    particle.velocity.x += (this.random() - 0.5) * 0.18;
    particle.age = 0;
    particle.life = 1.05 + this.random() * 0.65 + rpm01 * 0.2;
  }

  private spawnDust(aircraft: THREE.Object3D, speed: number): void {
    const particle = this.dustParticles[this.dustCursor];
    this.dustCursor = (this.dustCursor + 1) % this.dustParticles.length;
    const side = this.random() > 0.5 ? 1 : -1;
    this.tempPosition.set(side * 1.92, -0.88, -0.15);
    aircraft.localToWorld(this.tempPosition);
    particle.position.copy(this.tempPosition);
    particle.position.y = Math.max(0.05, particle.position.y);
    particle.velocity
      .copy(this.tempForward)
      .multiplyScalar(-0.9 - speed * 0.035)
      .addScaledVector(this.tempUp, 0.28 + this.random() * 0.42);
    particle.velocity.x += side * (0.22 + this.random() * 0.4);
    particle.age = 0;
    particle.life = 0.52 + this.random() * 0.5;
  }

  private updateParticles(
    particles: Particle[],
    positions: Float32Array,
    colors: Float32Array,
    delta: number,
    dust: boolean,
  ): void {
    const baseColor = dust ? this.tempColorA.set('#aa8154') : this.tempColorA.set('#626d70');
    const tipColor = dust ? this.tempColorB.set('#d7b37a') : this.tempColorB.set('#d3dcda');
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      particle.age += delta;
      const offset = index * 3;
      if (particle.age >= particle.life) {
        positions[offset] = 0;
        positions[offset + 1] = -1000;
        positions[offset + 2] = 0;
        colors[offset] = 0;
        colors[offset + 1] = 0;
        colors[offset + 2] = 0;
        continue;
      }
      particle.position.addScaledVector(particle.velocity, delta);
      particle.velocity.y += (dust ? 0.12 : 0.08) * delta;
      particle.velocity.multiplyScalar(1 - delta * (dust ? 1.4 : 0.65));
      const life01 = particle.age / particle.life;
      this.tempColorC.copy(baseColor).lerp(tipColor, life01);
      const fade = Math.sin(Math.PI * Math.min(1, life01)) * (dust ? 0.9 : 0.65);
      positions[offset] = particle.position.x;
      positions[offset + 1] = particle.position.y;
      positions[offset + 2] = particle.position.z;
      colors[offset] = this.tempColorC.r * fade;
      colors[offset + 1] = this.tempColorC.g * fade;
      colors[offset + 2] = this.tempColorC.b * fade;
    }
  }

  private readonly tempColorA = new THREE.Color();
  private readonly tempColorB = new THREE.Color();
  private readonly tempColorC = new THREE.Color();

  private pushTrailPoint(line: THREE.Line, aircraft: THREE.Object3D, localX: number): void {
    this.tempPositionB.set(localX, 0.08, -0.5);
    aircraft.localToWorld(this.tempPositionB);
    const attribute = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const values = attribute.array as Float32Array;
    values.copyWithin(3, 0, values.length - 3);
    values[0] = this.tempPositionB.x;
    values[1] = this.tempPositionB.y;
    values[2] = this.tempPositionB.z;
    attribute.needsUpdate = true;
  }

  private collapseTrails(position: THREE.Vector3): void {
    for (const trail of [this.leftTrail, this.rightTrail]) {
      const attribute = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      const values = attribute.array as Float32Array;
      for (let index = 0; index < TRAIL_POINTS; index += 1) {
        values[index * 3] = position.x;
        values[index * 3 + 1] = position.y;
        values[index * 3 + 2] = position.z;
      }
      attribute.needsUpdate = true;
    }
  }

  private random(): number {
    let value = this.randomState;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.randomState = value >>> 0;
    return this.randomState / 4294967296;
  }
}
