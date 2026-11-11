# Lumpad
Sub-4 coach app. React + Vite frontend, small Node API (`server/`).

Dev: `npm i && npm run server` and `npm run dev`. Tests: `npm test`.

## Deploy (VPS, Ubuntu)
    ssh root@<server>
    git clone <private-repo-url> /opt/lumpad      # use a read-only deploy key or token
    bash /opt/lumpad/deploy/setup.sh 43-173-30-236.nip.io rihan
Update later: `bash /opt/lumpad/deploy/deploy.sh`
Secrets live only in `/opt/lumpad/.env` (never in git).
