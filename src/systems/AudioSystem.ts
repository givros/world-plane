export interface AircraftAudioState {
  phase: string;
  propellerRpm: number;
  speed: number;
  altitude: number;
  wheelContact?: boolean;
}

type LoopNodes = {
  engineA: OscillatorNode;
  engineB: OscillatorNode;
  engineGain: GainNode;
  engineFilter: BiquadFilterNode;
  windSource: AudioBufferSourceNode;
  windGain: GainNode;
  windFilter: BiquadFilterNode;
  ambienceSource: AudioBufferSourceNode;
  ambienceGain: GainNode;
  ambienceFilter: BiquadFilterNode;
};

export class AudioSystem {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private loops: LoopNodes | null = null;
  private muted = false;
  private disposed = false;
  private previousPhase = 'parked';

  constructor() {
    window.addEventListener('pointerdown', this.onUnlock, { passive: true });
    window.addEventListener('keydown', this.onUnlock);
  }

  async unlock(): Promise<void> {
    if (this.disposed) return;
    if (!this.context) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      this.context = new AudioContextClass();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.72;
      this.masterGain.connect(this.context.destination);
      this.loops = this.createLoops(this.context, this.masterGain);
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const context = this.context;
    const master = this.masterGain;
    if (!context || !master) return;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(muted ? 0 : 0.72, context.currentTime, 0.035);
  }

  update(state: AircraftAudioState): void {
    const context = this.context;
    const loops = this.loops;
    if (!context || !loops || context.state !== 'running') {
      this.previousPhase = state.phase;
      return;
    }

    const now = context.currentTime;
    const rpm01 = Math.min(1, Math.max(0, state.propellerRpm / 2300));
    const speed01 = Math.min(1, Math.max(0, state.speed / 48));
    const bladeFrequency = 18 + rpm01 * 54;

    loops.engineA.frequency.setTargetAtTime(bladeFrequency, now, 0.08);
    loops.engineB.frequency.setTargetAtTime(bladeFrequency * 2.02, now, 0.08);
    loops.engineFilter.frequency.setTargetAtTime(240 + rpm01 * 1500, now, 0.12);
    loops.engineGain.gain.setTargetAtTime(0.008 + rpm01 * 0.17, now, 0.09);

    loops.windGain.gain.setTargetAtTime(0.006 + speed01 * 0.095, now, 0.16);
    loops.windFilter.frequency.setTargetAtTime(480 + speed01 * 2100, now, 0.18);
    loops.ambienceGain.gain.setTargetAtTime(0.025 * (1 - speed01 * 0.55), now, 0.35);

    const phase = state.phase.toLowerCase();
    if (phase !== this.previousPhase) {
      if (phase.includes('touchdown')) this.touchdown();
      else if (phase.includes('liftoff') || phase === 'climb') this.cue(540, 760, 0.2);
      else if (phase.includes('approach')) this.cue(390, 330, 0.24);
      else if (phase.includes('complete')) this.cue(520, 820, 0.32);
      this.previousPhase = phase;
    }
  }

  confirm(): void {
    this.cue(420, 710, 0.18);
  }

  /** Kept as a lightweight compatibility cue for scaffold-era call sites. */
  pickup(index = 0): void {
    this.cue(360 + index * 12, 640 + index * 16, 0.16);
  }

  reset(): void {
    this.cue(520, 300, 0.12);
    this.previousPhase = 'parked';
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('pointerdown', this.onUnlock);
    window.removeEventListener('keydown', this.onUnlock);
    if (this.loops) {
      this.loops.engineA.stop();
      this.loops.engineB.stop();
      this.loops.windSource.stop();
      this.loops.ambienceSource.stop();
      this.loops = null;
    }
    void this.context?.close();
    this.context = null;
    this.masterGain = null;
  }

  private readonly onUnlock = () => {
    void this.unlock();
  };

  private createLoops(context: AudioContext, output: AudioNode): LoopNodes {
    const engineA = context.createOscillator();
    const engineB = context.createOscillator();
    const engineGain = context.createGain();
    const engineFilter = context.createBiquadFilter();
    engineA.type = 'sawtooth';
    engineB.type = 'square';
    engineA.frequency.value = 18;
    engineB.frequency.value = 36;
    engineGain.gain.value = 0.008;
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 260;
    engineFilter.Q.value = 1.4;
    engineA.connect(engineFilter);
    engineB.connect(engineFilter);
    engineFilter.connect(engineGain).connect(output);

    const noise = this.createNoiseBuffer(context, 3.5, 0.66);
    const windSource = context.createBufferSource();
    const windGain = context.createGain();
    const windFilter = context.createBiquadFilter();
    windSource.buffer = noise;
    windSource.loop = true;
    windGain.gain.value = 0.004;
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 650;
    windFilter.Q.value = 0.65;
    windSource.connect(windFilter).connect(windGain).connect(output);

    const ambienceSource = context.createBufferSource();
    const ambienceGain = context.createGain();
    const ambienceFilter = context.createBiquadFilter();
    ambienceSource.buffer = this.createNoiseBuffer(context, 5.5, 0.96);
    ambienceSource.loop = true;
    ambienceGain.gain.value = 0.025;
    ambienceFilter.type = 'lowpass';
    ambienceFilter.frequency.value = 520;
    ambienceSource.connect(ambienceFilter).connect(ambienceGain).connect(output);

    engineA.start();
    engineB.start();
    windSource.start();
    ambienceSource.start();

    return {
      engineA,
      engineB,
      engineGain,
      engineFilter,
      windSource,
      windGain,
      windFilter,
      ambienceSource,
      ambienceGain,
      ambienceFilter,
    };
  }

  private cue(startFrequency: number, endFrequency: number, duration: number): void {
    const context = this.context;
    const output = this.masterGain;
    if (!context || !output || context.state !== 'running') return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(output);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private touchdown(): void {
    const context = this.context;
    const output = this.masterGain;
    if (!context || !output || context.state !== 'running') return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.createNoiseBuffer(context, 0.65, 0.38);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(230, now);
    filter.frequency.exponentialRampToValueAtTime(55, now + 0.55);
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.58);
    source.connect(filter).connect(gain).connect(output);
    source.start(now);
    source.stop(now + 0.62);
  }

  private createNoiseBuffer(context: AudioContext, seconds: number, smooth: number): AudioBuffer {
    const frameCount = Math.ceil(context.sampleRate * seconds);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const data = buffer.getChannelData(0);
    let previous = 0;
    let seed = 0x7f4a7c15;
    for (let index = 0; index < frameCount; index += 1) {
      seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
      const white = (((seed ^ (seed >>> 14)) >>> 0) / 4294967295) * 2 - 1;
      previous = previous * smooth + white * (1 - smooth);
      data[index] = previous * 0.72;
    }
    return buffer;
  }
}
