import {
  currentJakartaDate,
  isAdvertisementDate,
} from './advertisement-schedule.js';

describe('advertisement calendar dates', () => {
  it.each([
    '2024-02-29',
    '2000-02-29',
    '2026-10-30',
    '0001-01-01',
    '9999-12-31',
  ])('accepts the real exact calendar date %s', (value) => {
    expect(isAdvertisementDate(value)).toBe(true);
  });

  it.each([
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '0000-01-01',
    '2026-1-01',
    '2026-01-1',
    '2026-10-30T00:00:00Z',
    ' 2026-10-30',
    '2026-10-30 ',
    '',
    null,
    undefined,
    20261030,
  ])('rejects impossible or nonexact date %s', (value) => {
    expect(isAdvertisementDate(value)).toBe(false);
  });

  it('changes dates precisely at Jakarta midnight, not UTC midnight', () => {
    expect(currentJakartaDate(new Date('2026-10-29T16:59:59.999Z'))).toBe(
      '2026-10-29',
    );
    expect(currentJakartaDate(new Date('2026-10-29T17:00:00.000Z'))).toBe(
      '2026-10-30',
    );
    expect(currentJakartaDate(new Date('2026-10-30T16:59:59.999Z'))).toBe(
      '2026-10-30',
    );
    expect(currentJakartaDate(new Date('2026-10-30T17:00:00.000Z'))).toBe(
      '2026-10-31',
    );
  });
});
