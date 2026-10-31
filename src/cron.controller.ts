import {
  Controller,
  Get,
  Header,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

/** Vercel-scheduled database activity; never exposes outlet records. */
@Controller('cron')
export class CronController {
  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Reads at most one outlet ID from Supabase through the existing database pool.
   * @throws UnauthorizedException when CRON_SECRET is unset or the bearer token differs.
   * @throws If the database query fails; a failed invocation must not report success.
   */
  @Get('supabase-keep-alive')
  @Header('Cache-Control', 'no-store')
  async keepAlive(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<{ ok: true }> {
    const secret = this.config.get<string>('CRON_SECRET');
    if (!secret || authorization !== `Bearer ${secret}`) {
      throw new UnauthorizedException();
    }

    await this.dataSource.query('SELECT id FROM outlets LIMIT 1');
    return { ok: true };
  }
}
