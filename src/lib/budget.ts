/**
 * Tool-call budget — architecture §5.
 *
 * Obelus plans per input, so an adversarial or sprawling announcement could otherwise
 * fan out indefinitely and blow the 60 s Vercel limit. Max 12 external calls per
 * report; checks that do not get their turn return UNVERIFIED with reason
 * BUDGET_EXHAUSTED rather than a guess (§18, fail closed).
 */

export const DEFAULT_BUDGET = 12;

export class BudgetExhaustedError extends Error {
  constructor(public readonly limit: number) {
    super(`Tool-call budget of ${limit} exhausted`);
    this.name = "BudgetExhaustedError";
  }
}

export class Budget {
  private used = 0;

  constructor(private readonly limit: number = DEFAULT_BUDGET) {}

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  get spent(): number {
    return this.used;
  }

  /** True if at least one more call is affordable. Check before starting work. */
  canSpend(): boolean {
    return this.used < this.limit;
  }

  /**
   * Consume one unit. Throws BudgetExhaustedError so a checker can catch it and
   * return UNVERIFIED/BUDGET_EXHAUSTED instead of failing the whole report.
   */
  spend(label: string): void {
    if (!this.canSpend()) throw new BudgetExhaustedError(this.limit);
    this.used++;
    void label; // retained for tracing at the call site
  }
}
