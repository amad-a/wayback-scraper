# wayback-scraper

Scrapes archived Palestinian websites from the Wayback Machine and serves them
through a period-appropriate Explorer shell, live at
[palestineonline.net](https://palestineonline.net).

## Running locally

```bash
npm install
npm run serve      # http://localhost:8080
```

The server reads `archive.db` and `sites/`; `npm run db` and `npm run index` rebuild
the database and the static index. See `package.json` for the rest of the pipeline.

## Deployment

Production setup, the deploy command, and a runbook for when the site breaks are in
[DEPLOYMENT.md](DEPLOYMENT.md).

```bash
ssh deploy@167.233.141.19 '~/wayback-scraper/scripts/deploy.sh'
```
