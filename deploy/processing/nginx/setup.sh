#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Run as root on the GPU server.' >&2; exit 1; }
mode="${1:-}"
[[ -z "$mode" || "$mode" == '--bootstrap-only' ]] || { echo 'Usage: setup.sh [--bootstrap-only]' >&2; exit 1; }
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
domain=inference.junction2026.kavostudio.dev
site="/etc/nginx/sites-available/$domain"
command -v nginx >/dev/null
command -v certbot >/dev/null
install -d -m 755 /var/www/letsencrypt/.well-known/acme-challenge
if [[ ! -f "/etc/letsencrypt/live/$domain/fullchain.pem" ]]; then
    install -m 644 "$source_dir/http.conf" "$site"
else
    install -m 644 "$source_dir/https.conf" "$site"
fi
ln -sfn "$site" "/etc/nginx/sites-enabled/$domain"
nginx -t
systemctl enable --now nginx
systemctl reload nginx
[[ "$mode" != '--bootstrap-only' ]] || exit 0
# An email is optional. Set CERTBOT_EMAIL to receive account notifications.
account_args=(--register-unsafely-without-email)
if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
    account_args=(--email "$CERTBOT_EMAIL")
fi
certbot certonly --webroot --webroot-path /var/www/letsencrypt \
    --domain "$domain" --cert-name "$domain" --non-interactive --agree-tos \
    "${account_args[@]}"
install -m 644 "$source_dir/https.conf" "$site"
nginx -t
systemctl reload nginx
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
install -m 755 "$source_dir/reload-nginx.sh" /etc/letsencrypt/renewal-hooks/deploy/inference-nginx
systemctl enable --now certbot.timer
