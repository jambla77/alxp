import { ProtocolMessage, TaskSpec, Offer, TaskContract, ResultBundle, WorkReceipt, DisputeRecord } from "../types/index.js";

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate a raw object as a ProtocolMessage */
export function validateMessage(raw: unknown): ValidationResult {
  const result = ProtocolMessage.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** Validate a TaskSpec */
export function validateTaskSpec(raw: unknown): ValidationResult {
  const result = TaskSpec.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** Validate an Offer */
export function validateOffer(raw: unknown): ValidationResult {
  const result = Offer.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** Validate a TaskContract */
export function validateContract(raw: unknown): ValidationResult {
  const result = TaskContract.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** Validate a ResultBundle */
export function validateResultBundle(raw: unknown): ValidationResult {
  const result = ResultBundle.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** Validate a WorkReceipt */
export function validateWorkReceipt(raw: unknown): ValidationResult {
  const result = WorkReceipt.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** Validate a DisputeRecord */
export function validateDisputeRecord(raw: unknown): ValidationResult {
  const result = DisputeRecord.safeParse(raw);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}
