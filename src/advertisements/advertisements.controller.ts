import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JWTAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { AdvertisementsService } from './advertisements.service.js';
import { CreateAdvertisementDto } from './dto/create-advertisement.dto.js';
import { UpdateAdvertisementDto } from './dto/update-advertisement.dto.js';

/** Owner advertisement management and unauthenticated active homepage discovery. */
@Controller('advertisements')
export class AdvertisementsController {
  constructor(private readonly advertisements: AdvertisementsService) {}

  /** Lists every schedule for an authenticated owner. */
  @Get()
  @UseGuards(JWTAuthGuard)
  @Header('Cache-Control', 'no-store')
  findAll() {
    return this.advertisements.findAll();
  }

  /** Returns only advertisements active today in Jakarta, without requiring a session. */
  @Get('public')
  @Header('Cache-Control', 'no-store')
  findPublic() {
    return this.advertisements.findPublic();
  }

  /** Creates a scheduled image advertisement. */
  @Post()
  @UseGuards(JWTAuthGuard)
  create(@Body() dto: CreateAdvertisementDto) {
    return this.advertisements.create(dto);
  }

  /** Applies partial edits, retaining the image when it is omitted. */
  @Patch(':id')
  @UseGuards(JWTAuthGuard)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAdvertisementDto,
  ) {
    return this.advertisements.update(id, dto);
  }

  /** Deletes an advertisement and returns an empty successful response. */
  @Delete(':id')
  @UseGuards(JWTAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.advertisements.remove(id);
  }
}
