export type PilotIntent = {
  throttle: number;
  pitch: number;
  roll: number;
  yaw: number;
  brake: boolean;
};

const CONTROL_CODES = new Set([
  'KeyW',
  'KeyZ',
  'KeyS',
  'KeyA',
  'KeyQ',
  'KeyD',
  'KeyJ',
  'KeyL',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);

export class PilotInput {
  private readonly pressed = new Set<string>();
  private readonly mutableIntent: PilotIntent = {
    throttle: 0,
    pitch: 0,
    roll: 0,
    yaw: 0,
    brake: false,
  };
  private enabled = false;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  get intent(): Readonly<PilotIntent> {
    return this.mutableIntent;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  clear(): void {
    this.pressed.clear();
    this.updateIntent();
  }

  dispose(): void {
    this.clear();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || !CONTROL_CODES.has(event.code)) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches('button, input, textarea, select')) return;
    // A movement key can still be physically held while the player enters the
    // aircraft. Ignore its repeat events until it is released and pressed
    // again, so walking forward never turns into accidental throttle.
    if (event.repeat && !this.pressed.has(event.code)) {
      event.preventDefault();
      return;
    }
    this.pressed.add(event.code);
    this.updateIntent();
    event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!CONTROL_CODES.has(event.code)) return;
    this.pressed.delete(event.code);
    this.updateIntent();
    if (this.enabled) event.preventDefault();
  };

  private readonly onBlur = (): void => this.clear();

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.clear();
  };

  private updateIntent(): void {
    const isDown = (...codes: string[]) => codes.some((code) => this.pressed.has(code));
    this.mutableIntent.throttle = Number(isDown('KeyW', 'KeyZ')) - Number(isDown('KeyS'));
    // Conventional flight controls: pull back/down to raise the nose, push
    // forward/up to lower it.
    this.mutableIntent.pitch = Number(isDown('ArrowDown')) - Number(isDown('ArrowUp'));
    this.mutableIntent.roll = Number(isDown('ArrowRight', 'KeyD')) - Number(isDown('ArrowLeft', 'KeyA', 'KeyQ'));
    this.mutableIntent.yaw = Number(isDown('KeyL')) - Number(isDown('KeyJ'));
    this.mutableIntent.brake = isDown('Space');
  }
}
