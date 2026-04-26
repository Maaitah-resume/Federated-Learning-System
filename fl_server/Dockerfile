FROM python:3.11-slim

WORKDIR /app

# Install PyTorch CPU-only first (from PyTorch index)
RUN pip install --no-cache-dir torch==2.1.0 --index-url https://download.pytorch.org/whl/cpu

# Install other packages (from PyPI)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ ./api/
COPY core/ ./core/
COPY models/ ./models/
COPY main.py ./

RUN mkdir -p /tmp/models

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
