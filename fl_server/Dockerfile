FROM python:3.11-slim

WORKDIR /app

COPY fl_server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY fl_server/api/ ./api/
COPY fl_server/core/ ./core/
COPY fl_server/models/ ./models/
COPY fl_server/main.py ./

RUN mkdir -p /tmp/models

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
