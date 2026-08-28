import { types as utilTypes } from "node:util";
import type { BuiltInValue } from "./canonical.js";

export type ReplayValue = BuiltInValue;

export interface StructuralClassToken<Value extends object> {
  readonly prototype: Value;
}

export interface ValueAdapterDefinition<Value extends object> {
  readonly type: StructuralClassToken<Value>;
  readonly id: string;
  readonly version: number;
  readonly serialize: (value: Value) => ReplayValue;
  readonly deserialize: (payload: unknown) => Value;
}

const adapterBrand: unique symbol = Symbol("ReplayLockValueAdapter");

export interface ValueAdapter<Value extends object = object>
  extends ValueAdapterDefinition<Value> {
  readonly [adapterBrand]: true;
}

export interface TrustedPackageExport {
  readonly export: string;
  readonly versions?: string;
  readonly unpinned?: boolean;
}

export interface TrustedPackage {
  readonly package: string;
  readonly exports: readonly TrustedPackageExport[];
}

export interface ReplayLockConfiguration {
  readonly valueAdapters: readonly ValueAdapter[];
  readonly trustedPackages: readonly TrustedPackage[];
}

export type TrustedPackageDiagnosticCode =
  | "TRUSTED_PACKAGE_DEFINITION_INVALID"
  | "TRUSTED_PACKAGE_ID_DUPLICATE"
  | "TRUSTED_PACKAGE_VERSION_RANGE_INVALID";

export class TrustedPackageConfigurationError extends Error {
  constructor(
    readonly code: TrustedPackageDiagnosticCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "TrustedPackageConfigurationError";
  }
}

export interface ValueAdapterRegistry {
  readonly adapters: readonly ValueAdapter[];
  findForValue(value: object): ValueAdapter | undefined;
  findById(id: string): ValueAdapter | undefined;
}

export type ValueAdapterDiagnosticCode =
  | "VALUE_ADAPTER_DEFINITION_INVALID"
  | "VALUE_ADAPTER_ID_INVALID"
  | "VALUE_ADAPTER_VERSION_INVALID"
  | "VALUE_ADAPTER_TOKEN_INVALID"
  | "VALUE_ADAPTER_BUILTIN_PROTOTYPE"
  | "VALUE_ADAPTER_ID_DUPLICATE"
  | "VALUE_ADAPTER_PROTOTYPE_DUPLICATE";

export class ValueAdapterConfigurationError extends Error {
  constructor(
    readonly code: ValueAdapterDiagnosticCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ValueAdapterConfigurationError";
  }
}

const adapterIdPattern = /^[a-z0-9][a-z0-9_-]*(?:[./:][a-z0-9][a-z0-9_-]*)+$/;

const builtInPrototypes = new Set<object>([
  Object.prototype, Array.prototype, Date.prototype, RegExp.prototype,
  Map.prototype, Set.prototype, WeakMap.prototype, WeakSet.prototype,
  Promise.prototype, Error.prototype, EvalError.prototype, RangeError.prototype,
  ReferenceError.prototype, SyntaxError.prototype, TypeError.prototype,
  URIError.prototype, AggregateError.prototype, Number.prototype,
  String.prototype, Boolean.prototype, ArrayBuffer.prototype,
  SharedArrayBuffer.prototype, DataView.prototype, Int8Array.prototype,
  Uint8Array.prototype, Uint8ClampedArray.prototype, Int16Array.prototype,
  Uint16Array.prototype, Int32Array.prototype, Uint32Array.prototype,
  Float32Array.prototype, Float64Array.prototype, BigInt64Array.prototype,
  BigUint64Array.prototype,
]);

export function defineValueAdapter<Value extends object>(
  definition: ValueAdapterDefinition<Value>,
): ValueAdapter<Value> {
  if (utilTypes.isProxy(definition)) {
    throw configurationError("VALUE_ADAPTER_DEFINITION_INVALID", "adapter definition must not be a Proxy");
  }
  const values = readExactDataProperties(
    definition,
    ["deserialize", "id", "serialize", "type", "version"],
    "adapter definition",
  );
  return Object.freeze({
    type: values.type as StructuralClassToken<Value>,
    id: values.id as string,
    version: values.version as number,
    serialize: values.serialize as (value: Value) => ReplayValue,
    deserialize: values.deserialize as (payload: unknown) => Value,
    [adapterBrand]: true as const,
  });
}

const replayLockConfigurationKeys = new Set(["valueAdapters", "trustedPackages"]);

export function defineReplayLock(
  configuration: {
    readonly valueAdapters?: readonly ValueAdapter[];
    readonly trustedPackages?: readonly TrustedPackage[];
  } = {},
): ReplayLockConfiguration {
  if (utilTypes.isProxy(configuration)) {
    throw configurationError("VALUE_ADAPTER_DEFINITION_INVALID", "configuration must not be a Proxy");
  }
  const descriptors = Object.getOwnPropertyDescriptors(configuration);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !replayLockConfigurationKeys.has(key))) {
    throw configurationError("VALUE_ADAPTER_DEFINITION_INVALID", "configuration has unsupported properties");
  }
  const adapterDescriptor = descriptors.valueAdapters;
  const configuredAdapters = adapterDescriptor === undefined
    ? []
    : dataDescriptorValue(adapterDescriptor, "configuration.valueAdapters");
  const catalogDescriptor = descriptors.trustedPackages;
  const configuredCatalog = catalogDescriptor === undefined
    ? []
    : trustedPackageDataDescriptorValue(catalogDescriptor, "configuration.trustedPackages");
  return Object.freeze({
    valueAdapters: Object.freeze(copyAdapterArray(configuredAdapters)),
    trustedPackages: Object.freeze(copyTrustedPackageArray(configuredCatalog)),
  });
}

export function createValueAdapterRegistry(
  configuration: ReplayLockConfiguration | undefined,
): ValueAdapterRegistry {
  const configured = readConfiguredAdapters(configuration);
  const adapters: ValueAdapter[] = [];
  const byId = new Map<string, ValueAdapter>();
  const byPrototype = new Map<object, ValueAdapter>();

  for (let index = 0; index < configured.length; index += 1) {
    const adapter = normalizeAdapter(configured[index], index);
    if (byId.has(adapter.id)) {
      throw configurationError("VALUE_ADAPTER_ID_DUPLICATE", `adapter ID ${JSON.stringify(adapter.id)} is registered more than once`);
    }
    const prototype = adapterPrototype(adapter, index);
    if (byPrototype.has(prototype)) {
      throw configurationError("VALUE_ADAPTER_PROTOTYPE_DUPLICATE", `adapter prototype at index ${index} is registered more than once`);
    }
    adapters.push(adapter);
    byId.set(adapter.id, adapter);
    byPrototype.set(prototype, adapter);
  }

  const frozenAdapters = Object.freeze(adapters);
  return Object.freeze({
    adapters: frozenAdapters,
    findForValue(value: object): ValueAdapter | undefined {
      if ((typeof value !== "object" && typeof value !== "function") || value === null || utilTypes.isProxy(value)) return undefined;
      return byPrototype.get(Object.getPrototypeOf(value) as object);
    },
    findById(id: string): ValueAdapter | undefined {
      return byId.get(id);
    },
  });
}

function readConfiguredAdapters(configuration: ReplayLockConfiguration | undefined): ValueAdapter[] {
  if (configuration === undefined) return [];
  if ((typeof configuration !== "object" && typeof configuration !== "function") || configuration === null || utilTypes.isProxy(configuration)) {
    throw configurationError("VALUE_ADAPTER_DEFINITION_INVALID", "configuration must be an ordinary object");
  }
  const descriptor = Object.getOwnPropertyDescriptor(configuration, "valueAdapters");
  if (descriptor === undefined) return [];
  return copyAdapterArray(dataDescriptorValue(descriptor, "configuration.valueAdapters"));
}

function copyAdapterArray(value: unknown): ValueAdapter[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw configurationError("VALUE_ADAPTER_DEFINITION_INVALID", "valueAdapters must be an ordinary dense array");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const length = dataDescriptorValue(descriptors["length"], "valueAdapters.length");
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    throw configurationError("VALUE_ADAPTER_DEFINITION_INVALID", "valueAdapters has an invalid length");
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string") || keys.length !== (length as number) + 1) {
    throw configurationError("VALUE_ADAPTER_DEFINITION_INVALID", "valueAdapters must be dense and contain no extra properties");
  }
  const result: ValueAdapter[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    result.push(dataDescriptorValue(descriptors[String(index)], `valueAdapters[${index}]`) as ValueAdapter);
  }
  return result;
}

function normalizeAdapter(value: unknown, index: number): ValueAdapter {
  if ((typeof value !== "object" && typeof value !== "function") || value === null || utilTypes.isProxy(value)) {
    throw configurationError("VALUE_ADAPTER_DEFINITION_INVALID", `adapter at index ${index} must be a non-Proxy object`);
  }
  const values = readExactDataProperties(
    value,
    ["deserialize", "id", "serialize", "type", "version"],
    `adapter at index ${index}`,
    true,
  );
  const id = values.id;
  if (typeof id !== "string" || id.length > 128 || !adapterIdPattern.test(id)) {
    throw configurationError("VALUE_ADAPTER_ID_INVALID", `adapter at index ${index} must use a stable namespaced ID`);
  }
  const version = values.version;
  if (!Number.isSafeInteger(version) || (version as number) < 1) {
    throw configurationError("VALUE_ADAPTER_VERSION_INVALID", `adapter ${JSON.stringify(id)} must use a positive safe-integer version`);
  }
  if (typeof values.serialize !== "function" || typeof values.deserialize !== "function") {
    throw configurationError("VALUE_ADAPTER_DEFINITION_INVALID", `adapter ${JSON.stringify(id)} requires serialize and deserialize functions`);
  }
  return Object.freeze({
    type: values.type as StructuralClassToken<object>,
    id,
    version: version as number,
    serialize: values.serialize as (value: object) => ReplayValue,
    deserialize: values.deserialize as (payload: unknown) => object,
    [adapterBrand]: true as const,
  });
}

function adapterPrototype(adapter: ValueAdapter, index: number): object {
  const token = adapter.type;
  if ((typeof token !== "object" && typeof token !== "function") || token === null || utilTypes.isProxy(token)) {
    throw configurationError("VALUE_ADAPTER_TOKEN_INVALID", `adapter at index ${index} has an invalid or Proxy class token`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(token, "prototype");
  if (descriptor === undefined || !("value" in descriptor)) {
    throw configurationError("VALUE_ADAPTER_TOKEN_INVALID", `adapter at index ${index} class token requires an own data prototype`);
  }
  const prototype = descriptor.value;
  if (typeof prototype !== "object" || prototype === null || utilTypes.isProxy(prototype)) {
    throw configurationError("VALUE_ADAPTER_TOKEN_INVALID", `adapter at index ${index} class token has an invalid prototype`);
  }
  if (builtInPrototypes.has(prototype)) {
    throw configurationError("VALUE_ADAPTER_BUILTIN_PROTOTYPE", `adapter at index ${index} cannot target a built-in prototype`);
  }
  return prototype;
}

function readExactDataProperties(
  value: object,
  expected: readonly string[],
  subject: string,
  allowSymbolProperties = false,
): Record<string, unknown> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol" ? !allowSymbolProperties : !expected.includes(key))) {
    throw configurationError("VALUE_ADAPTER_DEFINITION_INVALID", `${subject} has unsupported properties`);
  }
  const values: Record<string, unknown> = {};
  for (const key of expected) values[key] = dataDescriptorValue(descriptors[key], `${subject}.${key}`);
  return values;
}

function dataDescriptorValue(descriptor: PropertyDescriptor | undefined, subject: string): unknown {
  if (descriptor === undefined || !("value" in descriptor)) {
    throw configurationError("VALUE_ADAPTER_DEFINITION_INVALID", `${subject} must be an own data property`);
  }
  return descriptor.value;
}

function configurationError(code: ValueAdapterDiagnosticCode, message: string): ValueAdapterConfigurationError {
  return new ValueAdapterConfigurationError(code, message);
}

function copyTrustedPackageArray(value: unknown): TrustedPackage[] {
  if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw trustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", "trustedPackages must be an ordinary dense array");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const length = trustedPackageDataDescriptorValue(descriptors["length"], "trustedPackages.length");
  if (!Number.isSafeInteger(length) || (length as number) < 0) {
    throw trustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", "trustedPackages has an invalid length");
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string") || keys.length !== (length as number) + 1) {
    throw trustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", "trustedPackages must be dense and contain no extra properties");
  }
  const result: TrustedPackage[] = [];
  for (let index = 0; index < (length as number); index += 1) {
    result.push(trustedPackageDataDescriptorValue(descriptors[String(index)], `trustedPackages[${index}]`) as TrustedPackage);
  }
  return result;
}

function trustedPackageDataDescriptorValue(descriptor: PropertyDescriptor | undefined, subject: string): unknown {
  if (descriptor === undefined || !("value" in descriptor)) {
    throw trustedPackageConfigurationError("TRUSTED_PACKAGE_DEFINITION_INVALID", `${subject} must be an own data property`);
  }
  return descriptor.value;
}

function trustedPackageConfigurationError(code: TrustedPackageDiagnosticCode, message: string): TrustedPackageConfigurationError {
  return new TrustedPackageConfigurationError(code, message);
}

export const emptyValueAdapterRegistry = createValueAdapterRegistry(undefined);
