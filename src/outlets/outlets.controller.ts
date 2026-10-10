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
  @Get()
  findAll() {
    return this.outlets.findAll();
  }

  /** Creates an outlet. */
  @Post()
  create(@Body() dto: CreateOutletDto) {
    return this.outlets.create(dto);
  }

  /** Updates an outlet's editable fields. */
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOutletDto,
  ) {
    return this.outlets.update(id, dto);
  }

  /** Archives an outlet that has no tables or booking history. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.outlets.archive(id);
  }
}
