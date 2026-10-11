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

  /** Returns active tables with occupancy derived from live bookings. */
  @Get()
  findAll() {
    return this.tables.findAll();
  }

  /** Creates a table. */
  @Post()
  create(@Body() dto: CreateTableDto) {
    return this.tables.create(dto);
  }

  /** Updates a table's editable fields. */
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.tables.update(id, dto);
  }

  /** Archives a table without booking history. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.tables.archive(id);
  }
}
