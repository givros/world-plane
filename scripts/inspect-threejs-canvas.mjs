#!/usr/bin/env node
import { chromium, devices } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

function parseArgs(argv) {
  const args = {
    url: 'http://127.0.0.1:5188',
    out: 'artifacts/canvas-inspection',
    mobile: false,
    wait: 1000,
    sampleMs: 1500,
    scenario: 'parked',
    timeScale: 1,
    targetPhase: null,
    summary: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--url') args.url = argv[++i];
    else if (value === '--out') args.out = argv[++i];
    else if (value === '--mobile') args.mobile = true;
    else if (value === '--wait') args.wait = Number(argv[++i]);
    else if (value === '--sample-ms') args.sampleMs = Number(argv[++i]);
    else if (value === '--scenario') args.scenario = argv[++i];
    else if (value === '--time-scale') args.timeScale = Number(argv[++i]);
    else if (value === '--target-phase') args.targetPhase = argv[++i];
    else if (value === '--summary') args.summary = true;
    else if (value === '-h' || value === '--help') {
      console.log(
        'Usage: inspect-threejs-canvas.mjs [--url URL] [--out DIR] [--mobile] '
        + '[--wait MS] [--sample-ms MS] [--scenario parked|autopilot] '
        + '[--time-scale NUMBER] [--target-phase PHASE] [--summary]',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!['parked', 'autopilot'].includes(args.scenario)) {
    throw new Error(`Unknown scenario: ${args.scenario}`);
  }
  if (!Number.isFinite(args.wait) || args.wait < 0) {
    throw new Error(`Invalid wait duration: ${args.wait}`);
  }
  if (!Number.isFinite(args.sampleMs) || args.sampleMs <= 0) {
    throw new Error(`Invalid sample duration: ${args.sampleMs}`);
  }
  if (
    !Number.isFinite(args.timeScale)
    || args.timeScale < 0.1
    || args.timeScale > 20
  ) {
    throw new Error(`Invalid time scale: ${args.timeScale}`);
  }
  if (args.targetPhase && args.scenario !== 'autopilot') {
    throw new Error('--target-phase requires --scenario autopilot.');
  }

  return args;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((first, second) => first - second);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index];
}

async function samplePerformanceWindow(page, durationMs) {
  const samples = await page.evaluate(async (duration) => {
    const values = [];
    const start = performance.now();
    while (performance.now() - start < duration) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const diagnostics = window.__AIRPLANE_EXPERIENCE__?.diagnostics;
      if (!diagnostics) continue;
      values.push({
        fps: diagnostics.performance.fps,
        frameTimeMs: diagnostics.performance.frameTimeMs,
        calls: diagnostics.renderer.calls,
        triangles: diagnostics.renderer.triangles,
        geometries: diagnostics.renderer.geometries,
        textures: diagnostics.renderer.textures,
      });
    }
    return values;
  }, durationMs);

  if (samples.length === 0) throw new Error('No performance samples were captured.');
  const summarize = (key) => {
    const values = samples.map((sample) => sample[key]);
    return {
      min: Math.min(...values),
      median: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      max: Math.max(...values),
    };
  };
  return {
    durationMs,
    samples: samples.length,
    fps: summarize('fps'),
    frameTimeMs: summarize('frameTimeMs'),
    calls: summarize('calls'),
    triangles: summarize('triangles'),
    geometries: summarize('geometries'),
    textures: summarize('textures'),
  };
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`Server returned ${response.status} for ${url}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Server did not become ready at ${url}.`, { cause: lastError });
}

async function sampleCanvas(page) {
  const locator = page.locator('canvas').first();
  const rect = await locator.boundingBox();
  if (!rect || rect.width < 32 || rect.height < 32) {
    return { ok: false, reason: 'canvas-too-small', rect };
  }

  const buffer = await locator.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  let alphaPixels = 0;
  const colors = new Set();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    if (a > 0) alphaPixels += 1;
    colors.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
  }

  const variance = max - min;
  const diagnostics = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return {
      drawingBuffer: canvas
        ? { width: canvas.width, height: canvas.height }
        : null,
      game: window.__AIRPLANE_EXPERIENCE__?.diagnostics
        ?? window.__THREE_GAME_DIAGNOSTICS__
        ?? null,
    };
  });

  const ok = alphaPixels > 256 && (variance > 8 || colors.size > 3);
  return {
    ok,
    reason: ok ? 'nonblank' : 'low-variance',
    rect,
    drawingBuffer: diagnostics.drawingBuffer,
    alphaPixels,
    variance,
    colorBuckets: colors.size,
    diagnostics: diagnostics.game,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext(args.mobile
    ? { ...devices['iPhone 13'], userAgent: undefined }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const networkErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    networkErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      networkErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  await waitForServer(args.url);
  await page.goto(args.url, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { state: 'visible', timeout: 10_000 });
  try {
    await page.waitForFunction(() => (
      window.__AIRPLANE_EXPERIENCE__?.diagnostics.frame ?? 0
    ) > 5);
  } catch (error) {
    throw new Error(
      `Experience API did not become ready. Console: ${JSON.stringify(consoleErrors)}; `
      + `page: ${JSON.stringify(pageErrors)}; network: ${JSON.stringify(networkErrors)}`,
      { cause: error },
    );
  }
  if (args.scenario === 'autopilot') {
    await page.evaluate((timeScale) => {
      const experience = window.__AIRPLANE_EXPERIENCE__;
      if (!experience) throw new Error('Missing window.__AIRPLANE_EXPERIENCE__.');
      experience.setTimeScale(timeScale);
      experience.startAutopilot();
    }, args.timeScale);
    if (args.targetPhase) {
      await page.waitForFunction(
        (phase) => window.__AIRPLANE_EXPERIENCE__?.state.phase === phase,
        args.targetPhase,
        { timeout: 30_000 },
      );
      await page.evaluate(() => {
        window.__AIRPLANE_EXPERIENCE__?.setTimeScale(1);
      });
    }
  }
  await page.waitForTimeout(args.wait);

  const performanceWindow = await samplePerformanceWindow(page, args.sampleMs);
  const result = await sampleCanvas(page);
  const screenshotPath = path.join(args.out, args.mobile ? 'mobile.png' : 'desktop.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const report = {
    url: args.url,
    mode: args.mobile ? 'mobile' : 'desktop',
    scenario: args.scenario,
    timeScale: args.timeScale,
    targetPhase: args.targetPhase,
    screenshotPath,
    result,
    performanceWindow,
    consoleErrors,
    pageErrors,
    networkErrors,
  };

  await writeFile(path.join(args.out, args.mobile ? 'mobile.json' : 'desktop.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();

  const printableReport = args.summary
    ? {
        url: report.url,
        mode: report.mode,
        scenario: report.scenario,
        targetPhase: report.targetPhase,
        capturedPhase: report.result.diagnostics?.flight?.phase ?? null,
        screenshotPath: report.screenshotPath,
        performanceWindow: report.performanceWindow,
        consoleErrors: report.consoleErrors,
        pageErrors: report.pageErrors,
        networkErrors: report.networkErrors,
      }
    : report;
  console.log(JSON.stringify(printableReport, null, 2));

  if (
    !result.ok
    || consoleErrors.length > 0
    || pageErrors.length > 0
    || networkErrors.length > 0
  ) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
