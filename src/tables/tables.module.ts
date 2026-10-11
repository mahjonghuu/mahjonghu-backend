import { AuthModule } from '../auth/auth.module.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { TableEntity } from './entities/table.entity.js';
import { TablesController } from './tables.controller.js';
import { TablesService } from './tables.service.js';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([TableEntity, OutletEntity])],
  controllers: [TablesController],
  providers: [TablesService, JWTAuthGuard],
  exports: [TablesService],
})
export class TablesModule {}
