import { UseGuards } from '@nestjs/common';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CustomerAuthService } from '../auth/customer-auth.service.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { GrantOutletAccessDto } from './dto/grant-outlet-access.dto.js';
import { OutletAccessService } from './outlet-access.service.js';
import { CreateOutletDto } from './dto/create-outlet.dto.js';
import { UpdateOutletDto } from './dto/update-outlet.dto.js';
import { OutletsService } from './outlets.service.js';

/** Owner outlet management and customer-aware discovery. */
@Controller('outlets')
export class OutletsController {
  constructor(
    private readonly outlets: OutletsService,
    private readonly access: OutletAccessService,
    private readonly customerAuth: CustomerAuthService,
  ) {}

  /** Returns outlets that have not been archived. */
  @UseGuards(JWTAuthGuard)
  @Get()
  findAll() {
    return this.outlets.findAll();
  }

  /** Returns active outlets for public discovery. */
  @Get('public')
  async findPublic(@Req() request: Request) {
    const customerId = await this.customerAuth.currentUser(request);
    return this.outlets.findPublic(customerId);
  }

  @UseGuards(JWTAuthGuard)
  @Get(':id/access')
  listAccess(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.access.list(id);
  }

  @UseGuards(JWTAuthGuard)
  @Post(':id/access')
  grantAccess(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: GrantOutletAccessDto,
  ) {
    return this.access.grant(id, body.email, body.expiresAt);
  }

  @UseGuards(JWTAuthGuard)
  @Delete(':id/access/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAccess(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.access.revoke(id, userId);
  }

  /** Creates an outlet. */
  @UseGuards(JWTAuthGuard)
  @Post()
  create(@Body() dto: CreateOutletDto) {
    return this.outlets.create(dto);
  }

  /** Updates an outlet's editable fields. */
  @UseGuards(JWTAuthGuard)
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOutletDto,
  ) {
    return this.outlets.update(id, dto);
  }

  @UseGuards(JWTAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.outlets.archive(id);
  }
}
