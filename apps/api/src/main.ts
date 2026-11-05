import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 4000;
  const appUrl = configService.get<string>('APP_URL') || 'http://localhost:3000';

  // Global API route prefix
  app.setGlobalPrefix('api');

  // Input validation pipe adhering to security guidelines
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS for local Next.js frontend
  app.enableCors({
    origin: [appUrl, 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // Enable graceful shutdown hooks for Prisma
  app.enableShutdownHooks();

  // Swagger / OpenAPI documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('CineSphere REST API')
    .setDescription(
      'CineSphere backend API for personal entertainment tracking, hybrid content recommendations, and Movie Universe.',
    )
    .setVersion('0.1.0')
    .addTag('Health', 'System diagnostics, database connectivity, and pgvector extension status')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port);
  logger.log(`CineSphere API running on: http://localhost:${port}/api`);
  logger.log(`Health check endpoint: http://localhost:${port}/api/health`);
  logger.log(`Swagger documentation: http://localhost:${port}/api/docs`);
}

bootstrap();
