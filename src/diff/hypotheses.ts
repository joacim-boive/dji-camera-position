import { lastPathKey } from "../json.js";

export type HypothesisConfidence = "low" | "medium" | "high";

export type Hypothesis = {
  candidate: string;
  confidence: HypothesisConfidence;
  reason: string;
};

type KeyRule = {
  pattern: RegExp;
  candidate: string;
  confidence: HypothesisConfidence;
  reason: string;
};

const OFFSET_COMPONENTS: Hypothesis[] = [
  {
    candidate: "tilt angle in radians",
    confidence: "high",
    reason: "controlled edit: about +π/2 displayed as +90°",
  },
  {
    candidate: "pan angle in radians",
    confidence: "high",
    reason: "controlled edit: about −π displayed as −180°",
  },
  {
    candidate: "roll angle in radians, opposite of the on-screen sign",
    confidence: "high",
    reason: "controlled edit: about +π/2 displayed as −90°",
  },
  {
    candidate: "FOV degrees added to view_param[3]",
    confidence: "high",
    reason: "controlled edit: −40 with base 60 displayed as 20°",
  },
  {
    candidate: "correction added to view_param[4]",
    confidence: "high",
    reason: "controlled edit: −1 with base 1 displayed as 0",
  },
];

const PARAM_COMPONENTS: Hypothesis[] = [
  {
    candidate: "base tilt in radians",
    confidence: "high",
    reason:
      "displayed tilt is this plus view_offset[0], converted from radians",
  },
  {
    candidate: "base pan in radians",
    confidence: "high",
    reason: "displayed pan is this plus view_offset[1], converted from radians",
  },
  {
    candidate: "base roll in radians, opposite of the on-screen sign",
    confidence: "high",
    reason: "displayed roll is the opposite of this plus view_offset[2]",
  },
  {
    candidate: "base FOV in degrees",
    confidence: "high",
    reason: "displayed FOV is this plus view_offset[3]; samples use 60",
  },
  {
    candidate: "base correction",
    confidence: "high",
    reason: "displayed correction is this plus view_offset[4]; samples use 1",
  },
];

const ABSOLUTE_COMPONENTS: Hypothesis[] = [
  {
    candidate: "absolute tilt in radians",
    confidence: "medium",
    reason:
      "same layout as view_param; only a default keyframe has been checked",
  },
  {
    candidate: "absolute pan in radians",
    confidence: "medium",
    reason:
      "same layout as view_param; only a default keyframe has been checked",
  },
  {
    candidate: "absolute roll in radians, opposite of the on-screen sign",
    confidence: "medium",
    reason:
      "same layout as view_param; only a default keyframe has been checked",
  },
  {
    candidate: "absolute FOV in degrees",
    confidence: "medium",
    reason:
      "same layout as view_param; only a default keyframe has been checked",
  },
  {
    candidate: "absolute correction",
    confidence: "medium",
    reason:
      "same layout as view_param; only a default keyframe has been checked",
  },
];

const KEY_RULES: KeyRule[] = [
  {
    pattern: /^(yaw|heading|azimuth)$/i,
    candidate: "horizontal camera angle",
    confidence: "high",
    reason:
      "the key name itself says so; still confirm against a controlled DJI Studio edit",
  },
  {
    pattern: /^pan$/i,
    candidate: "horizontal camera angle",
    confidence: "medium",
    reason: "key name is pan; DJI may use this word for something else",
  },
  {
    pattern: /^(pitch|tilt)$/i,
    candidate: "vertical camera angle",
    confidence: "medium",
    reason: "key name suggests pitch or tilt",
  },
  {
    pattern: /^(roll|horizon)$/i,
    candidate: "horizon or roll",
    confidence: "medium",
    reason: "key name suggests roll or horizon",
  },
  {
    pattern: /^(fov|fieldofview|field_of_view)$/i,
    candidate: "field of view",
    confidence: "high",
    reason: "the key name itself says so; still confirm the unit",
  },
  {
    pattern: /^(quat|quaternion)$/i,
    candidate: "quaternion orientation",
    confidence: "medium",
    reason: "key name suggests a quaternion",
  },
];

/**
 * Annotate a changed path without renaming it.
 * Returns nothing when the field name does not suggest a camera quantity.
 */
export function hypothesize(
  path: string,
  before: unknown,
  after: unknown,
): Hypothesis | undefined {
  if (!isNumericChange(before, after)) {
    return undefined;
  }

  const offset = path.match(/view_offset\[(\d+)\]$/);
  if (offset?.[1] !== undefined) {
    return componentHypothesis(OFFSET_COMPONENTS, offset[1]);
  }
  const param = path.match(/view_param\[(\d+)\]$/);
  if (param?.[1] !== undefined) {
    return componentHypothesis(PARAM_COMPONENTS, param[1]);
  }
  const absolute = path.match(/(?:^|\.)v\[(\d+)\]$/);
  if (absolute?.[1] !== undefined) {
    return componentHypothesis(ABSOLUTE_COMPONENTS, absolute[1]);
  }

  const key = lastPathKey(path);
  if (/^view_offset$/i.test(key)) {
    return {
      candidate:
        "per-clip panorama offset (tilt, pan, roll, FOV delta, correction delta)",
      confidence: "high",
      reason: "controlled edits changed this tuple and the screenshots matched",
    };
  }
  if (/^view_param$/i.test(key)) {
    return {
      candidate: "base panorama view",
      confidence: "high",
      reason: "displayed values are this tuple plus view_offset",
    };
  }
  if (/keyframes\[\d+\]\.v$/.test(path)) {
    return {
      candidate: "absolute panorama view tuple",
      confidence: "medium",
      reason:
        "one default keyframe matched view_param; a moved keyframe has not been tested",
    };
  }

  for (const rule of KEY_RULES) {
    if (rule.pattern.test(key)) {
      return {
        candidate: rule.candidate,
        confidence: rule.confidence,
        reason: rule.reason,
      };
    }
  }

  return undefined;
}

export function numberShape(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const magnitude = Math.abs(value);
  if (magnitude <= Math.PI + 1e-9) {
    return "within ±π";
  }
  if (magnitude <= 2 * Math.PI + 1e-9) {
    return "within ±2π";
  }
  if (magnitude <= 180) {
    return "within ±180";
  }
  if (magnitude <= 360) {
    return "within ±360";
  }
  return undefined;
}

function componentHypothesis(
  components: readonly Hypothesis[],
  indexText: string,
): Hypothesis {
  const index = Number(indexText);
  const row = Number.isInteger(index) ? components[index] : undefined;
  if (row === undefined) {
    return {
      candidate: `component ${indexText} of a 5-number panorama view tuple`,
      confidence: "low",
      reason: "only indexes 0 through 4 were confirmed",
    };
  }
  return row;
}

function isNumericChange(before: unknown, after: unknown): boolean {
  return isNumberLike(before) || isNumberLike(after);
}

function isNumberLike(value: unknown): boolean {
  if (typeof value === "number") {
    return true;
  }
  return (
    Array.isArray(value) && value.every((item) => typeof item === "number")
  );
}
