import type {
  EventDefinition,
  ExternalDeliveryList,
  ExternalIntegration,
  ExternalIntegrationInput,
} from '../types'
import api from '../utils/api'

export async function listEventCatalog(projectId: number): Promise<EventDefinition[]> {
  const response = await api.get(`/projects/${projectId}/integrations/catalog`)
  return response.data
}

export async function listIntegrations(projectId: number): Promise<ExternalIntegration[]> {
  const response = await api.get(`/projects/${projectId}/integrations`)
  return response.data
}

export async function createIntegration(
  projectId: number,
  input: ExternalIntegrationInput,
): Promise<ExternalIntegration & { signing_secret: string }> {
  const response = await api.post(`/projects/${projectId}/integrations`, input)
  return response.data
}

export async function updateIntegration(
  projectId: number,
  integrationId: number,
  input: Partial<ExternalIntegrationInput>,
): Promise<ExternalIntegration> {
  const response = await api.put(`/projects/${projectId}/integrations/${integrationId}`, input)
  return response.data
}

export async function deleteIntegration(projectId: number, integrationId: number): Promise<void> {
  await api.delete(`/projects/${projectId}/integrations/${integrationId}`)
}

export async function testIntegration(projectId: number, integrationId: number): Promise<string> {
  const response = await api.post(`/projects/${projectId}/integrations/${integrationId}/test`)
  return response.data.delivery_id
}

export async function rotateIntegrationSecret(projectId: number, integrationId: number): Promise<string> {
  const response = await api.post(`/projects/${projectId}/integrations/${integrationId}/rotate-secret`)
  return response.data.signing_secret
}

export async function listExternalDeliveries(
  projectId: number,
  params: { page?: number; pageSize?: number; status?: string } = {},
): Promise<ExternalDeliveryList> {
  const response = await api.get(`/projects/${projectId}/integrations/deliveries`, {
    params: {
      page: params.page ?? 1,
      page_size: params.pageSize ?? 30,
      ...(params.status ? { status: params.status } : {}),
    },
  })
  return response.data
}

export async function retryExternalDelivery(projectId: number, deliveryId: string): Promise<void> {
  await api.post(`/projects/${projectId}/integrations/deliveries/${deliveryId}/retry`)
}
