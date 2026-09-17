# HostMatic

HostMatic builds a public GitHub repository and gives its static site a preview URL. The dashboard shows build progress and live logs.

## Architecture

| Service | Technology | Role |
| --- | --- | --- |
| Dashboard | Next.js App Router, React, Tailwind CSS | Deployment form, status, preview link, and live logs |
| API | Express, AWS ECS SDK | Validates requests and starts a build worker locally or on ECS Fargate |
| Event stream | Redis, Socket.IO | Stores deployment state and logs, then streams updates to the dashboard |
| Build worker | Node.js, Git, npm, Docker | Clones a repository, installs dependencies, builds, and publishes files |
| Preview | Express, S3 SDK | Serves private S3 objects from a deployment subdomain |

The local setup runs the worker as a separate process and uses Redis plus MinIO, an S3 compatible object store. Set `DEPLOYMENT_DRIVER=ecs` to start the same worker image as an ECS Fargate task.

## Requirements

- Node.js 20.9 or newer, npm, Git, and Docker Compose for local Redis and object storage
- A public GitHub repository with `package.json` and an npm `build` script
- Static output containing `index.html` (default directory: `dist`)

The builder supports static sites. A Next.js site needs static export configured and `out` as the output directory. Server rendered sites and private repositories are outside this release.

## Run locally

```bash
git clone https://github.com/ANIRUDH-SJ/HostMatic.git
cd HostMatic
cp .env.example .env
docker compose up -d
npm ci
npm run dev
```

Open [http://localhost:3002](http://localhost:3002). Paste a public repository URL and select **Deploy project**. The API listens on port `9000`, Socket.IO on `9002`, and the preview server on `8000`. Each site appears at `http://<deployment-id>.localhost:8000/`. MinIO's console is at [http://localhost:9004](http://localhost:9004).

Run services separately with `npm run dev:api`, `npm run dev:proxy`, and `npm run dev:web`. The API and preview server need `.env` loaded; these scripts load it automatically. `npm run dev` starts all three.

## Configuration

Copy [`.env.example`](./.env.example). The local credentials in that file are for the local MinIO container only. Use secret storage for production credentials; the AWS SDK also supports IAM roles without static keys.

| Variable | Purpose |
| --- | --- |
| `REDIS_URL` | Redis connection used by the API, worker, and preview server |
| `S3_BUCKET` | Bucket containing `sites/<deployment-id>/...` objects |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | Set for MinIO or another S3 compatible service; omit for AWS S3 |
| `AWS_REGION` | AWS region |
| `DEPLOYMENT_DRIVER` | `local` or `ecs` |
| `ECS_CLUSTER_ARN`, `ECS_TASK_DEFINITION_ARN` | ECS cluster and task definition for the worker |
| `ECS_SUBNET_IDS`, `ECS_SECURITY_GROUP_IDS` | Comma separated network IDs for Fargate |
| `ECS_CONTAINER_NAME`, `ECS_ASSIGN_PUBLIC_IP` | Worker container name and network choice |
| `FRONTEND_ORIGIN` | Comma separated dashboard origins allowed by the API and Socket.IO |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL` | Browser endpoints, embedded by Next.js at build time |
| `PREVIEW_DOMAIN`, `PREVIEW_PORT`, `PREVIEW_PROTOCOL` | Preview link and hostname settings |

For ECS, build the worker with `docker build -f build-server/Dockerfile -t <image> .`, push it to a registry, and create a Fargate task definition using that image. Give the task access to Redis, the S3 bucket, and GitHub, and pass `REDIS_URL`, `S3_BUCKET`, and region configuration to the container. The API task role needs `ecs:RunTask` and `iam:PassRole` for the worker task role. The worker task role needs `s3:PutObject` on `sites/*`; the preview service needs `s3:GetObject`. Configure ECS networking so workers can reach Redis and the object store.

## API

`POST /project` accepts:

```json
{
  "repoUrl": "https://github.com/owner/repository",
  "rootDirectory": ".",
  "outputDirectory": "dist"
}
```

It returns HTTP `202` with an ID, status, and preview URL. `GET /project/:id` returns current status and logs. `GET /health` checks Redis. Status moves through `queued`, `cloning`, `building`, `publishing`, and `deployed`, or ends at `failed`. The dashboard subscribes to deployment events with Socket.IO and also polls the status endpoint if the event connection drops.

## Verify

```bash
npm run build
npm run lint
npm test
```

To verify a full deployment, keep Docker Compose running and deploy a small public Vite project through the dashboard. The worker must log a successful build, then the preview URL must serve its `index.html` and assets.

## Operations and security

Repository build scripts execute arbitrary code. Production builds should run in isolated ECS tasks with CPU, memory, network, and time limits. Before accepting untrusted public traffic, add authentication, rate limits, and task quotas. The local services bind to loopback by default.

If credentials were ever committed to an earlier revision, rotate or revoke them. Rewriting a branch does not revoke exposed credentials or remove separately retained pull request refs.
