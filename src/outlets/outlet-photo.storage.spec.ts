import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { OutletPhotoStorage } from './outlet-photo.storage.js';

const ORIGIN = 'https://photos.example.supabase.co';
const UUID = '12345678-1234-4123-8123-123456789abc';
const PUBLIC_URL = `${ORIGIN}/storage/v1/object/public/outlet-photos/outlets/${UUID}.png`;
const PNG = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const JPEG = Buffer.from('ffd8ffe000010203', 'hex');
const WEBP = Buffer.from('524946460400000057454250', 'hex');

function createStorage(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    SUPABASE_URL: ORIGIN,
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-secret',
    ...overrides,
  };
  const get = vi.fn((key: string) => values[key]);
  return {
    storage: new OutletPhotoStorage({ get } as unknown as ConfigService),
    get,
  };
}

function dataUrl(format: string, bytes: Buffer) {
  return `data:image/${format};base64,${bytes.toString('base64')}`;
}

describe('OutletPhotoStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['jpeg', 'jpg', JPEG],
    ['png', 'png', PNG],
    ['webp', 'webp', WEBP],
  ] as const)(
    'uploads decoded %s bytes with matching headers and a fresh public URL',
    async (format, extension, bytes) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response('{}', { status: 200 }));
      vi.stubGlobal('fetch', fetch);
      const { storage } = createStorage();

      const url = await storage.upload(dataUrl(format, bytes));
      expect(url).toMatch(
        new RegExp(
          `^${ORIGIN.replaceAll('.', '\\.')}\\/storage/v1/object/public/outlet-photos/outlets/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.${extension}$`,
        ),
      );
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][0]).toBe(
        url.replace('/object/public/', '/object/'),
      );
      const request = fetch.mock.calls[0][1] as RequestInit;
      expect(request.method).toBe('POST');
      expect(request.redirect).toBe('error');
      expect(Buffer.from(request.body as Uint8Array)).toEqual(bytes);
      const headers = new Headers(request.headers);
      expect(headers.get('Content-Type')).toBe(`image/${format}`);
      expect(headers.get('Authorization')).toBe('Bearer server-only-secret');
      expect(headers.get('apikey')).toBe('server-only-secret');
      expect(headers.has('x-upsert')).toBe(false);
      expect(await storage.upload(dataUrl(format, bytes))).not.toBe(url);
    },
  );

  it('accepts the decoded 512 KiB limit and rejects one byte more before HTTP', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const { storage } = createStorage();
    const limit = Buffer.alloc(524288);
    PNG.copy(limit);
    await storage.upload(dataUrl('png', limit));
    expect(Buffer.from(fetch.mock.calls[0][1].body)).toEqual(limit);
    fetch.mockClear();
    await expect(
      storage.upload(dataUrl('png', Buffer.concat([limit, Buffer.from([0])]))),
    ).rejects.toThrow(BadRequestException);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'https://example.com/photo.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,',
    'data:image/png;base64,AAAA',
    dataUrl('jpeg', PNG),
    dataUrl('png', JPEG),
    dataUrl('webp', PNG),
    dataUrl('png', PNG.subarray(0, 7)),
    dataUrl('webp', WEBP.subarray(0, 11)),
    'data:image/jpeg;base64,/9j/4AABAgN=', // Noncanonical padding bits.
    `${dataUrl('png', PNG)}\n`,
    `data:image/png;base64, ${PNG.toString('base64')}`,
    `data:image/png;base64,${'A'.repeat(699076)}`,
    null,
    undefined,
  ])(
    'rejects invalid photo input before configuration or HTTP',
    async (photo) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      const { storage, get } = createStorage({ SUPABASE_URL: undefined });
      await expect(storage.upload(photo as string)).rejects.toThrow(
        BadRequestException,
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    },
  );

  it('reads configuration only when a photo operation is performed', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { storage, get } = createStorage({ SUPABASE_URL: undefined });
    expect(get).not.toHaveBeenCalled();
    await expect(storage.upload(dataUrl('png', PNG))).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { SUPABASE_URL: undefined },
    { SUPABASE_SERVICE_ROLE_KEY: undefined },
    { SUPABASE_URL: 'not-a-url' },
    { SUPABASE_URL: 'http://remote.example.com' },
    { SUPABASE_URL: 'https://user:password@example.com' },
    { SUPABASE_URL: `${ORIGIN}/other` },
    { SUPABASE_URL: `${ORIGIN}/?secret=yes` },
    { SUPABASE_URL: `${ORIGIN}/#fragment` },
    { SUPABASE_URL: 'ftp://localhost' },
    { SUPABASE_SERVICE_ROLE_KEY: 'secret\nheader' },
    { SUPABASE_OUTLET_PHOTOS_BUCKET: '..' },
  ])(
    'rejects missing or unsafe configuration before HTTP: %j',
    async (overrides) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      const { storage } = createStorage(overrides);
      await expect(storage.upload(dataUrl('png', PNG))).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(storage.remove(PUBLIC_URL)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('normalizes the origin and encodes a configured bucket in upload and removal URLs', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const { storage } = createStorage({
      SUPABASE_URL: ` ${ORIGIN.toUpperCase()}/ `,
      SUPABASE_OUTLET_PHOTOS_BUCKET: ' outlet photos#1 ',
    });
    const url = await storage.upload(dataUrl('png', PNG));
    expect(url).toContain(
      `${ORIGIN}/storage/v1/object/public/outlet%20photos%231/outlets/`,
    );
    await storage.remove(url);
    expect(fetch.mock.calls[1][0]).toBe(
      `${ORIGIN}/storage/v1/object/outlet%20photos%231`,
    );
  });

  it.each([
    'http://localhost:54321',
    'http://127.0.0.1:54321',
    'http://[::1]:54321',
  ])('allows a local HTTP Supabase smoke endpoint: %s', async (origin) => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const { storage } = createStorage({ SUPABASE_URL: origin });
    expect(await storage.upload(dataUrl('png', PNG))).toContain(
      `${origin}/storage/`,
    );
  });

  it('deletes only the generated object path using authenticated Supabase JSON', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await createStorage().storage.remove(PUBLIC_URL);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(
      `${ORIGIN}/storage/v1/object/outlet-photos`,
    );
    const request = fetch.mock.calls[0][1] as RequestInit;
    expect(request.method).toBe('DELETE');
    expect(request.redirect).toBe('error');
    expect(JSON.parse(String(request.body))).toEqual({
      prefixes: [`outlets/${UUID}.png`],
    });
    const headers = new Headers(request.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer server-only-secret');
    expect(headers.get('apikey')).toBe('server-only-secret');
  });

  it.each([
    PUBLIC_URL.replace(ORIGIN, 'https://attacker.example'),
    PUBLIC_URL.replace(ORIGIN, `${ORIGIN}.attacker.example`),
    PUBLIC_URL.replace('outlet-photos', 'other-bucket'),
    PUBLIC_URL.replace('/outlets/', '/avatars/'),
    PUBLIC_URL.replace(UUID, 'not-a-uuid'),
    PUBLIC_URL.replace('-4123-', '-1123-'),
    PUBLIC_URL.replace('.png', '.svg'),
    PUBLIC_URL.replace('/outlets/', '/outlets/../outlets/'),
    PUBLIC_URL.replace('/outlets/', '/outlets%2F'),
    PUBLIC_URL.replace('/outlets/', '/outlets/nested/'),
    `${PUBLIC_URL}?download=true`,
    `${PUBLIC_URL}#fragment`,
    `${PUBLIC_URL}\n`,
    `${PUBLIC_URL}\r`,
    `${PUBLIC_URL}\u2028`,
    PUBLIC_URL.replace('https://', 'https://user:password@'),
    'data:image/png;base64,AAAA',
    '',
    null,
  ])(
    'rejects unowned or noncanonical deletion URLs without HTTP',
    async (url) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      await expect(
        createStorage().storage.remove(url as string),
      ).rejects.toThrow(BadRequestException);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['upload', 'remove'] as const)(
    'sanitizes failed HTTP and network errors for %s',
    async (operation) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      const { storage } = createStorage();
      for (const status of [301, 400, 401, 403, 404, 500, 503]) {
        fetch.mockResolvedValueOnce(
          new Response('server-only-secret upstream details', { status }),
        );
        const result =
          operation === 'upload'
            ? storage.upload(dataUrl('png', PNG))
            : storage.remove(PUBLIC_URL);
        await expect(result).rejects.toMatchObject({
          status: 503,
          message: 'Penyimpanan foto outlet tidak tersedia.',
        });
      }
      fetch.mockRejectedValueOnce(new Error('network server-only-secret'));
      const result =
        operation === 'upload'
          ? storage.upload(dataUrl('png', PNG))
          : storage.remove(PUBLIC_URL);
      await expect(result).rejects.toThrow(ServiceUnavailableException);
      await expect(result).rejects.not.toThrow('server-only-secret');
    },
  );
});
