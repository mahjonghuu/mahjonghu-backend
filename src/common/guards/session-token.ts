import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';

/** Location of a dashboard session token. */
export type SessionTokenSource = 'bearer' | 'cookie';

/** Dashboard token extracted from a bearer header or the owner cookie. */
export type SessionToken = {
  token: string;
  source: SessionTokenSource;
};

/** Reads one dashboard token; an explicit Authorization header never falls back to a cookie. */
export function readSessionToken(request: Request): SessionToken | null {
  const [scheme, bearerToken] = request.headers.authorization?.split(' ') ?? [];
  const cookieToken = request.headers.cookie
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('ownerToken='))
    ?.slice('ownerToken='.length);
  if (request.headers.authorization !== undefined) {
    return scheme === 'Bearer' && bearerToken
      ? { token: bearerToken, source: 'bearer' }
      : null;
  }
  return cookieToken ? { token: cookieToken, source: 'cookie' } : null;
}

/** Cookie-authenticated mutations must come from the configured dashboard origin. */
export function assertTrustedMutationOrigin(
  request: Request,
  source: SessionTokenSource,
): void {
  if (
    source === 'cookie' &&
    !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
    request.headers.origin !==
      (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
  ) {
    throw new ForbiddenException('Origin tidak diizinkan.');
  }
}
