import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CustomerAuthService } from './customer-auth.service.js';
import {
  RequestCustomerCodeDto,
  VerifyCustomerCodeDto,
} from './dto/customer-code.dto.js';

function customerCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  };
}

@Controller('auth/customer')
export class CustomerAuthController {
  constructor(private readonly auth: CustomerAuthService) {}

  @Post('request-code')
  async requestCode(
    @Body() body: RequestCustomerCodeDto,
    @Req() request: Request,
  ) {
    await this.auth.requestCode(body.email, request);
    return { sent: true };
  }

  @Post('verify-code')
  async verifyCode(
    @Body() body: VerifyCustomerCodeDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { token, user } = await this.auth.verifyCode(body.email, body.code);
    response.cookie('customerToken', token, {
      ...customerCookieOptions(),
      maxAge: 8 * 60 * 60 * 1000,
    });
    return { user };
  }

  @Get('me')
  async me(@Req() request: Request) {
    const userId = await this.auth.currentUser(request);
    return {
      authenticated: userId !== null,
      user: userId ? await this.auth.profile(userId) : null,
    };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('customerToken', customerCookieOptions());
    return { loggedOut: true };
  }
}
