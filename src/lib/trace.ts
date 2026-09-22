/**
 * Decision trace — architecture §5, §13.
 *
 * Obelus streams what it is doing to the UI while it works ("Found 5 claims →
 * checking WEEX → ..."). The trace is also stored on the report, so a judge can
 * expand it and see exactly which sources were consulted in which order.
 */

export type TraceEvent = { t: string; step: string };

export class Trace {
  private readonly events: TraceEvent[] = [];
  private readonly listeners = new Set<(e: TraceEvent) => void>();

  /** Record a step. Keep the text human-readable — it is shown to users verbatim. */
  step(text: string): TraceEvent {
    const event: TraceEvent = { t: new Date().toISOString(), step: text };
    this.events.push(event);
    for (const listener of this.listeners) {
      // A broken listener (e.g. a closed SSE stream) must never fail the pipeline.
      try {
        listener(event);
      } catch {
        /* ignore */
      }
    }
    return event;
  }

  /** Subscribe to live events, for the SSE stream in /api/check. */
  onStep(listener: (e: TraceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  all(): TraceEvent[] {
    return [...this.events];
  }
}
