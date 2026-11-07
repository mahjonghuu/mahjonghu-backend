import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import {
  assertTrustedMutationOrigin,
  readSessionToken,
} from './session-token.js';

type OwnerClaims = { sub: string; role: string };

type OwnerRequest = Request & { owner?: OwnerClaims };

/** Authenticates an active owner dashboard session; employees are rejected here. */
@Injectable()
export class JWTAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OwnerRequest>();
    const session = readSessionToken(request);
    if (!session) {
      throw new UnauthorizedException('Autentikasi diperlukan.');
    }
    assertTrustedMutationOrigin(request, session.source);
    try {
      const claims = await this.jwt.verifyAsync<OwnerClaims>(session.token);
      if (claims.role !== 'owner' || !claims.sub) {
        throw new UnauthorizedException('Akses hanya untuk owner.');
      }
      request.owner = claims;
      return true;
    } catch {
      throw new UnauthorizedException('Token tidak valid atau kedaluwarsa.');
    }
  }
}
