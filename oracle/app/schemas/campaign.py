from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CampaignBase(BaseModel):
    name: str
    description: str = ""


class CampaignCreate(CampaignBase):
    pass


class CampaignUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class CampaignRead(CampaignBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
