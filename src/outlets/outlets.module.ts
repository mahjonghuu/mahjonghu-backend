import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutletEntity } from './entities/outlet.entity.js';
import { OutletsController } from './outlets.controller.js';
import { OutletsService } from './outlets.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([OutletEntity])],
  controllers: [OutletsController],
  providers: [OutletsService],
  exports: [OutletsService],
})
export class OutletsModule {}
