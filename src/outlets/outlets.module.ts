import { AuthModule } from '../auth/auth.module.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutletEntity } from './entities/outlet.entity.js';
import { OutletsController } from './outlets.controller.js';
import { OutletsService } from './outlets.service.js';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([OutletEntity])],
  controllers: [OutletsController],
  providers: [OutletsService, JWTAuthGuard],
  exports: [OutletsService],
})
export class OutletsModule {}
