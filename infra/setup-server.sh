#!/usr/bin/env bash
#
# One-time setup for a fresh Ubuntu server.
#
# Run it once, as your normal login (NOT as root), on the new box:
#
#   git clone https://github.com/Ceebl/Careertech.git /tmp/ct
#   bash /tmp/ct/infra/setup-server.sh
#
# It installs everything the deploy needs, sets up the firewall, and gets an
# HTTPS certificate if the domain already points here. Safe to run twice.

set -euo pipefail

DOMAIN=${DOMAIN:-emaitch.co.uk}
WEB_ROOT=/var/www/html
DATA_DIR=/srv/careertech/data
SNIPPET=/etc/nginx/snippets/careertech-api.conf
SITE=/etc/nginx/sites-available/careertech
DEPLOY_KEY="$HOME/.ssh/careertech_deploy"

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as your normal user, not as root. It uses sudo where needed."
  exit 1
fi

ME=$(id -un)
say() { printf '\n=== %s\n' "$1"; }

# ---------------------------------------------------------------------------
say "Installing packages"
# ---------------------------------------------------------------------------
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  nginx docker.io git rsync curl ufw certbot python3-certbot-nginx

sudo systemctl enable --now docker
sudo systemctl enable --now nginx

# ---------------------------------------------------------------------------
say "Letting $ME use sudo without a password"
# ---------------------------------------------------------------------------
# The deploy robot logs in without a terminal, so it can never answer a
# password prompt. Written to a validated drop-in file, never to /etc/sudoers.
SUDOERS=/etc/sudoers.d/90-careertech-$ME
echo "$ME ALL=(ALL) NOPASSWD:ALL" | sudo tee "$SUDOERS" >/dev/null
sudo chmod 440 "$SUDOERS"
if ! sudo visudo -c -q; then
  sudo rm -f "$SUDOERS"
  echo "sudo config was rejected and has been removed. Nothing changed."
  exit 1
fi

# ---------------------------------------------------------------------------
say "Creating folders"
# ---------------------------------------------------------------------------
sudo mkdir -p "$WEB_ROOT" "$DATA_DIR" /etc/nginx/snippets
# The app container runs as an unprivileged user with id 1000.
sudo chown -R 1000:1000 "$DATA_DIR"

# Placeholder so nginx can include it before the first deploy fills it in.
if [ ! -f "$SNIPPET" ]; then
  echo "# Filled in by the deploy. Routes /api/ to the app container." \
    | sudo tee "$SNIPPET" >/dev/null
fi

# ---------------------------------------------------------------------------
say "Configuring nginx for $DOMAIN"
# ---------------------------------------------------------------------------
# Written explicitly rather than relying on Ubuntu's default, so the folder
# nginx serves from is known rather than assumed.
sudo tee "$SITE" >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;

    root $WEB_ROOT;
    index index.html index.htm;

    include $SNIPPET;

    location / {
        try_files \$uri \$uri/ =404;
    }
}
NGINX

sudo ln -sf "$SITE" /etc/nginx/sites-enabled/careertech
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl reload nginx

# ---------------------------------------------------------------------------
say "Setting up the firewall"
# ---------------------------------------------------------------------------
# SSH is allowed BEFORE enabling, otherwise this would lock you out.
sudo ufw allow OpenSSH >/dev/null
sudo ufw allow 80/tcp >/dev/null
sudo ufw allow 443/tcp >/dev/null
sudo ufw --force enable >/dev/null
sudo ufw status | head -20

# ---------------------------------------------------------------------------
say "Preparing the deploy key"
# ---------------------------------------------------------------------------
# A key pair just for the robot: it can log in, and nothing else uses it.
if [ ! -f "$DEPLOY_KEY" ]; then
  ssh-keygen -t ed25519 -f "$DEPLOY_KEY" -N "" -C "careertech-deploy" >/dev/null
  echo "created $DEPLOY_KEY"
else
  echo "reusing existing $DEPLOY_KEY"
fi

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
if ! grep -qF "$(cat "$DEPLOY_KEY.pub")" "$HOME/.ssh/authorized_keys"; then
  cat "$DEPLOY_KEY.pub" >> "$HOME/.ssh/authorized_keys"
  echo "allowed the deploy key to log in"
fi

# ---------------------------------------------------------------------------
say "Checking whether $DOMAIN points here yet"
# ---------------------------------------------------------------------------
MY_IP=$(curl -fsS --max-time 10 https://api.ipify.org || echo "")
DOMAIN_IP=$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || echo "")

echo "this server : ${MY_IP:-unknown}"
echo "$DOMAIN : ${DOMAIN_IP:-not resolving}"

if [ -n "$MY_IP" ] && [ "$MY_IP" = "$DOMAIN_IP" ]; then
  say "Getting an HTTPS certificate"
  sudo certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email --redirect
  sudo nginx -t && sudo systemctl reload nginx
  CERT_DONE=yes
else
  CERT_DONE=no
fi

# ---------------------------------------------------------------------------
say "Done. What happens next"
# ---------------------------------------------------------------------------
cat <<NEXT

1. In GitHub, go to the Careertech repo:
   Settings -> Secrets and variables -> Actions
   and set these three:

     DEPLOY_HOST   ${MY_IP:-<this server's IP address>}
     DEPLOY_USER   $ME
     DEPLOY_KEY    the contents of the private key file

   To see the private key, run:

     cat $DEPLOY_KEY

   Copy the WHOLE thing, including the BEGIN and END lines.
   Do not paste it into a chat, an email, or the repo itself.

NEXT

if [ "$CERT_DONE" = "no" ]; then
cat <<NEXT
2. $DOMAIN is not pointing at this server yet.

   Update the DNS A record to ${MY_IP:-this server's IP}, wait for it to take
   effect, then run:

     sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect

   HTTPS must be working BEFORE the first deploy, or it will stop with an
   error saying it cannot find the secure settings for $DOMAIN.

3. Push to master and everything else rebuilds itself.

NEXT
else
cat <<NEXT
2. HTTPS is working. Push to master and everything else rebuilds itself.

NEXT
fi
