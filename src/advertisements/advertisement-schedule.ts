import { registerDecorator, type ValidationOptions } from 'class-validator';

const jakartaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Accepts only real Gregorian calendar dates in exact YYYY-MM-DD form. */
export function isAdvertisementDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

/** Validates advertisement calendar fields without accepting timestamps or rollover dates. */
export function IsAdvertisementDate(
  options?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isAdvertisementDate',
      target: target.constructor,
      propertyName: String(propertyKey),
      options,
      validator: {
        validate: isAdvertisementDate,
        defaultMessage: () =>
          '$property must be a real date in YYYY-MM-DD format',
      },
    });
  };
}

/** Returns the server instant's calendar date in Asia/Jakarta, independent of process timezone. */
export function currentJakartaDate(now: Date = new Date()): string {
  const parts = jakartaDate.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}
