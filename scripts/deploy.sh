#!/usr/bin/env bash
# ── Local deploy helper ────────────────────────────────────────────
# Usage: ./scripts/deploy.sh
# Requires: gcloud CLI, Docker, and `gcloud auth application-default login` done
#
# What it does:
#   1. Builds the Docker image locally
#   2. Tags it for GCP Container Registry
#   3. Pushes to GCP Container Registry
#   4. Deploys to Cloud Run (asia-southeast1)
#
# One-time GCP setup (run once):
#   gcloud init
#   gcloud auth configure-docker
#   gcloud services enable run.googleapis.com cloudbuild.googleapis.com containerregistry.googleapis.com

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Please set GCP_PROJECT_ID env var}"
SERVICE_NAME="${SERVICE_NAME:-koppiku-heatmap}"
REGION="${REGION:-asia-southeast1}"
IMAGE="gcr.io/$PROJECT_ID/$SERVICE_NAME"
COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse --short HEAD)}"

echo "━━ Building Docker image ━━"
docker build -t "$IMAGE:$COMMIT_SHA" -t "$IMAGE:latest" -f app/Dockerfile app/

echo "━━ Pushing to Container Registry ━━"
docker push -a "$IMAGE"

echo "━━ Deploying to Cloud Run ━━"
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE:$COMMIT_SHA" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=10 \
  --concurrency=80 \
  --set-env-vars=NODE_ENV=production

echo "━━ Done! ━━"
gcloud run services describe "$SERVICE_NAME" --region="$REGION" --format="value(status.url)"
