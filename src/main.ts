import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { requestLoggingMiddleware } from './common/request-logging.middleware.js';

async function bootstrap() {
  console.info('[bootstrap] Starting Nest application');
  const app = await NestFactory.create(AppModule, { rawBody: true });
  console.info('[bootstrap] Nest application created');
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
  const port = config.get<number>('PORT', 3001);
  console.info('[bootstrap] Starting HTTP listener');
  if (process.env.VERCEL) {
    // Vercel routes requests to the recognized Nest entrypoint; do not bind localhost.
    await app.listen(port);
  } else {
    await app.listen(port, '127.0.0.1');
  }
  console.info('[bootstrap] HTTP listener ready');
}
await bootstrap().catch((error: unknown) => {
  console.error('[bootstrap] Startup failed', error);
  throw error;
});
