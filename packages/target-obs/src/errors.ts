/** Base class for errors raised by the OBS target. */
export class ObsTargetError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ObsTargetError";
  }
}

/** Desired state cannot be represented safely by the connected OBS instance. */
export class ObsPreflightError extends ObsTargetError {
  constructor(message: string) {
    super(message);
    this.name = "ObsPreflightError";
  }
}

/** Plan execution failed after remote state may have changed. */
export class ObsExecutionError extends ObsTargetError {
  readonly operationKey: string;

  constructor(operationKey: string, cause: unknown) {
    super(`OBS execution became ambiguous at operation '${operationKey}'.`, { cause });
    this.name = "ObsExecutionError";
    this.operationKey = operationKey;
  }
}

/** One obs-websocket request returned an unsuccessful status. */
export class ObsRequestError extends ObsTargetError {
  readonly code: number;

  constructor(requestType: string, code: number, comment?: string) {
    super(
      `OBS request '${requestType}' failed with code ${String(code)}${comment === undefined ? "." : `: ${comment}`}`,
    );
    this.name = "ObsRequestError";
    this.code = code;
  }
}

/** Operation attempted after an OBS target was disposed. */
export class ObsTargetDisposedError extends ObsTargetError {
  constructor(targetId: string) {
    super(`OBS target '${targetId}' is disposed.`);
    this.name = "ObsTargetDisposedError";
  }
}
