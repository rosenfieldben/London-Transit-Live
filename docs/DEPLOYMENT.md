# Deployment notes

The private Sites preview runs a standard Worker `fetch(request, env, ctx)` handler.
The Node app remains available through `npm start`; both entry points use
`server/api.mjs` and the same TfL adapters.

## Build

```sh
npm ci
npm test
npm run check
npm run build
npm run test:runtime
```

The pinned esbuild version bundles the Worker and a small explicit list of public
frontend files. Build output is ignored by Git. `.openai/hosting.json` identifies
the existing Site and contains no credentials. Never create a replacement Site
when publishing updates to this project.

## Runtime settings

| Setting | Meaning |
| --- | --- |
| `TFL_APP_KEY` | Optional server-only TfL credential; configure as a hosting secret. |
| `DEMO_MODE` | Only the literal string `true` enables sample data. Default is live. |
| `HOST`, `PORT` | Node hosting only; ignored by the Worker. |

The initial private preview uses anonymous TfL access, which succeeded in the
development checks. A registered key should be added for sustained operation.
No key is embedded in source or compiled assets, and a failed TfL request never
switches to sample data.

## Operating limits

The caches, request budgets and backoff state belong to each Node process or
Worker isolate. Multiple instances have independent state. The current upstream
budget is 60 requests/minute per instance with a burst of 20; the inbound API
budget is 120/minute with a burst of 60. These are application safeguards, not
global guarantees about the provider subscription quota.

The Worker extends active API work with `waitUntil` so completion is retained
when its first requesting browser disconnects. API keys and demo settings are
rechecked before reusing an instance's provider. `/api/health` is a liveness check;
it does not certify TfL availability. Add a coordinated upstream gateway before
opening the app to substantial traffic.

## Updates

Commit the exact reviewed source, run the build, push the source to the Site's
configured source repository, package that same build, and save/deploy the matching
commit. Keep the private audience unless the owner requests sharing or publication.
The GitHub repository is a separate development remote; pushing there alone does
not currently publish the Sites preview. CI validates the source; Sites deploys it.
