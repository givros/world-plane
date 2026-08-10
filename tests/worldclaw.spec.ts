import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const REVIEW_VIEWS = [
  'top',
  'north-west',
  'north-east',
  'south-east',
  'south-west',
  'low-x',
  'low-z',
  'seam-east',
  'seam-south',
  'landing-approach',
] as const;

// Independent renders can shade a tiny number of triangle-edge pixels differently
// on the same GPU. Keep the aggregate mean gate strict while allowing that bounded
// sub-pixel rasterization noise; missing geometry changes thousands of pixels.
const MAX_ANTIALIASING_PIXEL_DRIFT = 128;
const MAX_ANTIALIASING_CHANNEL_DELTA = 80;
const MAX_ANTIALIASING_MEAN_DELTA = 0.002;

type ReviewView = (typeof REVIEW_VIEWS)[number];
type ReviewSource = 'compiled' | 'procedural';

type ReviewStats = {
  source: ReviewSource;
  view: ReviewView;
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  world: {
    loadedChunkCount: number;
    droppedInstances: number;
    slotsCreated: number;
    poolSize: number;
    worldSource: {
      manifestHash: string;
      sourceHash: string;
      compiledDescriptorCount: number;
      activeAuthoredChunkKeys: string[];
      activeFallbackChunkKeys: string[];
    };
  };
};

type BrowserErrors = { console: string[]; page: string[] };

function watchBrowserErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = { console: [], page: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text());
  });
  page.on('pageerror', (error) => errors.page.push(error.message));
  return errors;
}

async function mountReview(
  page: Page,
  source: ReviewSource,
  view: ReviewView,
): Promise<void> {
  await page.evaluate(({ nextSource, nextView }) => {
    const reviewWindow = window as typeof window & {
      __WORLDCLAW_REVIEW__?: { dispose: () => void; render: () => void };
      __WORLDCLAW_MOUNT__?: (options: Record<string, unknown>) => unknown;
    };
    reviewWindow.__WORLDCLAW_REVIEW__?.dispose();
    if (!reviewWindow.__WORLDCLAW_MOUNT__) throw new Error('Missing WorldClaw mount seam.');
    reviewWindow.__WORLDCLAW_REVIEW__ = reviewWindow.__WORLDCLAW_MOUNT__({
      source: nextSource,
      view: nextView,
      chunkX: 0,
      chunkZ: 1,
      width: 960,
      height: 600,
    }) as { dispose: () => void; render: () => void };
  }, { nextSource: source, nextView: view });
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() =>
      requestAnimationFrame(() => resolve())));
    const review = (
      window as typeof window & { __WORLDCLAW_REVIEW__?: { render: () => void } }
    ).__WORLDCLAW_REVIEW__;
    review?.render();
  });
}

async function readStats(
  page: Page,
  source: ReviewSource,
  view: ReviewView,
): Promise<ReviewStats> {
  return page.evaluate(({ currentSource, currentView }) => {
    const review = (
      window as typeof window & {
        __WORLDCLAW_REVIEW__?: {
          renderer: ReviewStats['renderer'];
          diagnostics: ReviewStats['world'];
        };
      }
    ).__WORLDCLAW_REVIEW__;
    if (!review) throw new Error('Missing WorldClaw review harness.');
    return {
      source: currentSource,
      view: currentView,
      renderer: { ...review.renderer },
      world: {
        loadedChunkCount: review.diagnostics.loadedChunkCount,
        droppedInstances: review.diagnostics.droppedInstances,
        slotsCreated: review.diagnostics.slotsCreated,
        poolSize: review.diagnostics.poolSize,
        worldSource: {
          ...review.diagnostics.worldSource,
          activeAuthoredChunkKeys: [
            ...review.diagnostics.worldSource.activeAuthoredChunkKeys,
          ],
          activeFallbackChunkKeys: [
            ...review.diagnostics.worldSource.activeFallbackChunkKeys,
          ],
        },
      },
    };
  }, { currentSource: source, currentView: view });
}

function comparePngs(firstBuffer: Buffer, secondBuffer: Buffer): {
  differentPixels: number;
  maxChannelDifference: number;
  meanChannelDifference: number;
} {
  const first = PNG.sync.read(firstBuffer);
  const second = PNG.sync.read(secondBuffer);
  expect(second.width).toBe(first.width);
  expect(second.height).toBe(first.height);
  let differentPixels = 0;
  let maxChannelDifference = 0;
  let differenceTotal = 0;
  for (let index = 0; index < first.data.length; index += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(
        first.data[index + channel] - second.data[index + channel],
      );
      differenceTotal += difference;
      maxChannelDifference = Math.max(maxChannelDifference, difference);
      if (difference > 0) pixelDiffers = true;
    }
    if (pixelDiffers) differentPixels += 1;
  }
  return {
    differentPixels,
    maxChannelDifference,
    meanChannelDifference: differenceTotal / (first.width * first.height * 3),
  };
}

test('WorldClaw compiled representatives preserve the procedural pilot view set', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = watchBrowserErrors(page);
  await page.goto(
    '/tests/fixtures/worldclaw-review.html?source=procedural&view=top',
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  const outputDir = path.resolve('output/worldclaw/visual-review');
  await mkdir(outputDir, { recursive: true });
  const metrics: Array<{
    view: ReviewView;
    comparison: ReturnType<typeof comparePngs>;
    procedural: ReviewStats;
    compiled: ReviewStats;
  }> = [];

  for (const view of REVIEW_VIEWS) {
    await mountReview(page, 'procedural', view);
    const proceduralPng = await page.locator('canvas[data-world-review]').screenshot({
      path: path.join(outputDir, `${view}-procedural.png`),
    });
    const procedural = await readStats(page, 'procedural', view);

    await mountReview(page, 'compiled', view);
    const compiledPng = await page.locator('canvas[data-world-review]').screenshot({
      path: path.join(outputDir, `${view}-compiled.png`),
    });
    const compiled = await readStats(page, 'compiled', view);
    const comparison = comparePngs(proceduralPng, compiledPng);

    expect(
      comparison.differentPixels,
      `${view} anti-aliasing pixel drift`,
    ).toBeLessThanOrEqual(MAX_ANTIALIASING_PIXEL_DRIFT);
    expect(
      comparison.maxChannelDifference,
      `${view} max channel delta`,
    ).toBeLessThanOrEqual(MAX_ANTIALIASING_CHANNEL_DELTA);
    expect(
      comparison.meanChannelDifference,
      `${view} mean channel delta`,
    ).toBeLessThan(MAX_ANTIALIASING_MEAN_DELTA);
    expect(compiled.renderer, `${view} renderer parity`).toEqual(procedural.renderer);
    expect(compiled.world.loadedChunkCount).toBe(9);
    expect(compiled.world.slotsCreated).toBe(9);
    expect(compiled.world.poolSize).toBe(0);
    expect(compiled.world.droppedInstances).toBe(0);
    expect(compiled.world.worldSource.compiledDescriptorCount).toBe(17);
    expect(compiled.world.worldSource.activeAuthoredChunkKeys).toContain('0:1');
    expect(compiled.world.worldSource.activeFallbackChunkKeys).toEqual([]);
    expect(compiled.renderer.calls).toBeLessThanOrEqual(260);
    expect(compiled.renderer.triangles).toBeLessThanOrEqual(180_000);
    expect(compiled.renderer.geometries).toBeLessThanOrEqual(240);
    expect(compiled.renderer.textures).toBeLessThanOrEqual(16);

    metrics.push({ view, comparison, procedural, compiled });
  }

  await writeFile(
    path.join(outputDir, 'metrics.json'),
    `${JSON.stringify(metrics, null, 2)}\n`,
    'utf8',
  );
  expect(errors.console, 'browser console errors').toEqual([]);
  expect(errors.page, 'uncaught page errors').toEqual([]);
});
