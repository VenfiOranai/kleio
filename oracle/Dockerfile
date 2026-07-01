FROM python:3.12-slim

WORKDIR /app

# Install dependencies + the app package
COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .

# Alembic config + migrations (used to run `alembic upgrade head` on prod startup)
COPY alembic.ini ./
COPY alembic ./alembic

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
