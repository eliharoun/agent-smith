# Lock Policy

The `LockManager` enforces these conflict rules:

| Acquirer key | Conflicts with held keys |
|---|---|
| any literal `k` | same literal `k` |
| `all-agents` | any `agent:*` |
| `agent:foo` (or any `agent:*`) | `all-agents` |

The only job that takes `all-agents` is `jack-out`. The only jobs that take
`agent:*` are per-agent operations (`agent.install`, `agent.uninstall`,
`agent.destroy`, `agent.reconfigure`).

This means: while `jack-out` runs, no per-agent operation may start.
Conversely, if any per-agent operation is mid-flight, `jack-out` will
return HTTP 409 (with the running job's id in the error envelope).

## Batched acquisition is atomic

`tryAcquireMany([k1, k2, k3], jobId)` either acquires *all* keys or *none*.
If any single key would conflict (literal collision or wildcard violation),
the entire batch is rejected before any `Map.set` happens — there is no
window in which the manager holds a partial subset of the requested keys.

## Other lock keys

- `workspace` — held by `update`, `knowledge.migrate-codex`, and `jack-out`.
  Prevents concurrent git/state mutations against the smith repo + caches.
- `daemon` — held by `daemon.start`, `daemon.stop`, and `jack-out`. The
  daemon itself does not acquire this lock; only the GUI commands that
  manage its lifecycle do.

Doctor (`smith doctor`) acquires no locks and may run concurrently with
anything else.
