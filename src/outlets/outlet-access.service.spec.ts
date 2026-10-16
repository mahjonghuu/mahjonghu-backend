import { describe, expect, it, vi } from 'vitest';
import { OutletAccessService } from './outlet-access.service.js';

const outletId = 'ae0b42e5-8729-4c98-a281-b447799bf45e';
const userId = '2758b645-b43d-4429-881e-46a5900e8bf4';

function setup() {
  const outlets = {
    query: vi.fn(),
    findOneBy: vi.fn().mockResolvedValue({ id: outletId }),
  };
  const grants = { query: vi.fn(), delete: vi.fn() };
  const manager = { query: vi.fn() };
  const database = {
    transaction: vi.fn(
      (callback: (state: typeof manager) => Promise<unknown>) =>
        callback(manager),
    ),
  };
  return {
    service: new OutletAccessService(
      outlets as never,
      grants as never,
      database as never,
    ),
    outlets,
    grants,
    manager,
  };
}

describe('OutletAccessService', () => {
  it('refuses grants to owner accounts and past expiries', async () => {
    const { service, manager } = setup();
    await expect(
      service.grant(outletId, 'member@example.com', '2020-01-01T00:00:00Z'),
    ).rejects.toMatchObject({ status: 400 });
    expect(manager.query).not.toHaveBeenCalled();
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: userId, role: 'owner', is_active: true }]);
    await expect(
      service.grant(outletId, 'owner@example.com'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('requires an existing outlet before returning grants or revoking one', async () => {
    const { service, outlets, grants } = setup();
    outlets.findOneBy.mockResolvedValue(null);
    await expect(service.list(outletId)).rejects.toMatchObject({ status: 404 });
    await expect(service.revoke(outletId, userId)).rejects.toMatchObject({
      status: 404,
    });
    expect(grants.delete).not.toHaveBeenCalled();
  });
});
