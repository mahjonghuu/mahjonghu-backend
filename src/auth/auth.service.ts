import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare } from 'bcryptjs';
import { Repository } from 'typeorm';
import { UserEntity } from './entities/user.entity.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
  ) {}

  /** Authenticates active owners; all other accounts receive the same rejection. */
  async login(email: string, password: string) {
    const user = await this.users
      .createQueryBuilder('user')
      .where('LOWER(user.email) = LOWER(:email)', { email: email.trim() })
      .getOne();
    if (
      !user ||
      !user.isActive ||
      user.role !== 'owner' ||
      !user.passwordHash ||
      !(await compare(password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Email atau password tidak valid.');
    }
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
    });
    return {
      accessToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
