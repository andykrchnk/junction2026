# GPU processing deployment

GitHub Actions sends an archive of the selected commit to this server over SSH.
The forced deployment receiver runs Ansible **locally on the GPU server**. No
self-hosted GitHub runner or GitHub token is installed on the server for deployments.
The processing API stays private at `127.0.0.1:8002`; SSH is the deployment transport.

## Host setup

This playbook targets the already prepared A100 server. Docker Engine with Compose
GPU support, NVIDIA drivers/toolkit, the existing checkpoints and OCR model files,
and server credentials must already exist. It does not download datasets or train
models. The default asset location is `/root/work/junction2026`; that working checkout
is never reset, cleaned or pulled by deployment.

Run once as root from the repository on the server:

```bash
./deploy/processing/bootstrap.sh
```

This installs Python venv support, pinned Ansible Core and the restricted receiver
under `/opt/junction-processing`. Releases are stored by full commit SHA under
`/opt/junction-processing/releases/`. Existing secrets and model assets stay outside
Git. Deployments reuse the model workers' Docker build cache.

Authorize a dedicated SSH public key in `/root/.ssh/authorized_keys` with:

```text
restrict,command="/opt/junction-processing/receive.py" ssh-ed25519 PUBLIC_KEY deployment-key
```

The receiver accepts only `deploy FULL_COMMIT_SHA` and a bounded tar stream containing
`packages/processing/` and `deploy/processing/`. It rejects traversal, symlinks and
unexpected paths. Deployments are serialized with a server-side file lock.
The key can deploy application code as root, so only trusted maintainers may modify
eligible deployment branches. It cannot open an unrestricted shell or forward ports.

## GitHub configuration

Repository secrets:

- `PROCESSING_DEPLOY_SSH_KEY`: dedicated deployment private key.
- `PROCESSING_DEPLOY_KNOWN_HOSTS`: verified SSH host public key entry for this server.

Repository variables:

- `PROCESSING_DEPLOY_HOST`: server hostname or IP.
- `PROCESSING_DEPLOY_USER`: `root` for this prepared host.

The workflow runs on relevant pushes to `master` and `feature/gpu-model-comparison`,
and supports manual dispatch on those branches. Pull requests never deploy.
Host-key verification is mandatory; no runtime `ssh-keyscan` trust or disabled SSH
verification. Workflow concurrency does not cancel an active deployment.
Remove the feature branch trigger after merging if only master should deploy.

## What the playbook does

1. Validates the release SHA, Docker/Compose, GPU access, credentials and checkpoints.
2. Renders a release-specific Compose file without printing secret values.
3. Builds SHA-tagged pipeline, CubiCasa and PaddleOCR images.
4. Runs the pipeline contract tests before touching the live services.
5. Reconciles the four core services in the existing Compose project, preserving
   the comparison-only Raster2Seq and Grounding workers.
6. Checks geometry/OCR/orchestrator and legacy-gateway readiness.
7. Updates `/opt/junction-processing/current` only after success.

On startup/readiness failure, the playbook restores the previous successful release.
On the first deployment, rollback uses the existing working-checkout Compose setup.
Build/test failures leave the live services untouched. There may be brief downtime
while core workers restart and load weights. Readiness is not a new paid Gemini
inference test; run authenticated inference smoke checks when model behavior changes.

To redeploy or roll back to a stored SHA, run on the server:

```bash
sudo /opt/junction-processing/ansible/bin/ansible-playbook \
  -i localhost, -c local \
  /opt/junction-processing/releases/FULL_SHA/deploy/processing/deploy.yml \
  -e release_sha=FULL_SHA \
  -e release_dir=/opt/junction-processing/releases/FULL_SHA
```

Use a real 40-character commit SHA in all three places. Keep old releases and images
until they are no longer required for rollback. Artifact/release retention is currently
operator-managed. If bootstrap/receiver code changes, rerun bootstrap explicitly;
the deployment key cannot silently rewrite its forced-command receiver.

Validate the playbook without deploying:

```bash
/opt/junction-processing/ansible/bin/ansible-playbook \
  -i localhost, -c local deploy/processing/deploy.yml --syntax-check
```
