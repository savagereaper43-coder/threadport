FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    U2NET_HOME=/models \
    OMP_NUM_THREADS=2

WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN --mount=type=secret,id=registry_ca apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && if [ -f /run/secrets/registry_ca ]; then export PIP_CERT=/run/secrets/registry_ca; fi \
    && pip install --no-cache-dir -r /app/backend/requirements.txt \
    && useradd --uid 10001 --create-home threadport \
    && install -d -o threadport -g threadport /models

COPY --chown=threadport:threadport backend /app/backend
COPY --chown=threadport:threadport autobash_core/autobash.py /app/autobash_core/autobash.py
COPY --chown=threadport:threadport shared /app/shared
COPY --chown=threadport:threadport frontend/public/shading /app/frontend/public/shading

USER threadport
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
