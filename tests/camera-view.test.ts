import { describe, expect, it } from "vitest";
import {
  offsetWithPatch,
  viewFromOffset,
  viewTuple,
} from "../src/model/camera-view.js";
import { formatDegrees } from "../src/model/format-view.js";

const param = viewTuple([0, 0, 0, 60, 1], "view_param");

describe("camera view", () => {
  it("converts the confirmed tuple into screen values", () => {
    const view = viewFromOffset(
      param,
      viewTuple(
        [1.5707963705062866, -3.1415927410125732, 1.5707963705062866, -40, -1],
        "view_offset",
      ),
    );
    expect(formatDegrees(view.tilt)).toBe("90.0°");
    expect(formatDegrees(view.pan)).toBe("-180.0°");
    expect(formatDegrees(view.roll)).toBe("-90.0°");
    expect(view.fov).toBe(20);
    expect(view.correction).toBe(0);
  });

  it("stores screen angles as float32 radians and keeps the roll sign flip", () => {
    const offset = offsetWithPatch(
      param,
      viewTuple([0, 0, 0, 0, 0], "current"),
      {
        pan: -180,
        tilt: 90,
        roll: -90,
        fov: 20,
        correction: 0,
      },
    );
    expect(offset).toEqual([
      1.5707963705062866, -3.1415927410125732, 1.5707963705062866, -40, -1,
    ]);
  });

  it("leaves unspecified components untouched and rebases FOV on the destination param", () => {
    const offset = offsetWithPatch(
      viewTuple([0, 0, 0, 50, 1], "dest"),
      viewTuple([0.25, 0, 0, 0, 0], "current"),
      {
        fov: 20,
        correction: 0,
      },
    );
    expect(offset).toEqual([0.25, 0, 0, -30, -1]);
  });
});
