#!/usr/bin/env bash
#
# Turn off password logins, leaving key-only access.
#
# Run this ONLY after your key already works, and keep your current SSH window
# open while you test. The script refuses to run if no key is installed, so it
# cannot lock you out on its own -- but do the test anyway.
#
#   bash harden-ssh.sh

set -euo pipefail

KEYS="$HOME/.ssh/authorized_keys"
# Read before 50-cloud-init.conf, which sets PasswordAuthentication yes on many
# provider images. sshd uses the FIRST value it finds, so ordering matters.
CONF=/etc/ssh/sshd_config.d/00-careertech-hardening.conf

if [ ! -s "$KEYS" ]; then
  echo "STOP: no keys in $KEYS"
  echo "Install your public key first, or you will be locked out of this server."
  exit 1
fi

echo "Keys currently allowed to log in as $(id -un):"
cut -d' ' -f3- "$KEYS" | sed 's/^/  - /'
echo

sudo tee "$CONF" >/dev/null <<'SSHD'
# Key-only access. Passwords are guessable from anywhere; keys are not.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSHD

# Reject a broken config rather than reloading it.
if ! sudo sshd -t; then
  sudo rm -f "$CONF"
  echo "SSH config was invalid. Change reverted, nothing applied."
  exit 1
fi

sudo systemctl reload ssh 2>/dev/null || sudo systemctl reload sshd

echo "Applied. Current settings:"
sudo sshd -T | grep -iE "^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin)" | sed 's/^/  /'
echo
echo "Your existing session stays open. Before closing it, open a NEW window"
echo "and confirm you can still log in."
