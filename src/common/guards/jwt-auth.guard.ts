import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

type OwnerClaims = { sub: string; role: string };

type OwnerRequest = Request & { owner?: OwnerClaims };

@Injectable()
export class JWTAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OwnerRequest>();
    const [scheme, bearerToken] =
      request.headers.authorization?.split(' ') ?? [];
    const cookieToken = request.headers.cookie
      ?.split(';')
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith('ownerToken='))
      ?.slice('ownerToken='.length);
    const token =
      request.headers.authorization !== undefined
        ? scheme === 'Bearer'
          ? bearerToken
          : undefined
        : cookieToken;
    if (!token) {
      throw new UnauthorizedException('Autentikasi diperlukan.');
    }
    if (
      cookieToken &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin !==
        (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
    ) {
      throw new ForbiddenException('Origin tidak diizinkan.');
    }
    try {
      const claims = await this.jwt.verifyAsync<OwnerClaims>(token);
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
