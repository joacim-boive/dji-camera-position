export type CameraView = {
  pan: number;
  tilt: number;
  roll: number;
  fov: number;
  correction: number;
};

export type CameraViewPatch = {
  pan?: number;
  tilt?: number;
  roll?: number;
  fov?: number;
  correction?: number;
};

export type ViewTuple = readonly [number, number, number, number, number];

const ZERO_PARAM: ViewTuple = [0, 0, 0, 0, 0];

export function viewTuple(
  values: readonly unknown[],
  label: string,
): ViewTuple {
  if (values.length !== 5) {
    throw new Error(`${label} must be five numbers.`);
  }
  const numbers = values.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${label} must be five finite numbers.`);
    }
    return value;
  });
  const first = numbers[0];
  const second = numbers[1];
  const third = numbers[2];
  const fourth = numbers[3];
  const fifth = numbers[4];
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    fifth === undefined
  ) {
    throw new Error(`${label} must be five numbers.`);
  }
  return [first, second, third, fourth, fifth];
}

export function viewFromOffset(
  param: ViewTuple,
  offset: ViewTuple,
): CameraView {
  return {
    tilt: radiansToDegrees(component(offset, 0)),
    pan: radiansToDegrees(component(offset, 1)),
    roll: -radiansToDegrees(component(offset, 2)),
    fov: component(param, 3) + component(offset, 3),
    correction: component(param, 4) + component(offset, 4),
  };
}

/** Keyframe `v` matches `view_param` when the offset is zero: absolute, not a delta. */
export function viewFromAbsolute(tuple: ViewTuple): CameraView {
  return viewFromOffset(ZERO_PARAM, tuple);
}

export function offsetWithPatch(
  param: ViewTuple,
  offset: ViewTuple,
  patch: CameraViewPatch,
): ViewTuple {
  if (patchIsEmpty(patch)) {
    throw new Error("No camera fields to update.");
  }
  return [
    patch.tilt === undefined
      ? component(offset, 0)
      : degreesToStoredRadians(patch.tilt),
    patch.pan === undefined
      ? component(offset, 1)
      : degreesToStoredRadians(patch.pan),
    patch.roll === undefined
      ? component(offset, 2)
      : degreesToStoredRadians(-patch.roll),
    patch.fov === undefined
      ? component(offset, 3)
      : finite(patch.fov - component(param, 3)),
    patch.correction === undefined
      ? component(offset, 4)
      : finite(patch.correction - component(param, 4)),
  ];
}

export function patchIsEmpty(patch: CameraViewPatch): boolean {
  return (
    patch.pan === undefined &&
    patch.tilt === undefined &&
    patch.roll === undefined &&
    patch.fov === undefined &&
    patch.correction === undefined
  );
}

export function tuplesEqual(left: ViewTuple, right: ViewTuple): boolean {
  return (
    component(left, 0) === component(right, 0) &&
    component(left, 1) === component(right, 1) &&
    component(left, 2) === component(right, 2) &&
    component(left, 3) === component(right, 3) &&
    component(left, 4) === component(right, 4)
  );
}

export function formatViewTuple(tuple: ViewTuple): string {
  return `[${[
    formatDjiNumber(component(tuple, 0)),
    formatDjiNumber(component(tuple, 1)),
    formatDjiNumber(component(tuple, 2)),
    formatDjiNumber(component(tuple, 3)),
    formatDjiNumber(component(tuple, 4)),
  ].join(",")}]`;
}

export function formatDjiNumber(value: number): string {
  const finiteValue = finite(value);
  if (Number.isInteger(finiteValue)) {
    return `${finiteValue}.0`;
  }
  return JSON.stringify(finiteValue);
}

function component(tuple: ViewTuple, index: 0 | 1 | 2 | 3 | 4): number {
  const value = tuple[index];
  if (value === undefined) {
    throw new Error("View tuple is incomplete.");
  }
  return value;
}

function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function degreesToStoredRadians(degrees: number): number {
  return finite(Math.fround((degrees * Math.PI) / 180));
}

function finite(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Camera value must be finite.");
  }
  return Object.is(value, -0) ? 0 : value;
}
