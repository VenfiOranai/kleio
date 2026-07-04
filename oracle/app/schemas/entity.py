from datetime import datetime

from pydantic import BaseModel, ConfigDict

# --- Entity groups ---------------------------------------------------------


class EntityGroupBase(BaseModel):
    name: str
    order_index: int = 0


class EntityGroupCreate(EntityGroupBase):
    pass


class EntityGroupUpdate(BaseModel):
    name: str | None = None
    order_index: int | None = None


class EntityGroupRead(EntityGroupBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    campaign_id: int
    created_at: datetime
    updated_at: datetime


# --- Entities --------------------------------------------------------------


class EntityCreate(BaseModel):
    name: str
    group_id: int | None = None
    description: str | None = None


class EntityUpdate(BaseModel):
    name: str | None = None
    group_id: int | None = None
    description: str | None = None


class EntityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    campaign_id: int
    name: str
    group_id: int | None
    description: str | None
    created_at: datetime
    updated_at: datetime
