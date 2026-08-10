export type CharacterIntent = {
  /** Camera-relative strafe: left = -1, right = +1. */
  moveX: number;
  /** Camera-relative travel: backward = -1, forward = +1. */
  moveZ: number;
  sprint: boolean;
  jump: boolean;
};

export type CharacterInputDiagnostics = {
  enabled: boolean;
  pressedCodes: string[];
  intent: CharacterIntent;
};

const CONTROL_CODES = new Set([
  'KeyW',
  'KeyZ',
  'KeyS',
  'KeyA',
  'KeyQ',
  'KeyD',
  'ShiftLeft',
  'ShiftRight',
  'Space',
]);

export class CharacterInput {
  private readonly pressed = new Set<string>();
  private readonly mutableIntent: CharacterIntent = {
    moveX: 0,
    moveZ: 0,
    sprint: false,
    jump: false,
  };
  private enabledState = false;
  private disposed = false;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  get intent(): Readonly<CharacterIntent> {
    return this.mutableIntent;
  }

  get diagnostics(): Readonly<CharacterInputDiagnostics> {
    return {
      enabled: this.enabledState,
      pressedCodes: Array.from(this.pressed).sort(),
      intent: { ...this.mutableIntent },
    };
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.enabledState = enabled;
    if (!enabled) this.clear();
  }

  clear(): void {
    this.pressed.clear();
    this.updateIntent();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabledState = false;
    this.clear();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabledState || !CONTROL_CODES.has(event.code) || this.isTextInput(event.target)) {
      return;
    }
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
    if (this.enabledState) event.preventDefault();
  };

  private readonly onBlur = (): void => this.clear();

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.clear();
  };

  private isTextInput(target: EventTarget | null): boolean {
    const element = target instanceof HTMLElement ? target : null;
    return Boolean(
      element?.matches('button, input, textarea, select')
      || element?.isContentEditable,
    );
  }

  private updateIntent(): void {
    const isDown = (...codes: string[]) => codes.some((code) => this.pressed.has(code));
    this.mutableIntent.moveX = Number(isDown('KeyD')) - Number(isDown('KeyA', 'KeyQ'));
    this.mutableIntent.moveZ = Number(isDown('KeyW', 'KeyZ')) - Number(isDown('KeyS'));
    this.mutableIntent.sprint = isDown('ShiftLeft', 'ShiftRight');
    this.mutableIntent.jump = isDown('Space');
  }
}
