import { AuthModule } from '../auth/auth.module.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutletAccessEntity } from './entities/outlet-access.entity.js';
import { OutletEntity } from './entities/outlet.entity.js';
import { OutletsController } from './outlets.controller.js';
import { OutletsService } from './outlets.service.js';
import { OutletAccessService } from './outlet-access.service.js';
import { ImageStorageModule } from '../common/storage/image-storage.module.js';

@Module({
  imports: [
    AuthModule,
    ImageStorageModule,
    TypeOrmModule.forFeature([OutletEntity, OutletAccessEntity]),
  ],
  controllers: [OutletsController],
  providers: [OutletsService, OutletAccessService, JWTAuthGuard],
  exports: [OutletsService, OutletAccessService],
})
export class OutletsModule {}
