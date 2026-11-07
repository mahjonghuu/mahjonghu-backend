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
  Query,
  UseGuards,
} from '@nestjs/common';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CreateEmployeeDto } from './dto/create-employee.dto.js';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto.js';
import { UpdateEmployeeDto } from './dto/update-employee.dto.js';
import { EmployeesService } from './employees.service.js';

/** Owner-only employee provisioning and outlet assignment. */
@Controller('employees')
@UseGuards(JWTAuthGuard)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  /** Lists employees, optionally filtered by outlet and activation. */
  @Get()
  list(@Query() query: ListEmployeesQueryDto) {
    return this.employees.list(query.outletId, query.includeInactive ?? true);
  }

  /** Creates one employee account assigned to one outlet. */
  @Post()
  create(@Body() dto: CreateEmployeeDto) {
    return this.employees.create(dto);
  }

  /** Updates credentials, outlet, or activation for one employee. */
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(id, dto);
  }

  /** Deactivates an employee; the account and history remain. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.employees.deactivate(id);
  }
}
