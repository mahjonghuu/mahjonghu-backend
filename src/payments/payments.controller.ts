import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerAuthService } from '../auth/customer-auth.service.js';
import { CreateDokuCheckoutDto } from './dto/create-doku-checkout.dto.js';
import {
  DokuClientService,
  type DokuEnvironment,
} from './doku-client.service.js';
import { PaymentsService } from './payments.service.js';

type DokuNotification = {
  order?: { invoice_number?: unknown; amount?: unknown };
  transaction?: { status?: unknown; date?: unknown };
};

/** Public guest checkout, DOKU notifications, and payment-status endpoints. */
@Controller('payments/doku')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly doku: DokuClientService,
    private readonly customerAuth: CustomerAuthService,
  ) {}

  @Post(':environment/checkout')
  async createCheckout(
    @Param('environment') environment: string,
    @Body() dto: CreateDokuCheckoutDto,
    @Req() request: Request,
  ) {
    return this.payments.createCheckout(
      this.environment(environment),
      dto,
      await this.customerAuth.currentUser(request),
    );
  }

  @Post(':environment/notification')
  receiveNotification(
    @Param('environment') environment: string,
    @Body() body: DokuNotification,
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const mode = this.environment(environment);
    if (!request.rawBody) {
      throw new BadRequestException('Raw notification body is unavailable.');
    }
    const requestId = this.doku.verifyNotification(
      mode,
      headers,
      request.rawBody,
      `/payments/doku/${mode}/notification`,
    );
    return this.payments.handleNotification(mode, body, requestId);
  }

  @Get('status/:reference')
  getPublicStatus(@Param('reference') reference: string) {
    return this.payments.getPublicStatus(reference);
  }

  private environment(value: string): DokuEnvironment {
    if (value !== 'dev' && value !== 'prod') {
      throw new BadRequestException('Environment DOKU harus dev atau prod.');
    }
    return value;
  }
}
