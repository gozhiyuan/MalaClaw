# Remote Access — MalaClaw Dashboard

The dashboard binds to `127.0.0.1:3456` by default. That is intentional: the
dashboard can run local workflow commands, so remote access should be explicit.

For any non-local access, start it with an auth token:

```bash
malaclaw dashboard --host 0.0.0.0 --auth-token "$MALACLAW_DASHBOARD_TOKEN"
```

Then use one of these access methods.

## Option 1: Cloudflare Tunnel (recommended)

Zero-config public URL with automatic HTTPS.

```bash
# Install cloudflared (macOS)
brew install cloudflare/cloudflare/cloudflared

# Start the dashboard locally, then start a quick tunnel
malaclaw dashboard --auth-token "$MALACLAW_DASHBOARD_TOKEN"
cloudflared tunnel --url http://127.0.0.1:3456
```

Cloudflare prints a public `*.trycloudflare.com` URL you can open from any device.

## Option 2: Tailscale

Access via your Tailscale network (private, no public exposure):

```bash
malaclaw dashboard --host 0.0.0.0 --auth-token "$MALACLAW_DASHBOARD_TOKEN"

# Then access the dashboard at your Tailscale IP.
http://<tailscale-ip>:3456
```

## Option 3: SSH Tunnel

Forward the port over SSH from a remote machine.

```bash
# From your local machine:
ssh -L 3456:localhost:3456 user@server-with-dashboard

# Then open http://localhost:3456 locally.
```

## Custom Port and Host

```bash
malaclaw dashboard --port 8080 --host 127.0.0.1
malaclaw dashboard --port 8080 --host 0.0.0.0 --auth-token "$MALACLAW_DASHBOARD_TOKEN"
```

Use `--host 127.0.0.1` for localhost-only access. Use `--host 0.0.0.0` only
when you intentionally want other machines to reach the server.
