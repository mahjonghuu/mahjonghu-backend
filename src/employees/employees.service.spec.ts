import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeesService } from './employees.service.js';

const { hashMock } = vi.hoisted(() => ({
  hashMock: vi.fn(async (value: string) => `hash:${value}`),
}));
vi.mock('bcryptjs', () => ({ hash: hashMock }));

const employee = {
  id: 'employee-1',
  email: 'employee@example.com',
  outletId: 'outlet-1',
  outletName: 'Menteng',
  isActive: true,
  createdAt: new Date('2026-11-07T00:00:00.000Z'),
};

function setup() {
  const manager = { query: vi.fn() };
  const database = {
    query: vi.fn(),
    transaction: vi.fn(async (callback: (manager: typeof manager) => unknown) =>
      callback(manager),
    ),
  };
  return {
    manager,
    database,
    service: new EmployeesService(database as never),
  };
}

describe('EmployeesService', () => {
  it('lists employees with optional outlet and activation filters', async () => {
    const { database, service } = setup();
    database.query.mockResolvedValue([employee]);

    await expect(service.list('outlet-1', false)).resolves.toEqual([employee]);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining(`u.role = 'employee'`),
      ['outlet-1', false],
    );
  });

  it('creates an employee with a normalized email and hashed password', async () => {
    const { manager, service } = setup();
    manager.query
      .mockResolvedValueOnce([{ id: 'outlet-1' }])
      .mockResolvedValueOnce([{ id: employee.id }])
      .mockResolvedValueOnce([employee]);

    await expect(
      service.create({
        email: ' EMPLOYEE@Example.com ',
        password: 'temporary-password',
        outletId: 'outlet-1',
      }),
    ).resolves.toEqual(employee);
    expect(hashMock).toHaveBeenCalledWith('temporary-password', 12);
    expect(manager.query.mock.calls[1][1]).toEqual([
      expect.any(String),
      'employee@example.com',
      'hash:temporary-password',
      'outlet-1',
    ]);
  });

  it('maps a duplicate email to a conflict', async () => {
    const { manager, service } = setup();
    manager.query
      .mockResolvedValueOnce([{ id: 'outlet-1' }])
      .mockRejectedValueOnce({ driverError: { code: '23505' } });

    await expect(
      service.create({
        email: 'employee@example.com',
        password: 'temporary-password',
        outletId: 'outlet-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates credentials, assignment, and activation together', async () => {
    const { manager, service } = setup();
    manager.query
      .mockResolvedValueOnce([{ id: employee.id, outletId: 'outlet-1' }])
      .mockResolvedValueOnce([{ id: 'outlet-2' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([employee]);

    await expect(
      service.update(employee.id, {
        email: ' NEW@Example.com ',
        password: 'new-password',
        outletId: 'outlet-2',
        isActive: false,
      }),
    ).resolves.toEqual(employee);
    expect(manager.query.mock.calls[2][1]).toEqual([
      employee.id,
      'new@example.com',
      'hash:new-password',
      'outlet-2',
      false,
    ]);
  });

  it('deactivates an employee and rejects unknown ids', async () => {
    const { database, service } = setup();
    database.query.mockResolvedValueOnce([{ id: employee.id }]);
    await expect(service.deactivate(employee.id)).resolves.toBeUndefined();

    database.query.mockResolvedValueOnce([]);
    await expect(service.deactivate(employee.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
