FROM node:24-bookworm-slim AS ui
WORKDIR /src
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
FROM python:3.12-slim
WORKDIR /app
COPY service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd -r -u 10001 -m farol && mkdir /data && chown farol /data
COPY service/ ./service/
COPY --from=ui /src/dist/ ./web/dist/
WORKDIR /app/service
ENV FAROL_DB=/data/farol.db FAROL_INDEX_DB=/data/index.db PYTHONDONTWRITEBYTECODE=1
USER farol
EXPOSE 8083
ENTRYPOINT ["uvicorn","app:app","--host","0.0.0.0","--port","8083"]
