import * as THREE from 'three';

export type SceneDiagnostics = {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
  geometries: number;
  textures: number;
  sceneObjects: number;
  visibleMeshes: number;
  instancedMeshes: number;
  uniqueMaterials: number;
  shadowCasters: number;
};

export class QualityDiagnostics {
  private elapsedWindow = 0;
  private framesWindow = 0;
  private fps = 60;
  private frameTimeMs = 16.67;
  private sceneMetrics: Pick<
    SceneDiagnostics,
    'sceneObjects' | 'visibleMeshes' | 'instancedMeshes' | 'uniqueMaterials' | 'shadowCasters'
  > | null = null;

  tick(deltaSeconds: number): void {
    this.elapsedWindow += deltaSeconds;
    this.framesWindow += 1;
    if (this.elapsedWindow >= 0.5) {
      this.fps = this.framesWindow / this.elapsedWindow;
      this.frameTimeMs = (this.elapsedWindow / this.framesWindow) * 1000;
      this.elapsedWindow = 0;
      this.framesWindow = 0;
    }
  }

  invalidateSceneMetrics(): void {
    this.sceneMetrics = null;
  }

  snapshot(scene: THREE.Scene, renderer: THREE.WebGLRenderer): SceneDiagnostics {
    if (!this.sceneMetrics) {
      let sceneObjects = 0;
      let visibleMeshes = 0;
      let instancedMeshes = 0;
      let shadowCasters = 0;
      const materials = new Set<THREE.Material>();

      scene.traverse((object) => {
        sceneObjects += 1;
        if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.InstancedMesh)) return;
        if (object.visible) visibleMeshes += 1;
        if (object instanceof THREE.InstancedMesh) instancedMeshes += 1;
        if (object.castShadow) shadowCasters += 1;
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of objectMaterials) materials.add(material);
      });
      this.sceneMetrics = {
        sceneObjects,
        visibleMeshes,
        instancedMeshes,
        uniqueMaterials: materials.size,
        shadowCasters,
      };
    }

    return {
      fps: Number(this.fps.toFixed(1)),
      frameTimeMs: Number(this.frameTimeMs.toFixed(2)),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      points: renderer.info.render.points,
      lines: renderer.info.render.lines,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      ...this.sceneMetrics,
    };
  }
}
