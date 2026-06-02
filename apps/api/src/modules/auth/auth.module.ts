import { Module, forwardRef } from '@nestjs/common';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { AuthTokenCleanupService } from './auth-token-cleanup.service';
import { LoginAuditService } from './login-audit.service';
import { LoginAuditRetentionCron } from './login-audit-retention.cron';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAudienceGuard } from './guards/jwt-audience.guard';
import { EmailModule } from '../email/email.module';
import { LineOaModule } from '../line-oa/line-oa.module';
import { TestModeModule } from '../test-mode/test-mode.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: (configService: ConfigService) => ({
        // JWT_SECRET guaranteed by validateEnv() at startup
        secret: configService.get<string>('JWT_SECRET')!,
        signOptions: {
          // jsonwebtoken 9 narrows expiresIn to ms StringValue template literal —
          // ConfigService returns generic `string`, so cast to JwtSignOptions['expiresIn']
          expiresIn: configService.get<string>('JWT_EXPIRATION', '15m') as JwtSignOptions['expiresIn'],
        },
      }),
      inject: [ConfigService],
    }),
    EmailModule,
    forwardRef(() => LineOaModule),
    TestModeModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TwoFactorService,
    AuthTokenCleanupService,
    LoginAuditService,
    LoginAuditRetentionCron,
    JwtStrategy,
    JwtAudienceGuard,
  ],
  exports: [AuthService, TwoFactorService, LoginAuditService, JwtStrategy, PassportModule, JwtAudienceGuard],
})
export class AuthModule {}
