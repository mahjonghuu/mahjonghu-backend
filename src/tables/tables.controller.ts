import { UseGuards } from '@nestjs/common';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateTableDto } from './dto/create-table.dto.js';
import { UpdateTableDto } from './dto/update-table.dto.js';
import { TablesService } from './tables.service.js';

/** Local development API for mahjong table management. */
@Controller('tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  /** Lists active tables for public outlet discovery. */
  @Get('public')
  findPublic() {
    return this.tables.findPublic();
  }

  /** Returns active tables with occupancy derived from live bookings. */
  @UseGuards(JWTAuthGuard)
  @Get()
  findAll() {
    return this.tables.findAll();
  }

  @UseGuards(JWTAuthGuard)
  @Post()
  create(@Body() dto: CreateTableDto) {
    return this.tables.create(dto);
  }

  /** Updates a table's editable fields. */
  @UseGuards(JWTAuthGuard)
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.tables.update(id, dto);
  }

  /** Archives a table without booking history. */
  @UseGuards(JWTAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.tables.archive(id);
  }
}
