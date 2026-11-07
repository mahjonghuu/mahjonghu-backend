import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';

@Module({
  imports: [AuthModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, JWTAuthGuard],
})
export class EmployeesModule {}
