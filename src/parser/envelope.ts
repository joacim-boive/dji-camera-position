import { z } from "zod";
import { isPlainObject } from "../json.js";

const envelopeSchema = z
  .object({
    signature: z.string(),
    signature_method: z.string(),
    data: z.unknown(),
  })
  .loose();

export type EnvelopeInfo = {
  isEnvelope: boolean;
  signature?: string;
  signatureMethod?: string;
  dataKeys: string[];
  extraKeys: string[];
  notes: string[];
};

export function detectEnvelope(value: unknown): EnvelopeInfo {
  if (
    !isPlainObject(value) ||
    !("signature" in value) ||
    !("signature_method" in value) ||
    !("data" in value)
  ) {
    return { isEnvelope: false, dataKeys: [], extraKeys: [], notes: [] };
  }

  const parsed = envelopeSchema.safeParse(value);
  const dataKeys = isPlainObject(value.data)
    ? Object.keys(value.data).sort()
    : [];
  const extraKeys = Object.keys(value)
    .filter(
      (key) =>
        key !== "signature" && key !== "signature_method" && key !== "data",
    )
    .sort();
  const notes: string[] = [];
  if (!parsed.success) {
    notes.push(
      "Wrapper keys are present, but their types do not match the loose envelope check.",
    );
  }
  if (typeof value.signature_method === "string") {
    notes.push(
      `signature_method is ${JSON.stringify(value.signature_method)}. For crc32 files, the signature is the CRC of the raw data JSON.`,
    );
  }

  const signature =
    typeof value.signature === "string" ? value.signature : undefined;
  const signatureMethod =
    typeof value.signature_method === "string"
      ? value.signature_method
      : undefined;

  return {
    isEnvelope: true,
    ...(signature === undefined ? {} : { signature }),
    ...(signatureMethod === undefined ? {} : { signatureMethod }),
    dataKeys,
    extraKeys,
    notes,
  };
}
