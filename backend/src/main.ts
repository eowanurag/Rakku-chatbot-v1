import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as morgan from 'morgan';
import { LoggingInterceptor } from './common/logging.interceptor';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ limit: '1mb', extended: true }));

  // Use Morgan for standard HTTP logging
  app.use(morgan('dev'));

  // Use Global Interceptor for entry/exit and detailed error logging
  app.useGlobalInterceptors(new LoggingInterceptor());

  app.enableCors({
    origin: '*',
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://0.0.0.0:${port}/api`);
}
bootstrap();
