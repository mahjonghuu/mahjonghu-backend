import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');
const requestIdPattern =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

/** Logs each completed HTTP request without recording headers or request bodies. */
export function requestLoggingMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const incomingRequestId = request.get('x-request-id');
  const requestId =
    incomingRequestId && requestIdPattern.test(incomingRequestId)
      ? incomingRequestId
      : randomUUID();
  const startedAt = process.hrtime.bigint();
  let logged = false;

  response.setHeader('X-Request-ID', requestId);

  const logRequest = (aborted: boolean) => {
    if (logged) return;
    logged = true;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const status = response.statusCode;
    const record = JSON.stringify({
      event: aborted ? 'request_aborted' : 'request_completed',
      requestId,
      method: request.method,
      path: request.path,
      status,
      durationMs: Number(durationMs.toFixed(1)),
    });

    if (aborted || status >= 500) logger.error(record);
    else if (status >= 400) logger.warn(record);
    else logger.log(record);
  };

  response.once('finish', () => logRequest(false));
  response.once('close', () => {
    if (!response.writableFinished) logRequest(true);
  });
  next();
}
