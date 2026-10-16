import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { UserEntity } from './entities/user.entity.js';
import { CustomerAuthController } from './customer-auth.controller.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { CustomerOtpEntity } from './entities/customer-otp.entity.js';
import { CustomerOtpIpLimitEntity } from './entities/customer-otp-ip-limit.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, CustomerOtpEntity, CustomerOtpIpLimitEntity]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (secret.length < 32) {
          throw new Error('JWT_SECRET must contain at least 32 characters.');
        }
        return {
          secret,
          signOptions: { algorithm: 'HS256', expiresIn: '8h' },
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
    }),
  ],
  controllers: [AuthController, CustomerAuthController],
  providers: [AuthService, CustomerAuthService, JWTAuthGuard],
  exports: [JwtModule, CustomerAuthService],
})
export class AuthModule {}
