# Public inference HTTPS endpoint

Nginx terminates HTTPS at `inference.junction2026.kavostudio.dev` and forwards
`/v1/process`, `/v1/schema`, and the compatibility `/v1/predictions` endpoint to
`127.0.0.1:8002`. API-key authentication remains in the processing service.
Docker ports and worker services remain private. No dashboard, artifacts, or
API documentation routes are published. The consumer backend must keep the API
key private; this endpoint is not intended for direct browser calls.

## One-time server setup

Create a DNS-only A record for `inference.junction2026.kavostudio.dev` pointing to
`135.181.63.216`. Public TCP ports 80 and 443 must reach this server. Do not add an
AAAA record unless IPv6 routing is also configured.

Run as root from the repository root:

```bash
apt-get update
apt-get install -y nginx certbot
./deploy/processing/nginx/setup.sh --bootstrap-only
# Once DNS resolves to this server:
./deploy/processing/nginx/setup.sh
certbot renew --dry-run
```

The bootstrap serves only ACME challenges; the inference API is never exposed
without TLS. Certbot uses HTTP-01 webroot validation and automatically renews
through `certbot.timer`. A successful renewal validates and reloads Nginx.
Optionally set `CERTBOT_EMAIL` when running setup; otherwise registration omits
email. Certificates and account keys stay in `/etc/letsencrypt`, outside Git.

After issuance, HTTP redirects to HTTPS. Uploads allow 26 MiB including multipart
overhead; application limits still apply. Proxy timeouts allow the pipeline's
180-second deadline. Nginx does not retry inference POST requests. Access logs
exclude query strings, body data and authentication headers.

This is host provisioning, separate from application releases. Docker deployment
continues to replace the upstream service without replacing Nginx. Rerun setup
when changing these checked-in host configurations. Existing unrelated Nginx
sites are left intact.
