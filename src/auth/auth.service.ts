import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare } from 'bcryptjs';
import { IsNull, Repository } from 'typeorm';
import { OutletEntity } from '../outlets/entities/outlet.entity.js';
import { UserEntity } from './entities/user.entity.js';

/** Shape returned to the dashboard after a successful login. */
export type DashboardLoginUser = {
  id: string;
  email: string;
  role: 'owner' | 'employee';
  outletId: string | null;
};

/** Authenticates owners and employees for the dashboard. */
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(OutletEntity)
    private readonly outlets: Repository<OutletEntity>,
    private readonly jwt: JwtService,
  ) {}

  /** Authenticates an active owner or employee; all failures share one message. */
  async login(email: string, password: string) {
    const user = await this.users
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email: email.trim() })
      .getOne();
    if (
      !user ||
      !user.isActive ||
      (user.role !== 'owner' && user.role !== 'employee') ||
      !user.passwordHash ||
      !(await compare(password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Email atau password tidak valid.');
    }

    if (user.role === 'employee') {
      if (!user.outletId) {
        throw new UnauthorizedException('Email atau password tidak valid.');
      }
      const outlet = await this.outlets.findOneBy({
        id: user.outletId,
        archivedAt: IsNull(),
      });
      if (!outlet?.isActive) {
        throw new UnauthorizedException('Email atau password tidak valid.');
      }
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      ...(user.role === 'employee' ? { outletId: user.outletId } : {}),
    });
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        outletId: user.outletId ?? null,
      } satisfies DashboardLoginUser,
    };
  }
}
