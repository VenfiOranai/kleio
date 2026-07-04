# Kleio — Deployment (AWS EC2)

Single-box deployment: **nginx (herald) → FastAPI (oracle) → Postgres**, all via
`infra/docker-compose.prod.yml`. Images are **built on the EC2 box**; GitHub Actions triggers
deploys over SSH. Currently **HTTP only** (add TLS once you have a domain — see the end).

## 1. Launch the EC2 instance

- **AMI:** Ubuntu Server 24.04 LTS
- **Instance type:** `t3.small` (2 GB RAM). `t2.micro` (1 GB) can OOM while building the
  Angular image — if you must use it, add swap (see below).
- **Key pair:** create one and download the `.pem` — this doubles as the CI deploy key.
- **Storage:** 20 GB gp3.
- **Security group (inbound):**
  | Type | Port | Source |
  |------|------|--------|
  | SSH | 22 | **Your IP only** |
  | HTTP | 80 | Anywhere (`0.0.0.0/0`) |

  Do **not** open 5432 (Postgres) or 8000 (oracle) — they stay internal to the Docker network.

Optional swap (only for small instances):
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Install Docker

```bash
ssh -i kleio.pem ubuntu@<PUBLIC_IP>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit   # re-login so the docker group applies
```

## 3. Clone the repo (read-only deploy key)

On the box, create a deploy key and add its public half to GitHub
(repo → Settings → Deploy keys → Add, read-only):
```bash
ssh-keygen -t ed25519 -f ~/.ssh/kleio_deploy -N ""
cat ~/.ssh/kleio_deploy.pub   # paste into GitHub Deploy keys
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/kleio_deploy
EOF
git clone git@github.com:<you>/kleio.git ~/kleio
```

## 4. Configure secrets on the box

```bash
cd ~/kleio
cp infra/.env.example infra/.env
```
Fill in `infra/.env`: a strong `POSTGRES_PASSWORD`, your `APP_USERNAME`, a `JWT_SECRET`
(`openssl rand -hex 32`), and `APP_PASSWORD_HASH`. Generate the hash on your **dev machine**
(the box has no venv) and paste it:
```bash
# dev machine, from oracle/
./.venv/Scripts/python scripts/hash_password.py
```
Wrap the hash in single quotes in `.env` (it contains `$`).

For the AI features (session summarization + RAG Q&A), also set `GEMINI_API_KEY` (a Google AI
Studio key). It's optional — without it those endpoints just return 503 and the rest of the app
works normally. `GEMINI_MODEL` / `GEMINI_EMBED_MODEL` have sensible defaults; override only if
needed.

## 5. First deploy (manual)

```bash
cd ~/kleio
docker compose -f infra/docker-compose.prod.yml up -d --build
```
Migrations run automatically on the oracle container's startup. Visit `http://<PUBLIC_IP>`
and log in. Useful checks:
```bash
docker compose -f infra/docker-compose.prod.yml ps
docker compose -f infra/docker-compose.prod.yml logs -f oracle
```

## 6. Automated deploys (GitHub Actions)

`.github/workflows/deploy.yml` runs on every push to `master` (merge a CI-green PR) and SSHes
in to `git pull` + rebuild. Add these repo secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|--------|-------|
| `EC2_HOST` | instance public IP (or DNS) |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | full contents of your `kleio.pem` private key |

After that: **merge to `master` → it deploys.** Trigger manually anytime from the Actions tab
(Deploy → Run workflow).

## 7. Operations

- **Logs:** `docker compose -f infra/docker-compose.prod.yml logs -f`
- **Restart:** `docker compose -f infra/docker-compose.prod.yml restart oracle`
- **DB backup:** `docker compose -f infra/docker-compose.prod.yml exec db pg_dump -U kleio kleio > backup.sql`
- **Data** lives in the `pgdata` Docker volume and survives rebuilds/redeploys.

## 8. Adding HTTPS later (when you have a domain)

Point an A record at the EC2 IP, then either add [Caddy](https://caddyserver.com/) in front
(automatic Let's Encrypt) or terminate TLS in a dedicated nginx with certbot, and open 443 in
the security group. The app already uses relative `/api` URLs, so no code changes are needed.
