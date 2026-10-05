import { describe, expect, it } from "vitest";
import type { CameraView } from "../src/model/camera-view.js";
import {
  equirectangularSample,
  reframedRay,
  studioZoomDegrees,
} from "../src/model/reframe.js";

const ahead: CameraView = {
  pan: 0,
  tilt: 0,
  roll: 0,
  fov: 60,
  correction: 0,
};

function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}

function angleFromForward(ray: { x: number; y: number; z: number }): number {
  const length = Math.hypot(ray.x, ray.y, ray.z);
  return (Math.acos(ray.z / length) * 180) / Math.PI;
}

describe("reframe", () => {
  it("matches Studio zoom after rounding to one decimal", () => {
    expect(oneDecimal(studioZoomDegrees(60, 0))).toBe("91.5");
    expect(oneDecimal(studioZoomDegrees(60, 1))).toBe("183.0");
    expect(oneDecimal(studioZoomDegrees(20, 0))).toBe("34.8");
    expect(oneDecimal(studioZoomDegrees(20, 1))).toBe("69.6");
  });

  it("looks straight ahead from the center at zero angles", () => {
    expect(reframedRay({ nx: 0, ny: 0 }, ahead)).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("puts the middle of a vertical edge at half the FOV", () => {
    const ray = reframedRay({ nx: 0, ny: 1 }, ahead);
    expect(angleFromForward(ray)).toBeCloseTo(30, 6);
    expect(ray.y).toBeGreaterThan(0);
    expect(ray.x).toBeCloseTo(0, 6);
  });

  it("puts the middle of a horizontal edge at half the zoom angle", () => {
    for (const correction of [0, 1]) {
      const view = { ...ahead, correction };
      const ray = reframedRay({ nx: 16 / 9, ny: 0 }, view);
      expect(angleFromForward(ray)).toBeCloseTo(
        studioZoomDegrees(60, correction) / 2,
        6,
      );
      expect(ray.x).toBeGreaterThan(0);
    }
  });

  it("aims a small positive pan, tilt, and roll", () => {
    const pan = reframedRay({ nx: 0, ny: 0 }, { ...ahead, pan: 2 });
    expect(pan.x).toBeGreaterThan(0);
    expect(pan.y).toBeCloseTo(0, 6);

    const tilt = reframedRay({ nx: 0, ny: 0 }, { ...ahead, tilt: 2 });
    expect(tilt.y).toBeGreaterThan(0);
    expect(tilt.x).toBeCloseTo(0, 6);

    const level = reframedRay({ nx: 0.2, ny: 0 }, ahead);
    const rolled = reframedRay({ nx: 0.2, ny: 0 }, { ...ahead, roll: 8 });
    expect(rolled.y).toBeLessThan(level.y);
  });

  it("maps forward to the texture center and straight up to v = 0", () => {
    expect(equirectangularSample({ x: 0, y: 0, z: 1 }, false)).toEqual({
      u: 0.5,
      v: 0.5,
    });
    expect(equirectangularSample({ x: 0, y: 1, z: 0 }, false).v).toBeCloseTo(
      0,
      6,
    );
    const right = equirectangularSample({ x: 1, y: 0, z: 0 }, false);
    const flipped = equirectangularSample({ x: 1, y: 0, z: 0 }, true);
    expect(flipped.u).toBeCloseTo(1 - right.u, 6);
  });

  it("clamps the preview field of view to (0°, 179°]", () => {
    const capped = reframedRay({ nx: 16 / 9, ny: 0 }, { ...ahead, fov: 179 });
    const wider = reframedRay({ nx: 16 / 9, ny: 0 }, { ...ahead, fov: 180 });
    expect(angleFromForward(wider)).toBeCloseTo(angleFromForward(capped), 5);
    const shut = reframedRay({ nx: 16 / 9, ny: 0 }, { ...ahead, fov: 0 });
    expect(Number.isFinite(shut.x + shut.y + shut.z)).toBe(true);
  });
});
