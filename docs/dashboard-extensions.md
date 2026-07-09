# Dashboard Extension Contract

The MalaClaw dashboard is product-independent: it owns the host server,
generic workflow UI (flow debugger, approvals, usage), and the extension
loader. Product layers such as LongWrite own their pages, routes, and
domain panels, and plug in as extensions.

**Extensions are trusted local code.** They are imported into the dashboard
server process with full filesystem access. Only configure extensions you
would run as a script. There is no sandboxing and no remote loading.

## Configuring server extensions

Two sources, merged (env first, duplicates dropped):

```bash
# 1. Environment variable (comma-separated module specs)
export MALACLAW_DASHBOARD_SERVER_EXTENSIONS=/path/to/ext/dist/server/index.js
```

```yaml
# 2. ~/.malaclaw/dashboard.yaml   (MALACLAW_DIR override respected)
dashboard:
  server_extensions:
    - /path/to/longwrite-agent/dashboard-extension/dist/server/index.js
```

Inspect and debug the configuration:

```bash
malaclaw dashboard-extensions list     # what is configured, and from where
malaclaw dashboard-extensions doctor   # try loading each; report problems
```

`doctor` checks: the file exists (path specs), the module imports, it exports
`createDashboardServerExtension(host)` (or a default), the factory runs, and
the result has a string `id` and a `routes(app)` function. Failures exit
non-zero with per-extension findings.

## Server extension shape

```ts
// dist/server/index.js
export function createDashboardServerExtension(host) {
  return {
    id: "longwrite",
    routes: async (app) => {
      app.get("/api/longwrite/...", async (req, reply) => { /* ... */ });
    },
  };
}
```

The `host` object passes explicit capabilities from the dashboard — flow
state loading, log paths, approvals, usage summaries. Extensions should use
the host APIs rather than importing MalaClaw internals, so the contract
stays stable across MalaClaw versions.

## Client extensions

The client side is currently bundled at build time from a sibling checkout.
A packaged client-extension story (prebuilt bundle copied into the dashboard
build) is planned; full dynamic remote module loading is explicitly out of
scope for alpha.
