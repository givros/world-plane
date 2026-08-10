/// <reference types="vite/client" />

import type { AirplaneModelDiagnostics } from './assets/AirplaneModel';
import type { PlayableCharacterDiagnostics } from './entities/PlayableCharacter';
import type { CharacterInputDiagnostics } from './systems/CharacterInput';
import type { FlightSnapshot } from './systems/FlightSequence';
import type { GroundCharacterDiagnostics } from './systems/GroundCharacterController';
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
    gameplay: {
      controlMode: 'inspection' | 'on-foot' | 'piloting' | 'autopilot';
      character: PlayableCharacterDiagnostics & {
        controller: GroundCharacterDiagnostics;
      };
      interaction: {
        kind: 'enter-aircraft' | 'exit-aircraft' | null;
        available: boolean;
        distance: number;
        radius: number;
        promptVisible: boolean;
        worldPosition: { x: number; y: number; z: number };
      };
      hub: {
        visible: boolean;
        settingsOpen: boolean;
        selectedCharacter: 'pilot' | 'field' | 'racer';
        aircraftPaint: string;
      };
      input: CharacterInputDiagnostics;
    };
    manual: {
      throttle: number;
      verticalSpeed: number;
      stall: boolean;
      onGround: boolean;
      crashed: boolean;
    };
    camera: {
      controller: 'inspection' | 'character' | 'pilot' | 'cinematic';
      position: { x: number; y: number; z: number };
      fov: number;
      pilot: {
        enabled: boolean;
        dragging: boolean;
        yawOffset: number;
        pitchOffset: number;
        zoom: number;
        distance: number;
      };
      character: {
        enabled: boolean;
        dragging: boolean;
        yawOffset: number;
        pitchOffset: number;
        zoom: number;
        distance: number;
      };
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
