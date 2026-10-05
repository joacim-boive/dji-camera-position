import type { CameraView } from "./camera-view.js";

export type PreviewOrientation = {
  yawDegrees: number;
  pitchDegrees: number;
  rollDegrees: number;
  flipHorizontal: boolean;
  panSign: 1 | -1;
  tiltSign: 1 | -1;
  rollSign: 1 | -1;
};

export type SensorPoint = {
  nx: number;
  ny: number;
};

export type Ray = {
  x: number;
  y: number;
  z: number;
};

export type EquirectSample = {
  u: number;
  v: number;
};

const previewFovFloor = 1e-4;

export const previewOrientation: PreviewOrientation = {
  yawDegrees: 0,
  pitchDegrees: 0,
  rollDegrees: 0,
  flipHorizontal: false,
  panSign: 1,
  tiltSign: 1,
  rollSign: 1,
};

export function clampPreviewFov(fovDegrees: number): number {
  if (!(fovDegrees > previewFovFloor)) {
    return previewFovFloor;
  }
  if (fovDegrees > 179) {
    return 179;
  }
  return fovDegrees;
}

export function studioZoomDegrees(
  fovDegrees: number,
  correction: number,
): number {
  const half = (clampPreviewFov(fovDegrees) * Math.PI) / 360;
  const horizontal = (2 * Math.atan((16 / 9) * Math.tan(half)) * 180) / Math.PI;
  return horizontal * Math.max(0, 1 + correction);
}

export function reframedRay(
  sensor: SensorPoint,
  view: CameraView,
  orientation: PreviewOrientation = previewOrientation,
): Ray {
  const aimedPan = orientation.panSign * view.pan + orientation.yawDegrees;
  const aimedTilt = orientation.tiltSign * view.tilt + orientation.pitchDegrees;
  const aimedRoll = orientation.rollSign * view.roll + orientation.rollDegrees;
  const lens = lensRay(sensor, view.fov, view.correction);
  const rolled = rotateZ(lens, -aimedRoll);
  const tilted = rotateX(rolled, -aimedTilt);
  return rotateY(tilted, aimedPan);
}

export function equirectangularSample(
  ray: Ray,
  flipHorizontal: boolean,
): EquirectSample {
  const length = Math.hypot(ray.x, ray.y, ray.z);
  const x = ray.x / length;
  const y = ray.y / length;
  const z = ray.z / length;
  const longitude = Math.atan2(x, z);
  const latitude = Math.asin(Math.min(1, Math.max(-1, y)));
  const u = 0.5 + longitude / (2 * Math.PI);
  return {
    u: flipHorizontal ? 1 - u : u,
    v: 0.5 - latitude / Math.PI,
  };
}

function lensRay(
  sensor: SensorPoint,
  fovDegrees: number,
  correction: number,
): Ray {
  const half = (clampPreviewFov(fovDegrees) * Math.PI) / 360;
  const scale = Math.tan(half);
  const point = { x: sensor.nx * scale, y: sensor.ny * scale };
  const radius = Math.hypot(point.x, point.y);
  if (radius === 0) {
    return { x: 0, y: 0, z: 1 };
  }
  const theta = Math.min(
    Math.PI,
    Math.max(0, 1 + correction) * Math.atan(radius),
  );
  const spread = Math.sin(theta) / radius;
  return {
    x: point.x * spread,
    y: point.y * spread,
    z: Math.cos(theta),
  };
}

function rotateX(ray: Ray, degrees: number): Ray {
  const { cos, sin } = turn(degrees);
  return {
    x: ray.x,
    y: ray.y * cos - ray.z * sin,
    z: ray.y * sin + ray.z * cos,
  };
}

function rotateY(ray: Ray, degrees: number): Ray {
  const { cos, sin } = turn(degrees);
  return {
    x: ray.x * cos + ray.z * sin,
    y: ray.y,
    z: -ray.x * sin + ray.z * cos,
  };
}

function rotateZ(ray: Ray, degrees: number): Ray {
  const { cos, sin } = turn(degrees);
  return {
    x: ray.x * cos - ray.y * sin,
    y: ray.x * sin + ray.y * cos,
    z: ray.z,
  };
}

function turn(degrees: number): { cos: number; sin: number } {
  const radians = (degrees * Math.PI) / 180;
  return { cos: Math.cos(radians), sin: Math.sin(radians) };
}
