import { validateSync } from 'class-validator';
import { CreateOutletDto } from './create-outlet.dto.js';
import { UpdateOutletDto } from './update-outlet.dto.js';

describe('outlet operating hours DTOs', () => {
  it('accepts next-day midnight and the existing same-day 24:00 close', () => {
    for (const closingHour of [0, 24]) {
      const create = Object.assign(new CreateOutletDto(), {
        name: 'Night outlet',
        city: 'Jakarta',
        address: 'Jalan Menteng',
        rate: 75000,
        openingHour: 13,
        closingHour,
      });
      const update = Object.assign(new UpdateOutletDto(), {
        closingHour,
      });
      expect(validateSync(create)).toEqual([]);
      expect(validateSync(update)).toEqual([]);
    }
  });

  it('rejects opening and closing hours outside their wall-clock ranges', () => {
    const create = Object.assign(new CreateOutletDto(), {
      name: 'Night outlet',
      city: 'Jakarta',
      address: 'Jalan Menteng',
      rate: 75000,
      openingHour: 24,
      closingHour: 25,
    });
    const update = Object.assign(new UpdateOutletDto(), {
      openingHour: -1,
      closingHour: -1,
    });
    expect(validateSync(create).map((error) => error.property)).toEqual(
      expect.arrayContaining(['openingHour', 'closingHour']),
    );
    expect(validateSync(update).map((error) => error.property)).toEqual(
      expect.arrayContaining(['openingHour', 'closingHour']),
    );
  });
});
