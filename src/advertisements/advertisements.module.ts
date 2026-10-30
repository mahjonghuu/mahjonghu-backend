import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ImageStorageModule } from '../common/storage/image-storage.module.js';
import { AdvertisementsController } from './advertisements.controller.js';
import { AdvertisementsService } from './advertisements.service.js';
import { AdvertisementEntity } from './entities/advertisement.entity.js';

/** Registers owner and public advertisement APIs with shared server-only image Storage. */
@Module({
  imports: [
    AuthModule,
    ImageStorageModule,
    TypeOrmModule.forFeature([AdvertisementEntity]),
  ],
  controllers: [AdvertisementsController],
  providers: [AdvertisementsService, JWTAuthGuard],
})
export class AdvertisementsModule {}
