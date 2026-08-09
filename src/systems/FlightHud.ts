import type { FlightMode } from './FlightSequence';

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
}

type FlightHudOptions = {
  onStartManual: () => void;
  onStartAutopilot: () => void;
  onReset: () => void;
  onMuteChange: (muted: boolean) => void;
  initialPaintColor: string;
  onPaintColorChange: (hexColor: string) => void;
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
  crashed: {
    status: 'Aircraft stopped',
    progress: 'Reset to runway',
    step: 'complete',
  },
  anticipation: {
    status: 'Cleared to depart',
    progress: 'Engine start',
    step: 'parked',
    title: ['01', 'Departure', 'Engine start'],
  },
  spinup: {
    status: 'Propeller live',
    progress: 'Powering up',
    step: 'takeoff',
  },
  'prop-spin-up': {
    status: 'Propeller live',
    progress: 'Powering up',
    step: 'takeoff',
  },
  takeoff: {
    status: 'Takeoff roll',
    progress: 'Accelerating',
    step: 'takeoff',
    title: ['02', 'Runway 36', 'Takeoff roll'],
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
  cruise: {
    status: 'In flight',
    progress: 'Valley circuit',
    step: 'flight',
    title: ['04', 'Field circuit', 'Open skies'],
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
  flight: {
    status: 'In flight',
    progress: 'Valley circuit',
    step: 'flight',
    title: ['04', 'Field circuit', 'Open skies'],
  },
  turn: {
    status: 'Banking',
    progress: 'Turning downwind',
    step: 'flight',
  },
  descent: {
    status: 'Descending',
    progress: 'Return to field',
    step: 'landing',
    title: ['05', 'Return', 'Landing approach'],
  },
  approach: {
    status: 'Final approach',
    progress: 'Runway aligned',
    step: 'landing',
  },
  'final-approach': {
    status: 'Final approach',
    progress: 'Runway aligned',
    step: 'landing',
  },
  flare: {
    status: 'Landing flare',
    progress: 'Hold it off',
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
  completed: {
    status: 'Safely home',
    progress: 'Flight complete',
    step: 'complete',
    title: ['07', 'Mission complete', 'A perfect landing'],
  },
};

export class FlightHud {
  private readonly phaseLabel = this.getElement('#phase-label');
  private readonly shotLabel = this.getElement('#shot-label');
  private readonly speedValue = this.getElement('#speed-value');
  private readonly altitudeValue = this.getElement('#altitude-value');
  private readonly rpmValue = this.getElement('#rpm-value');
  private readonly throttleValue = this.getElement('#throttle-value');
  private readonly throttleDial = this.getElement('#throttle-dial');
  private readonly progressTime = this.getElement('#progress-time');
  private readonly progressTotal = this.getElement('#progress-total');
  private readonly progressLabel = this.getElement('#progress-label');
  private readonly progressFill = this.getElement('#progress-fill');
  private readonly inspectionHint = this.getElement('#inspection-hint');
  private readonly manualFlightHud = this.getElement('#manual-flight-hud');
  private readonly attitudeIndicator = this.getElement('#attitude-indicator');
  private readonly pilotAlert = this.getElement('#pilot-alert');
  private readonly flightButton = this.getElement<HTMLButtonElement>('#flight-button');
  private readonly cinematicButton = this.getElement<HTMLButtonElement>('#cinematic-button');
  private readonly resetButton = this.getElement<HTMLButtonElement>('#reset-button');
  private readonly soundButton = this.getElement<HTMLButtonElement>('#sound-button');
  private readonly paintControl = this.getElement('#paint-control');
  private readonly paintButton = this.getElement<HTMLButtonElement>('#paint-button');
  private readonly paintPanel = this.getElement('#paint-panel');
  private readonly paintCloseButton = this.getElement<HTMLButtonElement>('#paint-close-button');
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

  constructor(private readonly options: FlightHudOptions) {
    this.flightButton.addEventListener('click', this.onStartManualClick);
    this.cinematicButton.addEventListener('click', this.onStartAutopilotClick);
    this.resetButton.addEventListener('click', this.onResetClick);
    this.soundButton.addEventListener('click', this.onSoundClick);
    this.paintButton.addEventListener('click', this.onPaintButtonClick);
    this.paintCloseButton.addEventListener('click', this.onPaintCloseClick);
    this.paintPresets.addEventListener('click', this.onPaintPresetClick);
    this.paintPresets.addEventListener('keydown', this.onPaintPresetKeyDown);
    this.paintColorInput.addEventListener('input', this.onPaintColorInput);
    document.addEventListener('pointerdown', this.onDocumentPointerDown);
    window.addEventListener('keydown', this.onPaintPanelKeyDown);
    this.fullscreenButton.addEventListener('click', this.onFullscreenClick);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    window.addEventListener('keydown', this.onFullscreenKeyDown);
    this.fullscreenButton.hidden = !document.fullscreenEnabled;
    this.setPaintColor(this.options.initialPaintColor);
    this.syncFullscreenButton();
  }

  update(snapshot: FlightHudSnapshot): void {
    const phaseKey = this.normalizePhase(snapshot.phase);
    const copy = PHASE_COPY[phaseKey] ?? {
      status: this.humanize(snapshot.phase),
      progress: 'Flight in progress',
      step: 'flight' as const,
    };

    this.phaseLabel.textContent = copy.status.toUpperCase();
    this.shotLabel.textContent = this.humanize(snapshot.cameraShot ?? 'Cinematic camera');
    this.progressLabel.textContent = copy.progress;

    const speedKnots = Math.max(0, snapshot.speed * 1.94384);
    const altitudeFeet = Math.max(0, snapshot.altitude * 3.28084);
    this.speedValue.textContent = Math.round(speedKnots).toString().padStart(3, '0');
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

    const isManual = snapshot.mode === 'manual';
    const parked = phaseKey === 'parked';
    const complete = phaseKey === 'complete' || phaseKey === 'completed' || Boolean(snapshot.completed);
    const running = Boolean(snapshot.running);
    const ended = complete || snapshot.crashed || phaseKey === 'crashed';
    if (running && !this.paintPanel.hasAttribute('hidden')) this.setPaintPanelOpen(false, false);
    this.manualFlightHud.hidden = !isManual;
    this.throttleDial.hidden = !isManual;
    this.inspectionHint.classList.toggle('visible', !isManual && (parked || complete));
    document.body.classList.toggle('manual-flight', isManual);
    document.body.classList.toggle('cinematic', !isManual && running);
    document.body.classList.toggle('flight-running', running);
    document.body.classList.toggle('flight-parked', parked);
    document.body.classList.toggle('flight-ended', ended);
    document.body.classList.toggle('flight-crashed', snapshot.crashed || phaseKey === 'crashed');
    document.body.classList.toggle('manual-preflight', isManual && parked && !running);
    // This compact chase-view cue follows the aircraft's screen-space bank.
    // A cockpit-mounted artificial horizon would counter-rotate, but that reads
    // mirrored while the third-person camera itself stays world-level.
    const bankDegrees = Math.max(-50, Math.min(50, snapshot.bank * 180 / Math.PI));
    const pitchOffset = Math.max(-26, Math.min(26, snapshot.pitch * 58));
    this.attitudeIndicator.style.setProperty('--attitude-bank', `${bankDegrees.toFixed(2)}deg`);
    this.attitudeIndicator.style.setProperty('--attitude-pitch', `${pitchOffset.toFixed(2)}px`);
    this.updatePilotAlert(snapshot, phaseKey);

    this.flightButton.disabled = running;
    this.cinematicButton.disabled = running;
    const manualKicker = this.flightButton.querySelector<HTMLElement>('.button-kicker');
    const manualLabel = this.flightButton.querySelector<HTMLElement>('strong');
    const cinematicKicker = this.cinematicButton.querySelector<HTMLElement>('.button-kicker');
    const cinematicLabel = this.cinematicButton.querySelector<HTMLElement>('strong');
    if (manualKicker) {
      manualKicker.textContent = isManual && running ? 'You have the controls' : 'Manual flight';
    }
    if (manualLabel) {
      manualLabel.textContent = isManual && running ? 'Pilot active' : snapshot.crashed ? 'Try again' : 'Take controls';
    }
    if (cinematicKicker) {
      cinematicKicker.textContent = !isManual && running ? 'Cinematic in progress' : 'Autopilot showcase';
    }
    if (cinematicLabel) {
      cinematicLabel.textContent = !isManual && running
        ? 'Autopilot active'
        : complete
          ? 'Replay cinematic'
          : 'Watch cinematic';
    }

    if (phaseKey !== this.previousPhase) {
      if (!isManual && copy.title) this.showTitle(copy.title);
      this.previousPhase = phaseKey;
    }
  }

  private updatePilotAlert(snapshot: FlightHudSnapshot, phaseKey: string): void {
    let message = '';
    let tone = 'info';
    if (snapshot.crashed || phaseKey === 'crashed') {
      message = 'AIRCRAFT STOPPED — PRESS R TO RESET';
      tone = 'danger';
    } else if (snapshot.stall) {
      message = 'STALL — LOWER THE NOSE';
      tone = 'danger';
    } else if (
      snapshot.onGround
      && snapshot.speed >= 24
      && snapshot.throttle >= 0.45
      && snapshot.running
    ) {
      message = 'ROTATE — HOLD ↓';
      tone = 'advisory';
    } else if (
      snapshot.onGround
      && snapshot.running
      && (phaseKey === 'touchdown' || phaseKey === 'rollout')
    ) {
      message = 'LANDED — BRAKE OR ADD POWER';
      tone = 'info';
    } else if (
      snapshot.onGround
      && snapshot.running
      && phaseKey === 'manual-ready'
      && (snapshot.airborneSeconds ?? 0) > 0
    ) {
      message = 'READY — ADD POWER TO TAKE OFF AGAIN';
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

  setMuted(muted: boolean): void {
    this.muted = muted;
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

  dispose(): void {
    window.clearTimeout(this.titleTimer);
    this.flightButton.removeEventListener('click', this.onStartManualClick);
    this.cinematicButton.removeEventListener('click', this.onStartAutopilotClick);
    this.resetButton.removeEventListener('click', this.onResetClick);
    this.soundButton.removeEventListener('click', this.onSoundClick);
    this.paintButton.removeEventListener('click', this.onPaintButtonClick);
    this.paintCloseButton.removeEventListener('click', this.onPaintCloseClick);
    this.paintPresets.removeEventListener('click', this.onPaintPresetClick);
    this.paintPresets.removeEventListener('keydown', this.onPaintPresetKeyDown);
    this.paintColorInput.removeEventListener('input', this.onPaintColorInput);
    document.removeEventListener('pointerdown', this.onDocumentPointerDown);
    window.removeEventListener('keydown', this.onPaintPanelKeyDown);
    this.fullscreenButton.removeEventListener('click', this.onFullscreenClick);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    window.removeEventListener('keydown', this.onFullscreenKeyDown);
  }

  private readonly onStartManualClick = () => {
    this.setPaintPanelOpen(false, false);
    this.options.onStartManual();
  };

  private readonly onStartAutopilotClick = () => {
    this.setPaintPanelOpen(false, false);
    this.options.onStartAutopilot();
  };

  private readonly onResetClick = () => {
    this.setPaintPanelOpen(false, false);
    this.options.onReset();
  };

  private readonly onSoundClick = () => {
    this.muted = !this.muted;
    this.setMuted(this.muted);
    this.options.onMuteChange(this.muted);
  };

  private readonly onPaintButtonClick = (): void => {
    this.setPaintPanelOpen(this.paintPanel.hasAttribute('hidden'), true);
  };

  private readonly onPaintCloseClick = (): void => {
    this.setPaintPanelOpen(false, true);
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

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (this.paintPanel.hasAttribute('hidden')) return;
    const target = event.target as Node | null;
    if (target && !this.paintControl.contains(target)) this.setPaintPanelOpen(false, false);
  };

  private readonly onPaintPanelKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape' || this.paintPanel.hasAttribute('hidden')) return;
    event.preventDefault();
    event.stopPropagation();
    this.setPaintPanelOpen(false, true);
  };

  private readonly onFullscreenClick = (): void => {
    void this.toggleFullscreen();
  };

  private readonly onFullscreenKeyDown = (event: KeyboardEvent): void => {
    if (
      event.code !== 'KeyF'
      || event.repeat
      || event.ctrlKey
      || event.metaKey
      || event.altKey
    ) return;

    if (!this.paintPanel.hasAttribute('hidden')) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select') || target?.isContentEditable) return;
    event.preventDefault();
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
    this.fullscreenButton.title = `${label} (F)`;
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

  private setPaintPanelOpen(open: boolean, manageFocus: boolean): void {
    this.paintPanel.hidden = !open;
    this.paintButton.setAttribute('aria-expanded', String(open));
    if (open) {
      if (!manageFocus) return;
      const selected = this.paintSwatches.find((swatch) => swatch.getAttribute('aria-pressed') === 'true');
      window.requestAnimationFrame(() => (selected ?? this.paintColorInput).focus());
    } else if (manageFocus) {
      this.paintButton.focus({ preventScroll: true });
    }
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

  private humanize(value: string): string {
    return value
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
