/**
 * The reconciliation contract (PHASES.md "The reconciliation method").
 *
 * Values are STRINGS on both sides. Comparing as JS numbers would make a
 * matching pair look different — 0.1 + 0.2 is the canonical example, and this
 * whole tool exists to detect differences that small.
 */
export interface CheckResult {
  name: string;
  /** El Ourwa's value, as a string — never a float. */
  legacy: string;
  /** The new platform's value. */
  current: string;
  match: boolean;
  delta?: string;
  /** Up to 10 offending rows when mismatched, for diagnosis. */
  sample?: unknown[];
}

export interface Check {
  name: string;
  /** Which --only group this belongs to: students, finance, bulletins… */
  group: string;
  run(): Promise<CheckResult[]>;
}
