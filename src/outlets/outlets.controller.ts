import { UseGuards } from '@nestjs/common';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
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
} from '@nestjs/common';
import { CreateOutletDto } from './dto/create-outlet.dto.js';
import { UpdateOutletDto } from './dto/update-outlet.dto.js';
import { OutletsService } from './outlets.service.js';

/** Local development API for outlet management; add owner authentication before deployment. */
@Controller('outlets')
export class OutletsController {
  constructor(private readonly outlets: OutletsService) {}

  /** Returns outlets that have not been archived. */
  @UseGuards(JWTAuthGuard)
  @Get()
  findAll() {
    return this.outlets.findAll();
  }

  /** Returns active outlets for public discovery. */
  @Get('public')
  findPublic() {
    return this.outlets.findPublic();
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
