#!/usr/bin/env bash
# Installs the agent as a systemd service on EC2.
# Run from the agent directory after copying it to /home/ubuntu/sof-alert-agent:
#   sudo ./deploy/install-linux.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$DIR" != "/home/ubuntu/sof-alert-agent" ]; then
  echo "Expected agent at /home/ubuntu/sof-alert-agent (found $DIR)."
  echo "Move it there or edit deploy/sof-alert-agent.service paths first."
  exit 1
fi

if [ ! -f "$DIR/config.json" ]; then
  echo "Missing $DIR/config.json — copy config.ec2.example.json and fill it in."
  exit 1
fi

cp "$DIR/deploy/sof-alert-agent.service" /etc/systemd/system/sof-alert-agent.service
systemctl daemon-reload
systemctl enable sof-alert-agent
systemctl restart sof-alert-agent
sleep 2
systemctl --no-pager status sof-alert-agent || true
echo
echo "Logs: sudo journalctl -u sof-alert-agent -f"
