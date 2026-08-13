import type { FlightMode } from './FlightSequence';
import type { CharacterId } from '../entities/PlayableCharacter';

export interface FlightHudSnapshot {
  mode: FlightMode;
  phase: string;
  progress?: number;
  normalizedProgress?: number;
  elapsed: number;
  totalDuration?: number;
  airborneSeconds?: number;
  speed: number;
  altitude: number;
  verticalSpeed: number;
  propellerRpm: number;
  throttle: number;
  pitch: number;
  bank: number;
  stall: boolean;
  crashed: boolean;
  onGround: boolean;
  running: boolean;
  cameraShot?: string;
  completed?: boolean;
  controlMode?: 'inspection' | 'on-foot' | 'piloting' | 'driving' | 'autopilot';
  interactionPrompt?: string;
  hubVisible?: boolean;
}

type FlightHudOptions = {
  onStartManual: () => void;
  onStartAutopilot: () => void;
  onReset: () => void;
  onMuteChange: (muted: boolean) => void;
  initialPaintColor: string;
  onPaintColorChange: (hexColor: string) => void;
  initialCharacter?: CharacterId;
  onCharacterChange?: (characterId: CharacterId) => void;
  onCameraSettingsChange: (sensitivity: number, invertY: boolean) => void;
};

export type FlightHudDiagnostics = {
  visible: boolean;
  settingsOpen: boolean;
  selectedCharacter: CharacterId;
  aircraftPaint: string;
};

type PhaseCopy = {
  status: string;
  progress: string;
  step: 'parked' | 'takeoff' | 'flight' | 'landing' | 'complete';
  title?: [string, string, string];
};

const PHASE_COPY: Record<string, PhaseCopy> = {
  parked: {
    status: 'Runway ready',
    progress: 'Preflight inspection',
    step: 'parked',
  },
  'manual-ready': {
    status: 'Pilot ready',
    progress: 'Manual controls armed',
    step: 'parked',
  },
  'manual-flight': {
    status: 'Pilot in control',
    progress: 'Manual flight',
    step: 'flight',
  },
  anticipation: {
    status: 'Cleared to depart',
    progress: 'Engine start',
    step: 'parked',
    title: ['01', 'Departure', 'Engine start'],
  },
  'prop-spin-up': {
    status: 'Propeller live',
    progress: 'Powering up',
    step: 'takeoff',
  },
  'takeoff-roll': {
    status: 'Takeoff roll',
    progress: 'Accelerating',
    step: 'takeoff',
    title: ['02', 'Runway 36', 'Takeoff roll'],
  },
  rotation: {
    status: 'Rotate',
    progress: 'Positive climb',
    step: 'takeoff',
  },
  liftoff: {
    status: 'Airborne',
    progress: 'Initial climb',
    step: 'flight',
    title: ['03', 'Airborne', 'Into the valley'],
  },
  climb: {
    status: 'Climbing',
    progress: 'Crosswind departure',
    step: 'flight',
  },
  'scenic-outbound': {
    status: 'In flight',
    progress: 'Valley departure',
    step: 'flight',
    title: ['04', 'Field circuit', 'Open skies'],
  },
  'scenic-turn': {
    status: 'Banking',
    progress: 'Scenic turn',
    step: 'flight',
  },
  return: {
    status: 'Returning',
    progress: 'Downwind leg',
    step: 'flight',
  },
  descent: {
    status: 'Descending',
    progress: 'Return to field',
    step: 'landing',
    title: ['05', 'Return', 'Landing approach'],
  },
  'final-approach': {
    status: 'Final approach',
    progress: 'Runway aligned',
    step: 'landing',
  },
  touchdown: {
    status: 'Touchdown',
    progress: 'Main wheels down',
    step: 'landing',
    title: ['06', 'Touchdown', 'Welcome home'],
  },
  rollout: {
    status: 'Rollout',
    progress: 'Brake or add power for takeoff',
    step: 'complete',
  },
  stopping: {
    status: 'Taxi speed',
    progress: 'Braking to a stop',
    step: 'complete',
  },
  finale: {
    status: 'Safely home',
    progress: 'Engine shutdown',
    step: 'complete',
    title: ['07', 'Mission complete', 'A perfect landing'],
  },
  complete: {
    status: 'Safely home',
    progress: 'Flight complete',
    step: 'complete',
    title: ['07', 'Mission complete', 'A perfect landing'],
  },
};

export class FlightHud {
  private readonly phaseLabel = this.getElement('#phase-label');
  private readonly speedValue = this.getElement('#speed-value');
  private readonly speedDial = this.getElement('#speed-dial');
  private readonly speedLabel = this.getElement('#speed-label');
  private readonly altitudeDial = this.getElement('#altitude-dial');
  private readonly altitudeValue = this.getElement('#altitude-value');
  private readonly rpmValue = this.getElement('#rpm-value');
  private readonly throttleValue = this.getElement('#throttle-value');
  private readonly throttleDial = this.getElement('#throttle-dial');
  private readonly progressTime = this.getElement('#progress-time');
  private readonly progressTotal = this.getElement('#progress-total');
  private readonly progressLabel = this.getElement('#progress-label');
  private readonly progressFill = this.getElement('#progress-fill');
  private readonly manualFlightHud = this.getElement('#manual-flight-hud');
  private readonly attitudeIndicator = this.getElement('#attitude-indicator');
  private readonly pilotAlert = this.getElement('#pilot-alert');
  private readonly interactionPrompt = this.getElement('#interaction-prompt');
  private readonly interactionPromptLabel = this.getElement('#interaction-prompt span');
  private readonly pilotControls = this.getElement('#pilot-controls');
  private readonly controlsRunningCopy = this.getElement('.controls-running-copy');
  private readonly welcomeHub = this.getElement('#welcome-hub');
  private readonly characterSelector = this.getElement('#character-selector');
  private readonly characterChoices = Array.from(document.querySelectorAll<HTMLButtonElement>('.character-choice'));
  private readonly flightButton = this.getElement<HTMLButtonElement>('#flight-button');
  private readonly cinematicButton = this.getElement<HTMLButtonElement>('#cinematic-button');
  private readonly settingsButton = this.getElement<HTMLButtonElement>('#settings-button');
  private readonly settingsPanel = this.getElement<HTMLDialogElement>('#settings-panel');
  private readonly settingsSoundInput = this.getElement<HTMLInputElement>('#settings-sound-input');
  private readonly cameraSensitivityInput = this.getElement<HTMLInputElement>('#camera-sensitivity-input');
  private readonly cameraInvertYInput = this.getElement<HTMLInputElement>('#camera-invert-y-input');
  private readonly resetButton = this.getElement<HTMLButtonElement>('#reset-button');
  private readonly soundButton = this.getElement<HTMLButtonElement>('#sound-button');
  private readonly paintControl = this.getElement('#paint-control');
  private readonly paintPresets = this.getElement('#paint-presets');
  private readonly paintColorInput = this.getElement<HTMLInputElement>('#paint-color-input');
  private readonly paintColorValue = this.getElement<HTMLOutputElement>('#paint-color-value');
  private readonly paintSwatches = Array.from(document.querySelectorAll<HTMLButtonElement>('.paint-swatch'));
  private readonly fullscreenButton = this.getElement<HTMLButtonElement>('#fullscreen-button');
  private readonly fullscreenTarget = this.getElement('#app');
  private readonly canvas = this.getElement<HTMLCanvasElement>('#game-canvas');
  private readonly sequenceTitle = this.getElement('#sequence-title');
  private readonly sequenceNumber = this.getElement('#sequence-number');
  private readonly sequenceKicker = this.getElement('#sequence-kicker');
  private readonly sequenceHeading = this.getElement('#sequence-heading');
  private readonly stepElements = Array.from(document.querySelectorAll<HTMLElement>('.progress-track li'));

  private muted = false;
  private previousPhase = '';
  private previousPilotAlert = '';
  private titleTimer = 0;
  private selectedCharacter: CharacterId = 'pilot';

  constructor(private readonly options: FlightHudOptions) {
    this.flightButton.addEventListener('click', this.onStartManualClick);
    this.cinematicButton.addEventListener('click', this.onStartAutopilotClick);
    this.settingsButton.addEventListener('click', this.onSettingsClick);
    this.settingsSoundInput.addEventListener('change', this.onSettingsSoundChange);
    this.settingsPanel.addEventListener('input', this.onCameraSettingChange);
    this.characterSelector.addEventListener('click', this.onCharacterClick);
    this.characterSelector.addEventListener('keydown', this.onCharacterKeyDown);
    this.resetButton.addEventListener('click', this.onResetClick);
    this.soundButton.addEventListener('click', this.onSoundClick);
    this.paintPresets.addEventListener('click', this.onPaintPresetClick);
    this.paintPresets.addEventListener('keydown', this.onPaintPresetKeyDown);
    this.paintColorInput.addEventListener('input', this.onPaintColorInput);
    this.fullscreenButton.addEventListener('click', this.onFullscreenClick);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.fullscreenButton.hidden = !document.fullscreenEnabled;
    this.setPaintColor(this.options.initialPaintColor);
    this.setCharacter(this.options.initialCharacter ?? 'pilot');
    this.syncFullscreenButton();
  }

  update(snapshot: FlightHudSnapshot): void {
    const phaseKey = this.normalizePhase(snapshot.phase);
    const isManual = snapshot.mode === 'manual';
    const isOnFoot = snapshot.controlMode === 'on-foot';
    const isDriving = snapshot.controlMode === 'driving';
    const copy = isOnFoot
      ? {
        status: 'On foot',
        progress: 'Free ground exploration',
        step: 'parked' as const,
      }
      : isManual && snapshot.running
      ? this.manualSandboxCopy(snapshot)
      : PHASE_COPY[phaseKey] ?? {
        status: 'On',
        progress: 'Flight in progress',
        step: 'flight' as const,
      };

    this.phaseLabel.textContent = copy.status.toUpperCase();
    this.progressLabel.textContent = copy.progress;

    const displaySpeed = Math.max(0, snapshot.speed * (isDriving ? 3.6 : 1.94384));
    const altitudeFeet = Math.max(0, snapshot.altitude * 3.28084);
    this.speedValue.textContent = Math.round(displaySpeed).toString().padStart(3, '0');
    this.speedLabel.textContent = isDriving ? 'Speed' : 'Airspeed';
    this.speedDial.dataset.unit = isDriving ? 'KM/H' : 'KTS';
    this.altitudeDial.hidden = isDriving;
    this.altitudeValue.textContent = Math.round(altitudeFeet).toString().padStart(3, '0');
    this.rpmValue.textContent = Math.round(Math.max(0, snapshot.propellerRpm)).toString().padStart(4, '0');
    const throttlePercent = Math.round(Math.min(1, Math.max(0, snapshot.throttle)) * 100);
    this.throttleValue.textContent = throttlePercent.toString().padStart(3, '0');

    const totalDuration = snapshot.totalDuration ?? 48;
    this.progressTime.textContent = this.formatTime(snapshot.elapsed);
    this.progressTotal.textContent = this.formatTime(totalDuration);
    const progress = Math.min(
      1,
      Math.max(0, snapshot.progress ?? snapshot.normalizedProgress ?? 0),
    );
    this.progressFill.style.width = `${(progress * 100).toFixed(2)}%`;
    this.updateSteps(copy.step);

    const parked = phaseKey === 'parked';
    const running = Boolean(snapshot.running);
    const ended = !isManual && (snapshot.completed || snapshot.crashed || phaseKey === 'crashed');
    this.welcomeHub.hidden = !(snapshot.hubVisible ?? !running);
    if (this.welcomeHub.hidden && this.settingsPanel.open) this.settingsPanel.close();
    this.manualFlightHud.hidden = !isManual;
    this.throttleDial.hidden = !isManual || isOnFoot;
    this.attitudeIndicator.hidden = isOnFoot || isDriving;
    document.body.classList.toggle('manual-flight', isManual);
    document.body.classList.toggle('on-foot', isOnFoot);
    document.body.classList.toggle('driving', isDriving);
    document.body.classList.toggle('cinematic', !isManual && running);
    document.body.classList.toggle('flight-running', running);
    document.body.classList.toggle('flight-parked', parked);
    document.body.classList.toggle('flight-ended', ended);
    document.body.classList.toggle(
      'flight-crashed',
      !isManual && (snapshot.crashed || phaseKey === 'crashed'),
    );
    document.body.classList.toggle('manual-preflight', isManual && parked && !running);
    // This compact chase-view cue follows the aircraft's screen-space bank.
    // A cockpit-mounted artificial horizon would counter-rotate, but that reads
    // mirrored while the third-person camera itself stays world-level.
    const bankDegrees = Math.max(-50, Math.min(50, snapshot.bank * 180 / Math.PI));
    const pitchOffset = Math.max(-26, Math.min(26, snapshot.pitch * 58));
    this.attitudeIndicator.style.setProperty('--attitude-bank', `${bankDegrees.toFixed(2)}deg`);
    this.attitudeIndicator.style.setProperty('--attitude-pitch', `${pitchOffset.toFixed(2)}px`);
    this.updatePilotAlert(snapshot, phaseKey);
    const interactionMessage = snapshot.interactionPrompt?.trim() ?? '';
    this.interactionPrompt.hidden = interactionMessage.length === 0;
    this.interactionPromptLabel.textContent = interactionMessage || 'Enter aircraft';
    this.pilotControls.setAttribute(
      'aria-label',
      isOnFoot
        ? 'Character controls: W or Z moves forward, S moves backward, A or Q moves left, D moves right, Shift runs, Space jumps, E enters the nearest vehicle, and R resets'
        : isDriving
          ? 'Car controls: W or Z accelerates, S brakes then reverses, A or Q steers left, D steers right, Space brakes, E exits when stopped, C recenters the camera, Tab releases the cursor, and R resets'
        : 'Keyboard pilot controls: W or Z increase throttle, S reduces throttle, down arrow pulls the nose up, up arrow pushes the nose down, left and right arrows bank, J and L control the rudder, Space brakes, and R resets',
    );
    this.controlsRunningCopy.textContent = isOnFoot
      ? 'WASD move · Shift run · E enter'
      : isDriving
        ? 'W/Z accelerate · S reverse · A/Q/D steer · Space brake'
        : 'Down pull · Up push · Left/right bank · W/Z power';

    this.flightButton.disabled = running;
    this.cinematicButton.disabled = running;
    if (phaseKey !== this.previousPhase) {
      if (!isManual && copy.title) this.showTitle(copy.title);
      this.previousPhase = phaseKey;
    }
  }

  private updatePilotAlert(snapshot: FlightHudSnapshot, phaseKey: string): void {
    let message = '';
    let tone = 'info';
    if (snapshot.controlMode === 'on-foot') {
      message = 'ON FOOT — CONTROLS ACTIVE';
    } else if (snapshot.controlMode === 'driving') {
      message = 'DRIVING — CONTROLS ACTIVE';
    } else if (snapshot.mode !== 'manual' && (snapshot.crashed || phaseKey === 'crashed')) {
      message = 'AIRCRAFT STOPPED — PRESS R TO RESET';
      tone = 'danger';
    } else if (snapshot.stall) {
      message = 'STALL — LOWER THE NOSE';
      tone = 'danger';
    } else if (
      snapshot.onGround
      && snapshot.running
      && (phaseKey === 'touchdown' || phaseKey === 'rollout')
    ) {
      message = 'GROUND CONTACT — CONTROLS ACTIVE';
      tone = 'info';
    } else if (
      snapshot.onGround
      && snapshot.running
      && phaseKey === 'manual-ready'
    ) {
      message = 'GROUND MODE — TAXI, STOP OR TAKE OFF';
      tone = 'info';
    } else if (!snapshot.onGround && snapshot.altitude < 4 && snapshot.verticalSpeed < -1.4) {
      message = 'FLARE — PULL ↓';
      tone = 'advisory';
    }

    this.pilotAlert.hidden = message.length === 0;
    this.pilotAlert.dataset.tone = tone;
    if (message !== this.previousPilotAlert) {
      this.pilotAlert.textContent = message;
      this.previousPilotAlert = message;
    }
  }

  private manualSandboxCopy(snapshot: FlightHudSnapshot): PhaseCopy {
    if (snapshot.controlMode === 'driving') {
      return {
        status: snapshot.speed > 0.3 ? 'Driving' : 'Car ready',
        progress: 'Open world active',
        step: 'parked',
      };
    }
    if (!snapshot.onGround) {
      return {
        status: 'Free flight',
        progress: 'Open world active',
        step: 'flight',
      };
    }
    return {
      status: snapshot.speed > 0.3 ? 'Ground exploration' : 'Ground mode',
      progress: 'Controls active',
      step: 'parked',
    };
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.settingsSoundInput.checked = !muted;
    this.soundButton.setAttribute('aria-pressed', String(muted));
    this.soundButton.setAttribute('aria-label', muted ? 'Enable sound' : 'Mute sound');
    this.soundButton.title = muted ? 'Enable sound' : 'Mute sound';
  }

  setPaintColor(value: string): void {
    const normalized = this.normalizePaintColor(value);
    if (!normalized) return;
    this.paintColorInput.value = normalized;
    this.paintColorValue.textContent = normalized.toUpperCase();
    this.paintControl.style.setProperty('--paint-color', normalized);
    for (const swatch of this.paintSwatches) {
      swatch.setAttribute('aria-pressed', String(swatch.dataset.color === normalized));
    }
  }

  setCharacter(characterId: CharacterId, notify = false): void {
    this.selectedCharacter = characterId;
    for (const choice of this.characterChoices) {
      const selected = choice.dataset.character === characterId;
      choice.setAttribute('aria-pressed', String(selected));
      choice.tabIndex = selected ? 0 : -1;
    }
    if (notify) this.options.onCharacterChange?.(characterId);
  }

  getDiagnostics(): FlightHudDiagnostics {
    return {
      visible: !this.welcomeHub.hidden,
      settingsOpen: this.settingsPanel.open,
      selectedCharacter: this.selectedCharacter,
      aircraftPaint: this.paintColorInput.value,
    };
  }

  dispose(): void {
    window.clearTimeout(this.titleTimer);
    this.flightButton.removeEventListener('click', this.onStartManualClick);
    this.cinematicButton.removeEventListener('click', this.onStartAutopilotClick);
    this.settingsButton.removeEventListener('click', this.onSettingsClick);
    this.settingsSoundInput.removeEventListener('change', this.onSettingsSoundChange);
    this.settingsPanel.removeEventListener('input', this.onCameraSettingChange);
    this.characterSelector.removeEventListener('click', this.onCharacterClick);
    this.characterSelector.removeEventListener('keydown', this.onCharacterKeyDown);
    this.resetButton.removeEventListener('click', this.onResetClick);
    this.soundButton.removeEventListener('click', this.onSoundClick);
    this.paintPresets.removeEventListener('click', this.onPaintPresetClick);
    this.paintPresets.removeEventListener('keydown', this.onPaintPresetKeyDown);
    this.paintColorInput.removeEventListener('input', this.onPaintColorInput);
    this.fullscreenButton.removeEventListener('click', this.onFullscreenClick);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
  }

  private readonly onStartManualClick = () => {
    this.options.onStartManual();
  };

  private readonly onStartAutopilotClick = () => {
    this.options.onStartAutopilot();
  };

  private readonly onSettingsClick = (): void => {
    this.settingsPanel.showModal();
  };

  private readonly onSettingsSoundChange = (): void => {
    this.setMuted(!this.settingsSoundInput.checked);
    this.options.onMuteChange(this.muted);
  };

  private readonly onCameraSettingChange = (): void => {
    const sensitivity = Math.min(2, Math.max(0.4, Number(this.cameraSensitivityInput.value) || 1));
    this.options.onCameraSettingsChange(sensitivity, this.cameraInvertYInput.checked);
  };

  private readonly onCharacterClick = (event: Event): void => {
    const choice = (event.target as HTMLElement).closest<HTMLButtonElement>('.character-choice');
    if (choice) this.setCharacter(choice.dataset.character as CharacterId, true);
  };

  private readonly onCharacterKeyDown = (event: KeyboardEvent): void => {
    if (!event.code.startsWith('Arrow')) return;
    const current = this.characterChoices.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const direction = event.code === 'ArrowLeft' || event.code === 'ArrowUp' ? -1 : 1;
    const choice = this.characterChoices[(current + direction + this.characterChoices.length) % this.characterChoices.length];
    this.setCharacter(choice.dataset.character as CharacterId, true);
    choice.focus();
  };

  private readonly onResetClick = () => {
    this.options.onReset();
  };

  private readonly onSoundClick = () => {
    this.muted = !this.muted;
    this.setMuted(this.muted);
    this.options.onMuteChange(this.muted);
  };

  private readonly onPaintPresetClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const swatch = target?.closest<HTMLButtonElement>('.paint-swatch');
    if (!swatch || !this.paintPresets.contains(swatch)) return;
    this.applyPaintColor(swatch.dataset.color ?? '');
  };

  private readonly onPaintPresetKeyDown = (event: KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) return;
    const target = event.target as HTMLButtonElement | null;
    const index = target ? this.paintSwatches.indexOf(target) : -1;
    if (index < 0) return;
    event.preventDefault();
    const direction = event.code === 'ArrowLeft' || event.code === 'ArrowUp' ? -1 : 1;
    const nextIndex = (index + direction + this.paintSwatches.length) % this.paintSwatches.length;
    this.paintSwatches[nextIndex].focus();
  };

  private readonly onPaintColorInput = (): void => {
    this.applyPaintColor(this.paintColorInput.value);
  };

  private readonly onFullscreenClick = (): void => {
    void this.toggleFullscreen();
  };

  private readonly onFullscreenChange = (): void => {
    this.syncFullscreenButton();
    this.focusCanvas();
  };

  private async toggleFullscreen(): Promise<void> {
    if (!document.fullscreenEnabled) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await this.fullscreenTarget.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      // Browsers can reject fullscreen when the call is not user-initiated.
      this.syncFullscreenButton();
    } finally {
      this.focusCanvas();
    }
  }

  private syncFullscreenButton(): void {
    const active = document.fullscreenElement === this.fullscreenTarget;
    const label = active ? 'Exit full screen' : 'Enter full screen';
    this.fullscreenButton.setAttribute('aria-pressed', String(active));
    this.fullscreenButton.setAttribute('aria-label', label);
    this.fullscreenButton.title = label;
  }

  private focusCanvas(): void {
    this.canvas.focus({ preventScroll: true });
  }

  private applyPaintColor(value: string): void {
    const normalized = this.normalizePaintColor(value);
    if (!normalized) return;
    this.setPaintColor(normalized);
    this.options.onPaintColorChange(normalized);
  }

  private normalizePaintColor(value: string): string | null {
    const normalized = value.trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : null;
  }

  private showTitle([number, kicker, heading]: [string, string, string]): void {
    window.clearTimeout(this.titleTimer);
    this.sequenceNumber.textContent = number;
    this.sequenceKicker.textContent = kicker;
    this.sequenceHeading.textContent = heading;
    this.sequenceTitle.classList.remove('show');
    void this.sequenceTitle.offsetWidth;
    this.sequenceTitle.classList.add('show');
    this.titleTimer = window.setTimeout(() => this.sequenceTitle.classList.remove('show'), 3100);
  }

  private updateSteps(active: PhaseCopy['step']): void {
    const order: PhaseCopy['step'][] = ['parked', 'takeoff', 'flight', 'landing', 'complete'];
    const activeIndex = order.indexOf(active);
    for (const element of this.stepElements) {
      const step = element.dataset.step as PhaseCopy['step'];
      const index = order.indexOf(step);
      element.classList.toggle('active', index === activeIndex);
      element.classList.toggle('passed', index < activeIndex);
    }
  }

  private normalizePhase(phase: string): string {
    return phase
      .trim()
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  }

  private formatTime(value: number): string {
    const safe = Math.max(0, Math.floor(value));
    const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
    const seconds = (safe % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing UI element: ${selector}`);
    return element;
  }
}
