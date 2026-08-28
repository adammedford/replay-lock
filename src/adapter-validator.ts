import { types as utilTypes } from "node:util";
import type { ValueAdapter, ValueAdapterRegistry } from "./adapters.js";
import {
  decodeCanonicalValue,
  encodeCanonicalValue,
  type CanonicalAdaptedNode,
} from "./canonical.js";

export type AdapterValidationCode =
  | "VALUE_ADAPTER_MISSING"
  | "VALUE_ADAPTER_VERSION_MISMATCH"
  | "VALUE_ADAPTER_DESERIALIZE_FAILED"
  | "VALUE_ADAPTER_DESERIALIZE_TYPE_MISMATCH"
  | "VALUE_ADAPTER_ROUNDTRIP_MISMATCH";

export type AdapterValidationDetailCode =
  | "VALUE_ADAPTER_LOOKUP_FAILED"
  | "VALUE_ADAPTER_PROTOTYPE_MISMATCH";

export interface AdapterDocumentValidation {
  ok: boolean;
  code?: AdapterValidationCode;
  detailCode?: AdapterValidationDetailCode;
}

class FixedAdapterValidationError extends Error {
  constructor(
    readonly code: AdapterValidationCode,
    readonly detailCode?: AdapterValidationDetailCode,
  ) {
    super(code);
    this.name = "FixedAdapterValidationError";
  }
}

/** Validate each document independently without returning adapter values or messages. */
export function validateAdaptedDocuments(
  documents: readonly unknown[],
  registry: ValueAdapterRegistry,
): AdapterDocumentValidation[] {
  return documents.map((document) => {
    try {
      for (const node of adaptedNodes(document)) validateAdaptedNode(node, registry);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof FixedAdapterValidationError
          ? error.code
          : "VALUE_ADAPTER_DESERIALIZE_FAILED",
        ...(error instanceof FixedAdapterValidationError && error.detailCode
          ? { detailCode: error.detailCode }
          : {}),
      };
    }
  });
}

function validateAdaptedNode(node: CanonicalAdaptedNode, registry: ValueAdapterRegistry): void {
  const adapter = registry.findById(node.adapterId);
  if (!adapter) {
    throw new FixedAdapterValidationError("VALUE_ADAPTER_MISSING", "VALUE_ADAPTER_LOOKUP_FAILED");
  }
  if (adapter.version !== node.version) {
    throw new FixedAdapterValidationError("VALUE_ADAPTER_VERSION_MISMATCH", "VALUE_ADAPTER_LOOKUP_FAILED");
  }
  const payload = decodeCanonicalValue(node.payload);
  let reconstructed: unknown;
  try {
    reconstructed = adapter.deserialize(payload);
  } catch {
    throw new FixedAdapterValidationError("VALUE_ADAPTER_DESERIALIZE_FAILED");
  }
  if (
    (typeof reconstructed !== "object" && typeof reconstructed !== "function") ||
    reconstructed === null ||
    utilTypes.isProxy(reconstructed) ||
    registry.findForValue(reconstructed as object) !== adapter
  ) {
    throw new FixedAdapterValidationError(
      "VALUE_ADAPTER_DESERIALIZE_TYPE_MISMATCH",
      "VALUE_ADAPTER_PROTOTYPE_MISMATCH",
    );
  }
  let reencoded: unknown;
  try {
    reencoded = encodeCanonicalValue(reconstructed, {}, registry);
  } catch {
    throw new FixedAdapterValidationError("VALUE_ADAPTER_ROUNDTRIP_MISMATCH");
  }
  if (JSON.stringify(reencoded) !== JSON.stringify(node)) {
    throw new FixedAdapterValidationError("VALUE_ADAPTER_ROUNDTRIP_MISMATCH");
  }
}

function adaptedNodes(value: unknown): CanonicalAdaptedNode[] {
  const nodes: CanonicalAdaptedNode[] = [];
  const visit = (current: unknown): void => {
    if (!current || typeof current !== "object" || utilTypes.isProxy(current)) return;
    if ((current as { kind?: unknown }).kind === "adapted") {
      nodes.push(current as CanonicalAdaptedNode);
      // Adapter payloads are built-in-only, so no adapted descendant exists.
      return;
    }
    if (Array.isArray(current)) {
      for (const item of current) visit(item);
      return;
    }
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(current))) {
      if ("value" in descriptor) visit(descriptor.value);
    }
  };
  visit(value);
  return nodes;
}
