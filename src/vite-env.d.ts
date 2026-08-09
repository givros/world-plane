/// <reference types="vite/client" />

import type { AirplaneModelDiagnostics } from './assets/AirplaneModel';
import type { FlightSnapshot } from './systems/FlightSequence';
import type { PilotIntent } from './systems/PilotInput';
import type { SceneDiagnostics } from './systems/QualityDiagnostics';
import type { InfiniteBiomeWorldDiagnostics } from './world/InfiniteBiomeWorld';
import type { RunwayWorldDiagnostics } from './world/RunwayWorld';

declare global {
  interface AirplaneExperienceDiagnostics {
    frame: number;
    mode: 'manual' | 'autopilot';
    flight: Readonly<FlightSnapshot>;
    input: Readonly<PilotIntent>;
    manual: {
      throttle: number;
      verticalSpeed: number;
      stall: boolean;
      onGround: boolean;
      crashed: boolean;
    };
    camera: {
      position: { x: number; y: number; z: number };
      fov: number;
    };
    renderer: {
      calls: number;
      triangles: number;
      geometries: number;
      textures: number;
    };
    canvas: {
      clientWidth: number;
      clientHeight: number;
      width: number;
      height: number;
      dpr: number;
    };
    performance: SceneDiagnostics;
    model: AirplaneModelDiagnostics;
    world: RunwayWorldDiagnostics & { streaming: Readonly<InfiniteBiomeWorldDiagnostics> };
  }

  interface AirplaneExperienceApi {
    start: () => void;
    startAutopilot: () => void;
    startManual: () => void;
    reset: () => void;
    setTimeScale: (value: number) => void;
    setReviewMode: (enabled: boolean) => void;
    setPaintColor: (hexColor: string) => boolean;
    readonly state: Readonly<FlightSnapshot>;
    readonly diagnostics: AirplaneExperienceDiagnostics;
  }

  interface Window {
    __AIRPLANE_EXPERIENCE__?: AirplaneExperienceApi;
    __THREE_GAME_DIAGNOSTICS__?: AirplaneExperienceDiagnostics;
  }
}

export {};
