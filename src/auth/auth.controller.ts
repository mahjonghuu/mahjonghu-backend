import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  DashboardAuthGuard,
  type DashboardRequest,
} from '../common/guards/dashboard-auth.guard.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

function ownerCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    ...(process.env.OWNER_COOKIE_DOMAIN
      ? { domain: process.env.OWNER_COOKIE_DOMAIN }
      : {}),
    sameSite: 'strict' as const,
    path: '/',
  };
}

/** Removes API-host-only sessions issued before cross-subdomain cookies were enabled. */
function clearLegacyOwnerCookie(response: Response) {
  if (process.env.OWNER_COOKIE_DOMAIN) {
    response.clearCookie('ownerToken', {
      ...ownerCookieOptions(),
      domain: undefined,
    });
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Returns the current dashboard identity and scope. */
  @Get('me')
  @Header('Cache-Control', 'no-store')
  @UseGuards(DashboardAuthGuard)
  me(@Req() request: DashboardRequest) {
    const actor = request.dashboardActor!;
    return {
      authenticated: true,
      role: actor.role,
      outletId: actor.outletId,
    };
  }

  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(body.email, body.password);
    clearLegacyOwnerCookie(response);
    response.cookie('ownerToken', result.accessToken, {
      ...ownerCookieOptions(),
      maxAge: 8 * 60 * 60 * 1000,
    });
    return { user: result.user };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('ownerToken', ownerCookieOptions());
    clearLegacyOwnerCookie(response);
    return { loggedOut: true };
  }
}
