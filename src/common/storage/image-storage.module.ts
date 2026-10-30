import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseImageStorage } from './supabase-image.storage.js';

/** Provides server-only raster image storage to feature modules. */
@Module({
  imports: [ConfigModule],
  providers: [SupabaseImageStorage],
  exports: [SupabaseImageStorage],
})
export class ImageStorageModule {}
