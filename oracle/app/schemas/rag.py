from pydantic import BaseModel


class AskRequest(BaseModel):
    question: str


class Citation(BaseModel):
    session_id: int
    title: str
    snippet: str


class AskResponse(BaseModel):
    question: str
    answer: str
    citations: list[Citation]
