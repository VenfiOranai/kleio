from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class SessionBase(BaseModel):
    title: str
    session_date: date | None = None
    order_index: int = 0
    raw_notes: str = ""
    summary: str | None = None


class SessionCreate(SessionBase):
    pass


class SessionUpdate(BaseModel):
    title: str | None = None
    session_date: date | None = None
    order_index: int | None = None
    raw_notes: str | None = None
    summary: str | None = None


class SessionRead(SessionBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    campaign_id: int
    created_at: datetime
    updated_at: datetime
