# SOF Alert

Alerts on your phone (and desktop) for every error in the sof-* logs and whenever
an EC2 service or sof-bridge goes down.

```
 EC2                                   Bridge PC (Windows)
 ┌──────────────────────────┐          ┌──────────────────────────────┐
 │ sof-main  ─ error-*.log  │          │ sof-bridge ─ bridge-error-*  │
 │ sof-api   ─ journald     │          │                              │
 │       ▲                  │          │        ▲                     │
 │  agent (watches logs,    │          │  agent (watches logs,        │
 │  checks bridge tunnel)   │          │  checks EC2 + bridge + ERP)  │
 └──────────┬───────────────┘          └──────────┬───────────────────┘
            └──────────────► ntfy topic ◄─────────┘
                                │
              ┌─────────────────┴───────────────┐
         ntfy Android app                Electron desktop app
       (push notifications)        (dashboard, history, own checks,
                                      agent heartbeat monitoring)
```

Each machine checks the *other* one, so a whole server going down is still reported.

## 1. Pick a private topic

ntfy topics are public to anyone who knows the name, so use a random one:

```bash
node -e "console.log('sof-alerts-' + require('crypto').randomBytes(9).toString('hex'))"
```

Use the same topic in every config below. (For more privacy, self-host ntfy and set
`ntfy.server` + `ntfy.token`. Log lines can contain order numbers and customer data.)

## 2. Phone (Android)

1. Install **ntfy** from the Play Store (or F-Droid).
2. **+** → subscribe to your topic (server `ntfy.sh` unless self-hosting).
3. In ntfy settings, allow it to ignore battery optimisation so alerts arrive instantly.
4. Optional: long-press the subscription → set **priority 5 (DOWN alerts)** to bypass Do Not Disturb.

Alert priorities: `5` service down · `4` log error · `3` recovered / repeated · `1–2` agent start/heartbeat.

## 3. Agent on EC2

Zero dependencies; Node 18+.

```bash
# from your PC
scp -r agent ubuntu@EC2_HOST:/home/ubuntu/sof-alert-agent
# on EC2
cd /home/ubuntu/sof-alert-agent
cp config.ec2.example.json config.json   # set ntfy.topic and the bridge tunnel URL
node src/index.js config.json            # quick foreground test, Ctrl+C
sudo ./deploy/install-linux.sh           # install as systemd service
sudo journalctl -u sof-alert-agent -f
```

What it watches by default:
- `sof-main`: `/home/ubuntu/sof-main/logs/{error,exceptions,rejections}-*.log` (winston)
- `sof-api`: journald unit `sof-api`. Nest `ERROR` lines plus crashes and restarts
- `sof-main` crashes: journald unit `sof-main`
- `sof-bridge` reachability through the Cloudflare tunnel

## 4. Agent on the bridge PC (Windows)

```powershell
copy agent\config.bridge.example.json agent\config.json   # set topic + EC2 URLs
node agent\src\index.js agent\config.json                 # quick test
# elevated PowerShell:
powershell -ExecutionPolicy Bypass -File agent\deploy\install-windows.ps1
```

Check `sources[0].dir` points at the bridge's winston log folder. sof-bridge writes to
`<parent of sof-bridge>\logs` (e.g. `C:\burdens\logs`).

Checks: bridge on `localhost:3001`, Frameworks ERP TCP `192.168.5.138:9200`, and the
EC2 `/health` endpoints.

## 5. Desktop app

```bash
npm install
npm start          # dev
npm run dist       # Windows installer in dist/
```

On first run it creates `%APPDATA%\sof-alert\config.json` (in the packaged app,
`%APPDATA%\SOF Alert\config.json`). Set `ntfy.topic` and the `checks` URLs there.
The app reloads it automatically when you save. **Config** opens it.

- Lives in the tray; the dot is green (OK), amber (unread alerts), red (service down
  or an agent stopped sending heartbeats), or grey (not connected or not configured).
- **Send test** publishes a test alert. It should appear on your phone and in the app.
- Tray menu → **Start at login**.

## Tuning (agent `config.json`)

| Key | Default | Meaning |
|---|---|---|
| `alerts.dedupeWindowSec` | 300 | Same error (ids/numbers ignored) is sent once per window; repeats are summarised |
| `alerts.maxPerMinute` | 6 | Max distinct errors per source per minute; extras are listed in one summary |
| `checkOptions.intervalSec` | 60 | Health check interval |
| `checkOptions.failThreshold` | 2 | Consecutive failures before "DOWN" |
| `checkOptions.remindEveryMin` | 30 | Re-alert while still down |
| `heartbeatMin` | 5 | Heartbeat interval (desktop flags an agent silent after `agentStaleMin`, 12) |

Source types: `file` (`dir`, `pattern`, optional `entryStart` for multi-line entries,
optional `match`) and `journald` (`units`, `match`, optional `entryStart`).
Check types: HTTP (`url`, `expectStatus`, `expectBody`, `headers`) or `"type": "tcp"`
(`host`, `port`).
