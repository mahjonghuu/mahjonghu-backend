import { AuthModule } from '../auth/auth.module.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutletAccessEntity } from './entities/outlet-access.entity.js';
import { OutletEntity } from './entities/outlet.entity.js';
import { OutletsController } from './outlets.controller.js';
import { OutletsService } from './outlets.service.js';
import { OutletAccessService } from './outlet-access.service.js';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([OutletEntity, OutletAccessEntity]),
  ],
  controllers: [OutletsController],
  providers: [OutletsService, OutletAccessService, JWTAuthGuard],
  exports: [OutletsService, OutletAccessService],
})
export class OutletsModule {}
