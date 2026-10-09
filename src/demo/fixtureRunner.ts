import type { LoootRun, LoootRunner } from "@/lib/looot";
import { rowsOf } from "@/lib/normalize";
import { ALL_ENDPOINTS } from "@/lib/sources";
import { fixtureBody } from "./fixtures";

/**
 * A LoootRunner that answers from fixtures and never touches the network. Demo mode and tests use it.
 * It reports the list price a real call would have cost, so the demo screens show realistic numbers. Nothing is charged.
 */
export class FixtureRunner implements LoootRunner {
  readonly calls: { endpointId: string; input: Record<string, unknown>; idempotencyKey: string }[] = [];

  async runAndWait(endpointId: string, input: Record<string, unknown>, idempotencyKey: string): Promise<LoootRun> {
    this.calls.push({ endpointId, input, idempotencyKey });
    const result = fixtureBody(endpointId, input);
    const def = ALL_ENDPOINTS.find((e) => e.endpointId === endpointId);
    const micros = def ? (def.unit === "result" ? def.fallbackMicros * rowsOf(result).length : def.fallbackMicros) : 0;
    return { runId: `demo-${this.calls.length}`, status: "completed", result, actualCost: micros / 1e6 };
  }

  async getRun(runId: string): Promise<LoootRun> {
    return { runId, status: "completed", result: {}, actualCost: 0 };
  }
}
