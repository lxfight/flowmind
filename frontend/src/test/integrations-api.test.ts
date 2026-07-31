import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createIntegration,
  deleteIntegration,
  listEventCatalog,
  listExternalDeliveries,
  listIntegrations,
  retryExternalDelivery,
  rotateIntegrationSecret,
  testIntegration,
  updateIntegration,
} from '../api/integrations'
import api from '../utils/api'

vi.mock('../utils/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

const input = {
  name: '发布通知',
  url: 'https://example.com/hook',
  event_types: ['task.created'],
  is_enabled: true,
  allow_private_network: false,
}

describe('external integrations api', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads catalog and integrations', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: [{ type: 'task.created' }] })
      .mockResolvedValueOnce({ data: [{ id: 3 }] })
    await listEventCatalog(7)
    await listIntegrations(7)
    expect(api.get).toHaveBeenNthCalledWith(1, '/projects/7/integrations/catalog')
    expect(api.get).toHaveBeenNthCalledWith(2, '/projects/7/integrations')
  })

  it('creates, updates, tests, rotates and deletes a webhook', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { delivery_id: 'd1', signing_secret: 'secret' } })
    vi.mocked(api.put).mockResolvedValue({ data: { id: 3, ...input } })
    vi.mocked(api.delete).mockResolvedValue({ data: {} })
    await createIntegration(7, input)
    await updateIntegration(7, 3, { is_enabled: false })
    await expect(testIntegration(7, 3)).resolves.toBe('d1')
    await expect(rotateIntegrationSecret(7, 3)).resolves.toBe('secret')
    await deleteIntegration(7, 3)
    expect(api.post).toHaveBeenCalledWith('/projects/7/integrations', input)
    expect(api.put).toHaveBeenCalledWith('/projects/7/integrations/3', { is_enabled: false })
    expect(api.delete).toHaveBeenCalledWith('/projects/7/integrations/3')
  })

  it('lists and retries deliveries', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { items: [], total: 0, page: 2, page_size: 30 } })
    vi.mocked(api.post).mockResolvedValue({ data: { delivery_id: 'd1' } })
    await listExternalDeliveries(7, { page: 2, status: 'failed' })
    await retryExternalDelivery(7, 'd1')
    expect(api.get).toHaveBeenCalledWith('/projects/7/integrations/deliveries', {
      params: { page: 2, page_size: 30, status: 'failed' },
    })
    expect(api.post).toHaveBeenCalledWith('/projects/7/integrations/deliveries/d1/retry')
  })
})
