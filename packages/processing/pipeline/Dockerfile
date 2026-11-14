FROM python:3.10-slim-bookworm@sha256:5be5aaecb962a41567bc8041f1e9e3432cb085b037fe057f9a562630b2e4b370
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY pipeline/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY pipeline/ .
COPY cubicasa/model/segmentation_net.py /app/source_taxonomy.py
CMD ["uvicorn", "service:application", "--host", "0.0.0.0", "--port", "8002", "--workers", "1"]
