import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { TableEntity } from './entities/table.entity.js';
import { TablesController } from './tables.controller.js';
import { TablesService } from './tables.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([TableEntity, OutletEntity])],
  controllers: [TablesController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
