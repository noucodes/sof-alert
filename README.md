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
            ├──────────────► ntfy topic ◄─────────┤   (history, desktop feed,
            │                     │               │    phone registrations)
            └────► Expo push ◄────┼───────────────┘
                       │          │
                 SOF Alert   Electron desktop app
               Android app   (dashboard, history, own checks,
                               agent heartbeat monitoring)
```

Each machine checks the *other* one, so a whole server going down is still reported.

| Folder | What |
|---|---|
| `agent/` | Log + health watcher for EC2 and the bridge PC (Node, no dependencies) |
| `desktop/` | Electron tray app (repo root `package.json`) |
| `mobile/` | Android app (React Native / Expo, built in the cloud with EAS) |

## 1. Pick a private topic

ntfy topics are public to anyone who knows the name, so use a random one:

```bash
node -e "console.log('sof-alerts-' + require('crypto').randomBytes(9).toString('hex'))"
```

Use the same topic in every config below. (For more privacy, self-host ntfy and set
`ntfy.server` + `ntfy.token`. Log lines can contain order numbers and customer data.)

## 2. Phone app (Android)

The app is built in Expo's cloud (EAS Build), so no Android Studio or SDK is needed
on your PC. One-time setup:

1. **Expo account**: sign up free at https://expo.dev, then from `mobile/`:
   ```bash
   cd mobile
   npm install
   npx eas-cli@latest login
   npx eas-cli@latest init        # links the project, writes the projectId into app config
   ```
2. **Firebase** (Android delivers push through Firebase Cloud Messaging):
   1. https://console.firebase.google.com → **Add project** (Analytics not needed).
   2. **Add app → Android**, package name `com.burdens.sofalert` → download
      `google-services.json` into `mobile/`. This file is safe to commit.
   3. Project settings → **Service accounts** → **Generate new private key**. Keep this
      JSON file **out of git**: it's covered by `.gitignore` if left in `mobile/` with
      its default `*firebase-adminsdk*` name.
   4. Upload that key to Expo: `npx eas-cli@latest credentials` → Android → production →
      Google Service Account → *Manage your FCM V1 service account key* → upload.
3. **Build the APK**:
   ```bash
   npm run build:apk               # = eas build -p android --profile preview
   ```
   When it finishes (~10–15 min), open the link on your phone, download and install the
   APK (allow "install unknown apps" for your browser when asked).
4. Open **SOF Alert → Settings**, enter your topic, save. Allow notifications when asked.
   The phone registers itself with the agents automatically. Then tap **Send test**.

In Android **Settings → Apps → SOF Alert → Notifications** you can tune the three
channels: **Service down** (max importance, allowed to bypass Do Not Disturb),
**Log errors**, and **Recoveries & info**.

Alert priorities: `5` service down · `4` log error · `3` recovered / repeated · `1–2` agent
start/heartbeat (no push).

How it works: when the app opens, it publishes its Expo push token to the
`<topic>-devices` ntfy topic. Each agent follows that topic, saves tokens to
`devices.json` next to its config, and sends alerts to them via Expo's push service.
Tokens Expo reports as uninstalled are dropped. The app syncs full alert history from
ntfy, so tapping a notification opens the complete stack trace.

Previewing UI changes without a phone: `cd mobile && npm run web`.

## 3. Agent on EC2

Zero dependencies; Node 18+.

```bash
# from your PC
scp -r agent ubuntu@EC2_HOST:/home/ubuntu/sof-alert-agent
# on EC2
cd /home/ubuntu/sof-alert-agent
cp config.ec2.example.json config.json   # set ntfy.topic and the bridge tunnel URL
node src/index.js config.json            # quick foreground test, Ctrl+C
node src/index.js config.json --test     # send one test alert to ntfy + registered phones
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
| `push.enabled` | true | Send alerts to registered phones via Expo push |
| `push.minPriority` | 3 | Lowest priority pushed to phones (agent start is 2) |
| `heartbeatMin` | 5 | Heartbeat interval (desktop flags an agent silent after `agentStaleMin`, 12) |

Source types: `file` (`dir`, `pattern`, optional `entryStart` for multi-line entries,
optional `match`) and `journald` (`units`, `match`, optional `entryStart`).
Check types: HTTP (`url`, `expectStatus`, `expectBody`, `headers`) or `"type": "tcp"`
(`host`, `port`).
