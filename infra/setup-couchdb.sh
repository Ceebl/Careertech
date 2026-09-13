#!/usr/bin/env bash
#
# One-time setup for the Obsidian sync database at couch.emaitch.co.uk.
#
# Run it once, as your normal login (NOT as root), on the server:
#
#   bash /path/to/Careertech/infra/setup-couchdb.sh
#
# It creates the nginx site for the subdomain and gets it an HTTPS certificate.
# It does NOT start the database -- the deploy does that on the next push.
# Safe to run twice.
#
# Why this is separate from the deploy: certbot rewrites the site file it is
# given, adding the certificate lines. If the deploy overwrote that file on
# every push, HTTPS would break every time you pushed. So the deploy only ever
# replaces the snippet the site file includes, and this script owns the file.

set -euo pipefail

DOMAIN=${DOMAIN:-couch.emaitch.co.uk}
SNIPPET=/etc/nginx/snippets/careertech-couchdb.conf
SITE=/etc/nginx/sites-available/careertech-couch

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as your normal user, not as root. It uses sudo where needed."
  exit 1
fi

say() { printf '\n=== %s\n' "$1"; }

# ---------------------------------------------------------------------------
say "Checking whether $DOMAIN points at this server"
# ---------------------------------------------------------------------------
MY_IP=$(curl -fsS --max-time 10 https://api.ipify.org || echo "")
DOMAIN_IP=$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || echo "")

echo "this server : ${MY_IP:-unknown}"
echo "$DOMAIN : ${DOMAIN_IP:-not resolving}"

if [ -z "$DOMAIN_IP" ] || [ "$MY_IP" != "$DOMAIN_IP" ]; then
  cat <<MSG

$DOMAIN does not point here yet.

Add this DNS record at whoever manages emaitch.co.uk, then run this script
again once it has taken effect (usually minutes, occasionally an hour):

    Type   A
    Name   couch
    Value  ${MY_IP:-this server's IP address}

MSG
  exit 1
fi

# ---------------------------------------------------------------------------
say "Creating the nginx site"
# ---------------------------------------------------------------------------
sudo mkdir -p /etc/nginx/snippets

# Placeholder so nginx can include it before the first deploy fills it in.
# Without this, `nginx -t` fails on a missing include and certbot refuses.
if [ ! -f "$SNIPPET" ]; then
  echo "# Filled in by the deploy. Routes / to the CouchDB container." \
    | sudo tee "$SNIPPET" >/dev/null
fi

# No `root` and no `try_files` here on purpose: every path on this hostname
# belongs to CouchDB, served through the snippet's location block.
sudo tee "$SITE" >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    include $SNIPPET;
}
NGINX

sudo ln -sf "$SITE" /etc/nginx/sites-enabled/careertech-couch
sudo nginx -t
sudo systemctl reload nginx

# ---------------------------------------------------------------------------
say "Getting an HTTPS certificate"
# ---------------------------------------------------------------------------
# Obsidian on a phone refuses to sync over plain http, so this is required and
# not a nicety. certbot rewrites $SITE in place to add the certificate.
sudo certbot --nginx -d "$DOMAIN" \
  --non-interactive --agree-tos --register-unsafely-without-email --redirect

sudo nginx -t && sudo systemctl reload nginx

# ---------------------------------------------------------------------------
say "Done. What happens next"
# ---------------------------------------------------------------------------
SUGGESTED=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)

cat <<NEXT

HTTPS is working for $DOMAIN.

1. In GitHub, go to the Careertech repo:
     Settings -> Secrets and variables -> Actions
   and add these two:

     COUCHDB_USER       obsidian
     COUCHDB_PASSWORD   $SUGGESTED

   That password was generated fresh just now. Use it or pick your own, but
   save it in your password manager first -- you will need to type it into
   Obsidian on every device, and nothing else will show it to you again.

2. Push to master. The deploy builds the database container and starts it.

3. In Obsidian, install the "Self-hosted LiveSync" community plugin and point
   it at:

     URI        https://$DOMAIN
     Username   obsidian
     Password   the one above
     Database   obsidian

NEXT
