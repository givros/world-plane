import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type CharacterAnimation = 'idle' | 'walk' | 'run' | 'jump';
export type CharacterLoadState = 'loading' | 'ready' | 'fallback' | 'disposed';
export type CharacterId = 'pilot' | 'field' | 'racer';

export interface PlayableCharacterDiagnostics {
  loadState: CharacterLoadState;
  loaded: boolean;
  visible: boolean;
  position: { x: number; y: number; z: number };
  yaw: number;
  requestedAnimation: CharacterAnimation;
  activeAnimation: CharacterAnimation | null;
  availableAnimations: CharacterAnimation[];
  characterId: CharacterId;
  loadError: string | null;
}

const CHARACTER_RUNTIME_URL = new URL(
  '../assets/character/CharacterRuntime.glb',
  import.meta.url,
);
const DEFAULT_CROSS_FADE_SECONDS = 0.18;
const CHARACTER_SCALE = 1.62;
const MAX_ANIMATION_DELTA_SECONDS = 0.1;
const ANIMATIONS: readonly CharacterAnimation[] = ['idle', 'walk', 'run', 'jump'];
const CHARACTER_COLORS: Record<CharacterId, readonly [string, string, string]> = {
  pilot: ['#d7a17d', '#e9d7b0', '#6a3422'],
  field: ['#8f5a43', '#657a52', '#323d34'],
  racer: ['#edc3a5', '#9a3329', '#202a34'],
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function createFallback(): THREE.Group {
  const fallback = new THREE.Group();
  fallback.name = 'playable-character-loading-fallback';

  const material = new THREE.MeshStandardMaterial({
    name: 'playable-character-fallback-material',
    color: '#5f6b68',
    roughness: 0.96,
    metalness: 0,
    transparent: true,
    opacity: 0.68,
  });
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.24, 0.88, 4, 8),
    material,
  );
  body.name = 'playable-character-fallback-body';
  body.position.y = 0.73;

  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.22, 1),
    material,
  );
  head.name = 'playable-character-fallback-head';
  head.position.y = 1.55;

  for (const mesh of [body, head]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  fallback.add(body, head);
  return fallback;
}

function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();

  root.traverse((object) => {
    const renderable = object as THREE.Mesh;
    if (renderable.geometry) geometries.add(renderable.geometry);
    if (renderable.material) {
      const objectMaterials = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      for (const material of objectMaterials) materials.add(material);
    }
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });

  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
  }
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

export class PlayableCharacter {
  readonly root = new THREE.Group();
  readonly ready: Promise<boolean>;

  private readonly fallback = createFallback();
  private readonly actions = new Map<CharacterAnimation, THREE.AnimationAction>();
  private readonly availableAnimations: CharacterAnimation[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private model: THREE.Object3D | null = null;
  private activeAction: THREE.AnimationAction | null = null;
  private activeAnimation: CharacterAnimation | null = null;
  private requestedAnimation: CharacterAnimation = 'idle';
  private resumeAfterJump: Exclude<CharacterAnimation, 'jump'> = 'idle';
  private loadState: CharacterLoadState = 'loading';
  private loadError: string | null = null;
  private disposed = false;

  constructor(private characterId: CharacterId = 'pilot') {
    this.root.name = 'playable-character';
    this.root.visible = false;
    this.root.add(this.fallback);
    this.ready = this.load();
  }

  get diagnostics(): PlayableCharacterDiagnostics {
    return {
      loadState: this.loadState,
      loaded: this.loadState === 'ready',
      visible: this.root.visible,
      position: {
        x: this.root.position.x,
        y: this.root.position.y,
        z: this.root.position.z,
      },
      yaw: this.root.rotation.y,
      requestedAnimation: this.requestedAnimation,
      activeAnimation: this.activeAnimation,
      availableAnimations: [...this.availableAnimations],
      characterId: this.characterId,
      loadError: this.loadError,
    };
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    this.root.visible = visible;
  }

  setCharacter(characterId: CharacterId): void {
    this.characterId = characterId;
    this.applyCharacterColors();
  }

  setAnimation(animation: CharacterAnimation, fadeSeconds = DEFAULT_CROSS_FADE_SECONDS): void {
    if (this.disposed || !ANIMATIONS.includes(animation)) return;
    if (animation !== 'jump') this.resumeAfterJump = animation;
    this.requestedAnimation = animation;
    this.transitionTo(animation, fadeSeconds, false);
  }

  update(deltaSeconds: number): void {
    if (this.disposed || !this.mixer || !Number.isFinite(deltaSeconds)) return;
    this.mixer.update(THREE.MathUtils.clamp(deltaSeconds, 0, MAX_ANIMATION_DELTA_SECONDS));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadState = 'disposed';
    if (this.mixer) {
      this.mixer.removeEventListener('finished', this.onAnimationFinished);
      if (this.model) this.mixer.uncacheRoot(this.model);
      this.mixer.stopAllAction();
    }
    this.actions.clear();
    this.activeAction = null;
    this.activeAnimation = null;
    this.root.parent?.remove(this.root);
    disposeObject(this.root);
    this.root.clear();
    this.model = null;
    this.mixer = null;
  }

  private async load(): Promise<boolean> {
    try {
      const gltf = await new GLTFLoader().loadAsync(CHARACTER_RUNTIME_URL.href);
      if (this.disposed) {
        disposeObject(gltf.scene);
        return false;
      }

      this.model = gltf.scene;
      this.model.name = this.model.name || 'playable-character-runtime-model';
      this.model.scale.setScalar(CHARACTER_SCALE);
      this.model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      this.root.add(this.model);

      this.mixer = new THREE.AnimationMixer(this.model);
      this.mixer.addEventListener('finished', this.onAnimationFinished);
      for (const animation of ANIMATIONS) {
        const clip = this.findClip(gltf.animations, animation);
        if (!clip) continue;
        const action = this.mixer.clipAction(clip);
        if (animation === 'jump') {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        } else {
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
        }
        this.actions.set(animation, action);
        this.availableAnimations.push(animation);
      }

      this.loadState = 'ready';
      this.fallback.visible = false;
      this.applyCharacterColors();
      this.transitionTo(this.requestedAnimation, 0, true);
      return true;
    } catch (error) {
      if (this.disposed) return false;
      this.loadState = 'fallback';
      this.loadError = errorMessage(error);
      this.fallback.visible = true;
      return false;
    }
  }

  private findClip(
    clips: readonly THREE.AnimationClip[],
    animation: CharacterAnimation,
  ): THREE.AnimationClip | undefined {
    const exact = clips.find((clip) => clip.name.trim().toLowerCase() === animation);
    if (exact) return exact;
    return clips.find((clip) => clip.name.trim().toLowerCase().includes(animation));
  }

  private applyCharacterColors(): void {
    const colors = CHARACTER_COLORS[this.characterId];
    this.model?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material;
      if (!(material instanceof THREE.MeshStandardMaterial)) return;
      const index = material.name === 'CharacterMaterial'
        ? 0
        : material.name === 'LongSleeveShirtMaterial' ? 1 : 2;
      material.color.set(colors[index]);
    });
  }

  private transitionTo(
    animation: CharacterAnimation,
    fadeSeconds: number,
    restart: boolean,
  ): void {
    if (!this.mixer || this.actions.size === 0) return;
    const resolvedAnimation = this.actions.has(animation)
      ? animation
      : this.actions.has('idle')
        ? 'idle'
        : this.availableAnimations[0];
    if (!resolvedAnimation) return;
    const nextAction = this.actions.get(resolvedAnimation);
    if (!nextAction) return;
    if (nextAction === this.activeAction && !restart) return;

    const duration = Number.isFinite(fadeSeconds)
      ? THREE.MathUtils.clamp(fadeSeconds, 0, 2)
      : DEFAULT_CROSS_FADE_SECONDS;
    const previousAction = this.activeAction;
    nextAction.enabled = true;
    nextAction.setEffectiveTimeScale(animation === 'jump' ? 2.55 : 1);
    nextAction.setEffectiveWeight(1);
    if (restart || nextAction !== previousAction) nextAction.reset();
    nextAction.play();
    if (previousAction && previousAction !== nextAction) {
      if (duration > 0) nextAction.crossFadeFrom(previousAction, duration, false);
      else previousAction.stop();
    }
    this.activeAction = nextAction;
    this.activeAnimation = resolvedAnimation;
  }

  private readonly onAnimationFinished = (event: THREE.Event & { action?: THREE.AnimationAction }): void => {
    const jumpAction = this.actions.get('jump');
    if (!jumpAction || event.action !== jumpAction || this.activeAction !== jumpAction) return;
    this.requestedAnimation = this.resumeAfterJump;
      this.transitionTo(this.resumeAfterJump, DEFAULT_CROSS_FADE_SECONDS, true);
  };
}
