import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Outlet endpoints are unauthenticated and may only run in local development.',
    );
  }
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.enableCors({ origin: config.get('WEB_ORIGIN', 'http://localhost:3000') });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(config.get('PORT', 3001), '127.0.0.1');
}
await bootstrap();
