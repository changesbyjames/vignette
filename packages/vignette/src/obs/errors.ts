import { z } from "zod";

/**
 * obs-websocket's `ResourceNotFound` status. OBS frees an input when the last scene item showing it
 * goes, a moment after the request that removed the item, so a resource can vanish between two
 * requests about it.
 */
export const RESOURCE_NOT_FOUND = 600;

/** The snapshot cannot be represented safely in the connected OBS; retrying will not help. */
export class ObsPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObsPreflightError";
  }
}

/** Plan execution failed after remote state may have changed. */
export class ObsExecutionError extends Error {
  readonly operationKey: string;

  constructor(operationKey: string, cause: unknown) {
    const reason = cause instanceof Error ? ` ${cause.message}` : "";
    super(`OBS execution failed at operation '${operationKey}'.${reason}`, { cause });
    this.name = "ObsExecutionError";
    this.operationKey = operationKey;
  }
}

/** One obs-websocket request returned an unsuccessful status. */
export class ObsRequestError extends Error {
  readonly code: number;

  constructor(requestType: string, code: number, comment?: string) {
    super(
      `OBS request '${requestType}' failed with code ${String(code)}${comment === undefined ? "." : `: ${comment}`}`,
    );
    this.name = "ObsRequestError";
    this.code = code;
  }
}

/** The `code` and `cause` an error from obs-websocket may carry. */
export const ObsErrorDetailsSchema = z.object({
  code: z.number().optional().catch(undefined),
  cause: z.unknown().optional(),
});
/** The `code` and `cause` an error from obs-websocket may carry. */
export type ObsErrorDetails = z.output<typeof ObsErrorDetailsSchema>;

/** Follows error causes until an OBS code appears; a visited set also handles cyclic chains. */
export function readObsErrorCode(cause: unknown): number | undefined {
  let current: unknown = cause;
  const visited = new Set<unknown>();
  while (!visited.has(current)) {
    const parsed = ObsErrorDetailsSchema.safeParse(current);
    if (!parsed.success) return undefined;
    visited.add(current);
    if (parsed.data.code !== undefined) return parsed.data.code;
    current = parsed.data.cause;
  }
  return undefined;
}
