import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { requestLoggingMiddleware } from './common/request-logging.middleware.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(requestLoggingMiddleware);
  const config = app.get(ConfigService);
  app.enableCors({
    origin: config.get('WEB_ORIGIN', 'http://localhost:3000'),
    credentials: true,
  });
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
