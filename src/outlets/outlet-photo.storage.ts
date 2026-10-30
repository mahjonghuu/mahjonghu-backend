import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const MAX_PHOTO_BYTES = 512 * 1024;
const GENERATED_OBJECT =
  /^outlets\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** Stores validated outlet images; credentials never leave the backend. */
@Injectable()
export class OutletPhotoStorage {
  constructor(private readonly config: ConfigService) {}

  /** Uploads a validated image and returns its public URL; rejects invalid data or unavailable Storage. */
  async upload(photo: string): Promise<string> {
    const { bytes, format } = this.decodePhoto(photo);
    const { origin, bucket, key } = this.storageConfig();
    const path = `outlets/${randomUUID()}.${format === 'jpeg' ? 'jpg' : format}`;
    await this.request(`${origin}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': `image/${format}`,
      },
      body: bytes,
    });
    return `${origin}/storage/v1/object/public/${bucket}/${path}`;
  }

  /** Deletes only a generated object in the configured bucket; rejects foreign or malformed URLs. */
  async remove(url: string): Promise<void> {
    const { origin, bucket, key } = this.storageConfig();
    const prefix = `${origin}/storage/v1/object/public/${bucket}/`;
    // Match the original string, not a URL-normalized pathname: dot segments,
    // escaped slashes, credentials, query strings and foreign origins are invalid.
    const path =
      typeof url === 'string' && url.startsWith(prefix)
        ? url.slice(prefix.length)
        : '';
    if (GENERATED_OBJECT.exec(path)?.[0] !== path || !path) {
      throw new BadRequestException('URL foto outlet tidak valid.');
    }
    await this.request(`${origin}/storage/v1/object/${bucket}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: [path] }),
    });
  }

  private decodePhoto(photo: string) {
    const invalid = () =>
      new BadRequestException(
        'Foto harus berupa JPEG, PNG, atau WebP base64 dengan ukuran maksimal 512 KiB.',
      );
    // Bound the input before regex matching or decoding allocates memory.
    if (typeof photo !== 'string' || photo.length > 699075) throw invalid();
    const match =
      /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
    if (!match || match[0] !== photo) throw invalid();
    const [, format, encoded] = match;
    if (encoded.length % 4 !== 0) throw invalid();
    const bytes = Buffer.from(encoded, 'base64');
    if (
      bytes.length > MAX_PHOTO_BYTES ||
      bytes.toString('base64') !== encoded
    ) {
      throw invalid();
    }
    const signatureMatches =
      format === 'jpeg'
        ? bytes.length >= 4 &&
          bytes[0] === 0xff &&
          bytes[1] === 0xd8 &&
          bytes[2] === 0xff
        : format === 'png'
          ? bytes.length >= 8 &&
            bytes.readUInt32BE(0) === 0x89504e47 &&
            bytes.readUInt32BE(4) === 0x0d0a1a0a
          : bytes.length >= 12 &&
            bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!signatureMatches) throw invalid();
    return { bytes, format };
  }

  private storageConfig() {
    const unavailable = () =>
      new ServiceUnavailableException(
        'Penyimpanan foto outlet belum tersedia.',
      );
    const base = this.config.get<string>('SUPABASE_URL')?.trim();
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    const bucket =
      this.config.get<string>('SUPABASE_OUTLET_PHOTOS_BUCKET')?.trim() ||
      'outlet-photos';
    if (
      !base ||
      !key ||
      /[\r\n]/.test(key) ||
      bucket === '.' ||
      bucket === '..'
    ) {
      throw unavailable();
    }
    let url: URL;
    let encodedBucket: string;
    try {
      url = new URL(base);
      encodedBucket = encodeURIComponent(bucket);
    } catch {
      throw unavailable();
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw unavailable();
    }
    return { origin: url.origin, bucket: encodedBucket, key };
  }

  private async request(url: string, options: RequestInit): Promise<void> {
    try {
      // Do not follow redirects with the service-role credentials attached.
      const response = await fetch(url, { ...options, redirect: 'error' });
      if (!response.ok) throw new Error('Storage request failed');
    } catch {
      // Storage response bodies and transport errors may contain secrets.
      throw new ServiceUnavailableException(
        'Penyimpanan foto outlet tidak tersedia.',
      );
    }
  }
}
