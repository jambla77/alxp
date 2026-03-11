import type { TaskState, DID } from "../types/index.js";

/** A state transition definition */
export interface TransitionDef {
  from: TaskState;
  to: TaskState;
  trigger: string;
  requiredSignatures: ("requester" | "worker")[];
}

/** All valid transitions in the task lifecycle */
export const TRANSITIONS: TransitionDef[] = [
  // Happy path
  { from: "POSTED", to: "BIDDING", trigger: "first_offer_received", requiredSignatures: [] },
  { from: "BIDDING", to: "AWARDED", trigger: "offer_accepted", requiredSignatures: ["requester", "worker"] },
  { from: "AWARDED", to: "RUNNING", trigger: "context_transferred", requiredSignatures: ["requester"] },
  { from: "RUNNING", to: "CHECKPOINT", trigger: "progress_report", requiredSignatures: ["worker"] },
  { from: "RUNNING", to: "BLOCKED", trigger: "input_needed", requiredSignatures: ["worker"] },
  { from: "RUNNING", to: "SUBMITTED", trigger: "result_submitted", requiredSignatures: ["worker"] },
  { from: "CHECKPOINT", to: "RUNNING", trigger: "checkpoint_acknowledged", requiredSignatures: [] },
  { from: "BLOCKED", to: "RUNNING", trigger: "input_provided", requiredSignatures: ["requester"] },
  { from: "SUBMITTED", to: "REVIEWING", trigger: "review_started", requiredSignatures: ["requester"] },
  { from: "REVIEWING", to: "ACCEPTED", trigger: "result_accepted", requiredSignatures: ["requester"] },
  { from: "REVIEWING", to: "REJECTED", trigger: "result_rejected", requiredSignatures: ["requester"] },
  { from: "REVIEWING", to: "DISPUTED", trigger: "dispute_raised", requiredSignatures: ["worker"] },
  { from: "ACCEPTED", to: "SETTLED", trigger: "payment_released", requiredSignatures: ["requester", "worker"] },
  { from: "REJECTED", to: "SETTLED", trigger: "partial_payment", requiredSignatures: ["requester", "worker"] },
  { from: "DISPUTED", to: "ARBITRATING", trigger: "arbitration_started", requiredSignatures: [] },
  { from: "ARBITRATING", to: "RESOLVED", trigger: "arbitration_complete", requiredSignatures: [] },

  // Optimistic verification flow (Tier 2)
  { from: "REVIEWING", to: "PENDING_CHALLENGE", trigger: "optimistic_accepted", requiredSignatures: ["requester"] },
  { from: "PENDING_CHALLENGE", to: "ACCEPTED", trigger: "challenge_window_closed", requiredSignatures: [] },
  { from: "PENDING_CHALLENGE", to: "DISPUTED", trigger: "challenge_raised", requiredSignatures: [] },

  // Consensus verification flow (Tier 3)
  { from: "REVIEWING", to: "VALIDATING", trigger: "consensus_requested", requiredSignatures: ["requester"] },
  { from: "VALIDATING", to: "ACCEPTED", trigger: "consensus_passed", requiredSignatures: [] },
  { from: "VALIDATING", to: "REJECTED", trigger: "consensus_failed", requiredSignatures: [] },

  // Cancellation (from most active states)
  { from: "POSTED", to: "CANCELLED", trigger: "cancelled", requiredSignatures: ["requester"] },
  { from: "BIDDING", to: "CANCELLED", trigger: "cancelled", requiredSignatures: ["requester"] },
  { from: "AWARDED", to: "CANCELLED", trigger: "cancelled", requiredSignatures: ["requester"] },
  { from: "RUNNING", to: "CANCELLED", trigger: "cancelled", requiredSignatures: ["requester"] },

  // Expiration (from states where a deadline can lapse)
  { from: "POSTED", to: "EXPIRED", trigger: "expired", requiredSignatures: [] },
  { from: "BIDDING", to: "EXPIRED", trigger: "expired", requiredSignatures: [] },
  { from: "RUNNING", to: "EXPIRED", trigger: "expired", requiredSignatures: [] },

  // Failure (worker reports inability)
  { from: "RUNNING", to: "FAILED", trigger: "worker_failed", requiredSignatures: ["worker"] },
  { from: "BLOCKED", to: "FAILED", trigger: "worker_failed", requiredSignatures: ["worker"] },
];

/** Lookup table: from -> trigger -> TransitionDef */
const transitionMap = new Map<string, TransitionDef>();
for (const t of TRANSITIONS) {
  transitionMap.set(`${t.from}:${t.trigger}`, t);
}

/** Error thrown when a transition is invalid */
export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: TaskState,
    public readonly trigger: string,
  ) {
    super(`Invalid transition: cannot apply "${trigger}" from state "${from}"`);
    this.name = "InvalidTransitionError";
  }
}

/** Get the valid transition for a given state and trigger, or null if invalid */
export function getTransition(from: TaskState, trigger: string): TransitionDef | null {
  return transitionMap.get(`${from}:${trigger}`) ?? null;
}

/** Get all valid triggers from a given state */
export function getValidTriggers(from: TaskState): TransitionDef[] {
  return TRANSITIONS.filter((t) => t.from === from);
}

/** Check if a transition is valid */
export function isValidTransition(from: TaskState, trigger: string): boolean {
  return transitionMap.has(`${from}:${trigger}`);
}

/**
 * Tracked task state with history.
 * Enforces the state machine transitions.
 */
export class TaskStateMachine {
  private _state: TaskState;
  private _history: { from: TaskState; to: TaskState; trigger: string; timestamp: string }[] = [];

  constructor(
    public readonly taskId: string,
    public readonly requester: DID,
    public readonly worker?: DID,
    initialState: TaskState = "POSTED",
  ) {
    this._state = initialState;
  }

  get state(): TaskState {
    return this._state;
  }

  get history() {
    return [...this._history];
  }

  /** Apply a trigger to transition to the next state */
  transition(trigger: string, signers: ("requester" | "worker")[] = []): TaskState {
    const def = getTransition(this._state, trigger);
    if (!def) {
      throw new InvalidTransitionError(this._state, trigger);
    }

    // Check required signatures
    for (const required of def.requiredSignatures) {
      if (!signers.includes(required)) {
        throw new Error(
          `Transition "${trigger}" from "${this._state}" requires signature from "${required}"`,
        );
      }
    }

    const from = this._state;
    this._state = def.to;
    this._history.push({
      from,
      to: def.to,
      trigger,
      timestamp: new Date().toISOString(),
    });

    return this._state;
  }

  /** Check if a trigger can be applied to the current state */
  canTransition(trigger: string): boolean {
    return isValidTransition(this._state, trigger);
  }

  /** Get all triggers valid from the current state */
  validTriggers(): TransitionDef[] {
    return getValidTriggers(this._state);
  }

  /** Check if the task is in a terminal state */
  isTerminal(): boolean {
    return ["SETTLED", "CANCELLED", "EXPIRED", "FAILED", "RESOLVED"].includes(this._state);
  }
}
