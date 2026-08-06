# Deployment

How `palestineonline.net` is served, and what to do when it breaks.

## What runs where

```
browser
   |
   v  :443 TLS (Let's Encrypt)
nginx ................. /etc/nginx/sites-available/archive
   |                    (symlinked from sites-enabled/)
   v  proxy_pass 127.0.0.1:8080
node src/serve.js ..... PM2 process "wayback"
   |
   +-- public/         the Explorer shell
   +-- sites/          ~6000 archived pages
   +-- archive.db      SQLite, opened read-only
```

| | |
|---|---|
| Host | `ssh deploy@167.233.141.19` (Hetzner, Ubuntu 26.04, 4GB) |
| Checkout | `/home/deploy/wayback-scraper`, tracking `origin/main` |
| Process manager | PM2, process name `wayback`, running `npm run serve` |
| App port | `127.0.0.1:8080` (`PORT` / `HOST` env override) |
| Boot survival | `pm2-deploy.service` (enabled) + `pm2 save` |
| TLS | Let's Encrypt, apex + www, auto-renewed by `certbot.timer` |
| Monitoring | `.github/workflows/uptime.yml`, every 5 min from GitHub |

The app binds loopback, so nginx is the only way in. `HOST=0.0.0.0` opens it to the
network when you need another device on it — checking the mobile layout on a phone,
say.

There is a second PM2 process, `archive` — an unrelated SvelteKit app on `:3000`,
left from a previous site. Nothing proxies to it. `pm2 delete archive && pm2 save`
removes it.

## Access

SSH is key-only: `PasswordAuthentication no`, `PermitRootLogin prohibit-password`,
set in `/etc/ssh/sshd_config.d/10-hardening.conf`.

The `10-` prefix is load-bearing. sshd takes the **first** value it sees for a
keyword and reads `sshd_config.d/*.conf` in lexical order, so a drop-in named `99-*`
would lose to cloud-init's `50-cloud-init.conf`, which sets
`PasswordAuthentication yes`. Anything overriding cloud-init must sort before it.

After changing sshd, check the effective config rather than trusting the file:

```bash
sudo sshd -t                                        # syntax, before restarting
sudo sshd -T | grep -E 'passwordauthentication|permitrootlogin'
```

Keep an existing session open across an sshd restart and confirm a fresh login works
before closing it. Hetzner's web console is the way back in otherwise.

## sudo requires a real terminal

The `deploy` user has **no passwordless sudo**, and sudo needs a TTY. Any root change
has to come from an actual terminal — not a non-interactive `ssh` command, not an
agent. Stage the file unprivileged, then install it in one interactive command:

```bash
# stage (no sudo)
scp newconfig deploy@167.233.141.19:~/archive.nginx.new

# install (interactive terminal, prompts for password)
ssh -t deploy@167.233.141.19 'sudo cp /etc/nginx/sites-available/archive /etc/nginx/sites-available/archive.bak.$(date +%F-%H%M) \
  && sudo cp ~/archive.nginx.new /etc/nginx/sites-available/archive \
  && sudo nginx -t && sudo systemctl reload nginx && echo RELOADED'
```

Back up first, and gate the reload behind `nginx -t`: if the config is bad, nginx
refuses to reload and the running site is untouched.

## Deploying

```bash
ssh deploy@167.233.141.19 '~/wayback-scraper/scripts/deploy.sh'
```

Pulls `main`, reinstalls only if `package-lock.json` moved, restarts PM2, then
health-checks the result. No sudo needed.

Use `npm ci`, never `npm install`, on the server. `install` rewrites
`package-lock.json`, which leaves the git tree dirty and makes the *next* `git pull`
fail with "local changes would be overwritten." If that already happened:

```bash
ssh deploy@167.233.141.19 'cd ~/wayback-scraper && git checkout package-lock.json'
```

## Everyday commands

```bash
pm2 list                          # what's running
pm2 logs wayback --lines 50       # app output
pm2 restart wayback --update-env  # restart, picking up env changes
pm2 save                          # persist process list for reboot

sudo nginx -t                     # validate config; ALWAYS before reload
sudo systemctl reload nginx       # apply config, no dropped connections
sudo journalctl -u nginx -n 50    # nginx service log
sudo tail -50 /var/log/nginx/error.log
```

## TLS

Certbot owns the nginx config — the renewal config records `installer = nginx`, so
certbot edits `/etc/nginx/sites-available/archive` itself. `certbot.timer` renews 30
days before expiry.

This has bitten before: a certbot run left the config with duplicate `server` blocks,
a stray `return 404`, and a mistyped `server_name`, taking the site down for about 15
hours until someone noticed by hand. That damage came from initial issuance, not
renewal — an August 2026 `--dry-run` left the config byte-identical. Renewal looks
safe, but verify rather than assume after any certbot activity:

```bash
grep -c '^server {' /etc/nginx/sites-available/archive   # expect 2
grep proxy_pass /etc/nginx/sites-available/archive       # expect 127.0.0.1:8080
curl -s https://palestineonline.net/ | grep -o '<title>.*</title>'
```

Test renewal without touching the live cert:

```bash
ssh -t deploy@167.233.141.19 'sudo certbot renew --dry-run'
```

`certbot renew` covers *every* certificate on the box. Scheduled runs only attempt
certs that are actually due, so a stale one sits harmless until its renewal date and
then fails the whole run — `--dry-run` forces an attempt on everything, which is how
you find it early. A domain that no longer resolves can never pass the ACME
challenge, so it fails permanently once due, and a permanently red renewal hides the
real failure when it arrives. Prune certs you no longer serve:

```bash
sudo certbot certificates                    # what's actually here
sudo certbot delete --cert-name <name>
```

Check nothing in `/etc/nginx` references a certificate before deleting it; nginx
refuses to start with a missing `ssl_certificate` file.

## Monitoring

`.github/workflows/uptime.yml` probes the live site every ~5 minutes from GitHub's
runners — deliberately off-box, since a check running on the server cannot report
that the server is down. A failed run emails the repo owner.

Four checks: homepage returns 200; body contains `Palestine Online`; `/api/random`
returns 200; certificate has more than 14 days left.

The keyword check is the load-bearing one. A misrouted nginx serves a perfectly
healthy `200` from the *wrong application*, and status-code monitoring shows solid
green through that entire failure. The keyword is what catches it.

GitHub disables scheduled workflows after 60 days of repository inactivity.

## Runbook

**502 Bad Gateway** — nginx is up, the app is not answering.

```bash
pm2 list                      # is "wayback" online?
pm2 logs wayback --lines 50   # why did it die?
ss -tlnp | grep 8080          # is anything actually listening?
grep proxy_pass /etc/nginx/sites-available/archive   # pointed at 8080?
```

The classic cause is nginx and the app disagreeing about the port.

**200, but the wrong site** — nginx is proxying somewhere else. Check `proxy_pass`,
and confirm `sites-enabled/archive` is a *symlink* to `sites-available/archive`:

```bash
ls -la /etc/nginx/sites-enabled/archive
```

If it is a regular file, the two have diverged and edits to `sites-available` do
nothing — nginx only reads `sites-enabled/*`. This has happened; certbot wrote a real
file over the symlink, and a reload appeared to succeed while changing nothing.

**Pages load but content is missing** — `archive.db` is unreadable. `/api/*` fails
while static routes keep working. `serve.js` opens the DB lazily and reopens it when
the file is replaced, so a rebuilt DB needs no restart.

**Nothing resolves** — check DNS (`dig +short palestineonline.net`, expect
`167.233.141.19`) before touching the server.
