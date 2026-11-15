FROM python:3.11-slim-bookworm@sha256:a83ba18aef0f865b1a4a611c2cf460fe446f2795673bbb9fe43be570439e3b39 AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLBACKEND=Agg MPLCONFIGDIR=/tmp/matplotlib
WORKDIR /app
COPY requirements-service.txt .
RUN pip install --no-cache-dir -r requirements-service.txt

FROM base AS cpu
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
COPY inference.py service.py adapters.py detail.py ./
COPY model ./model
COPY utils ./utils
RUN useradd --uid 10001 --create-home inference && mkdir weights && chown inference weights
USER inference
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health/ready')"
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--limit-concurrency", "64", "--timeout-keep-alive", "5"]

FROM base AS cuda
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cu124
COPY inference.py service.py adapters.py detail.py ./
COPY model ./model
COPY utils ./utils
RUN useradd --uid 10001 --create-home inference && mkdir weights && chown inference weights
USER inference
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health/ready')"
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--limit-concurrency", "64", "--timeout-keep-alive", "5"]
