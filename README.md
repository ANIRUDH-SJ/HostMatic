# HostMatic

HostMatic turns a public GitHub repository into a locally hosted static preview. Enter a repository URL, watch the build logs, and open the generated site. The experience and service flow are inspired by [Piyush Garg's Vercel clone video](https://youtu.be/0A_JpLYG7hM) and its [source repository](https://github.com/piyushgarg-dev/vercel-clone).

## How it works

1. The React frontend sends a repository URL to the API.
2. The API creates a deployment ID and starts a separate build process.
3. The builder clones the public repository, runs `npm ci` (or `npm install` when there is no lockfile), then runs `npm run build`.
4. The builder publishes the static output into `.hostmatic-data/sites/<id>` and records build logs and status.
5. The preview server serves that output at `http://<id>.localhost:8000/`.

The original tutorial uses ECS, Redis, and S3. HostMatic uses local processes and disk storage so the complete flow can be run without cloud credentials. The three services remain separate: `api-server`, `build-server`, and `s3-reverse-proxy` (the latter serves local assets in this version).

## Requirements

- Node.js 20.19+ or 22.12+, npm, and Git
- A public GitHub repository containing a `package.json` with a `build` script
- A static build that creates `dist/index.html` by default

The current builder supports npm projects that output static HTML, CSS, JavaScript, and assets. It does not host server-rendered applications or private repositories. For a monorepo, set **Project directory** to the app folder. If the build creates `build/` or `out/`, set **Output directory** accordingly. A Next.js project must be configured for static export before using `out/`.

## Run locally

```bash
git clone https://github.com/ANIRUDH-SJ/HostMatic.git
cd HostMatic
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), paste a public GitHub repository URL, and select **Deploy**. The frontend runs on port `5173`, the API on `9000`, and the preview server on `8000`. Vite forwards `/api` requests to the API, so the browser needs no separate API configuration in local development.

To run the services separately:

```bash
npm run dev:api
npm run dev:proxy
npm run dev:web
```

Run those commands in three terminals. `npm run build` creates the production frontend in `frontend/dist`. If it is hosted on a different origin, set `VITE_API_BASE_URL` when building and set `FRONTEND_ORIGIN` on the API to allow that origin.

## Configuration

The app works without an `.env` file. See [`.env.example`](./.env.example) for optional values. Environment variables can be set in your shell:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOSTMATIC_HOST` | `127.0.0.1` | Interface for API and preview server |
| `HOSTMATIC_API_PORT` | `9000` | API port |
| `HOSTMATIC_PREVIEW_PORT` | `8000` | Preview server port |
| `HOSTMATIC_PREVIEW_DOMAIN` | `localhost` | Base domain for preview subdomains |
| `HOSTMATIC_DATA_DIR` | `.hostmatic-data` | Deployment records, build workspaces, and published sites |
| `FRONTEND_ORIGIN` | unset | Allowed frontend origin when hosted separately |
| `VITE_API_BASE_URL` | unset | API base URL used by the frontend build |

Preview subdomains use `<deployment-id>.localhost`. Browsers normally resolve `*.localhost` locally. If yours does not, add an entry for the generated hostname to your hosts file or use a local wildcard DNS service and set `HOSTMATIC_PREVIEW_DOMAIN` to match it.

## API

`POST /api/deploy` accepts:

```json
{
  "repoUrl": "https://github.com/owner/repository",
  "rootDirectory": "",
  "outputDirectory": "dist"
}
```

It returns HTTP `202` with the deployment `id`, initial `status`, and preview `url`. Poll `GET /api/status/:id` for status and logs. Status progresses through `queued`, `cloning`, `building`, `publishing`, and `deployed`, or ends as `failed`. `GET /api/health` returns the API health status.

## Verify

```bash
npm run build
npm run lint
npm test
```

The tests cover URL validation and an end-to-end local fixture build through the worker and preview server.

## Security and deployment scope

Repository build scripts execute code. Run this local version only on repositories you trust. Before offering HostMatic as a public service, move builds into isolated, resource-limited containers and add authentication, quotas, and persistent storage. The API and preview server bind to `127.0.0.1` by default.

Earlier HostMatic commits contained hardcoded object-storage credentials. They are removed from the current code. **Rotate or revoke those credentials** because removing them from the latest commit does not remove them from Git history.
