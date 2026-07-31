from datetime import datetime

from pydantic import BaseModel, Field


class EventDefinitionOut(BaseModel):
    type: str
    label: str
    group: str
    default_enabled: bool = False


class ExternalIntegrationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    url: str = Field(min_length=1, max_length=2048)
    event_types: list[str] = Field(min_length=1, max_length=32)
    is_enabled: bool = True
    allow_private_network: bool = False


class ExternalIntegrationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    url: str | None = Field(default=None, min_length=1, max_length=2048)
    event_types: list[str] | None = Field(default=None, min_length=1, max_length=32)
    is_enabled: bool | None = None
    allow_private_network: bool | None = None


class ExternalIntegrationOut(BaseModel):
    id: int
    project_id: int
    kind: str
    name: str
    url: str
    event_types: list[str]
    is_enabled: bool
    allow_private_network: bool
    consecutive_failures: int
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ExternalIntegrationCreatedOut(ExternalIntegrationOut):
    signing_secret: str


class SigningSecretOut(BaseModel):
    signing_secret: str


class ExternalDeliveryOut(BaseModel):
    id: str
    integration_id: int
    integration_name: str
    event_id: str
    event_type: str
    resource_type: str
    resource_id: int | None = None
    status: str
    attempt_count: int
    next_attempt_at: datetime
    last_attempt_at: datetime | None = None
    completed_at: datetime | None = None
    response_status: int | None = None
    error_message: str = ""
    created_at: datetime


class ExternalDeliveryListOut(BaseModel):
    items: list[ExternalDeliveryOut]
    total: int
    page: int
    page_size: int


class QueuedDeliveryOut(BaseModel):
    delivery_id: str
    status: str = "pending"
