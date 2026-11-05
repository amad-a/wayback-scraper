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

## Image folders, the home page banners and the computers grid

`npm run images` builds `image-aliases/` (gitignored): every distinct image in `sites/`,
sorted into folders by size, shape, animation, use as a wallpaper tile, site, and
subject (people, flags, arabic, buildings, computers…). Entries are hard links to the
originals, so Finder shows thumbnails and nothing is copied; deleting one leaves the
original alone, editing one edits it. Subjects come from macOS's Vision framework
(`scripts/image-vision.swift`), cached in `image-aliases/.cache`, so only new images
are looked at on a rerun. Folders of your own in there survive a rebuild.

The carousel on the home page (`sites/palestineonline.net/home.html`) walks through
the images in `image-aliases/banners-homepage`, a folder picked by hand. After adding or
removing pictures there, regenerate its list and commit it:

```bash
npm run banners    # writes sites/palestineonline.net/banners.json
```

The grid of computers at the bottom of the How To Use page (`howtouse.html`) works the
same way, from `image-aliases/computer-picks`:

```bash
npm run computers  # writes sites/palestineonline.net/computers.json
```

Each pick is matched back to its original under `sites/` (by name, or by content if it
was copied), and credited to the best page in `archive.db` that shows it, so run
`npm run db` first if the pages are new. A pick that matches nothing in the archive,
such as a crop, is copied to `sites/palestineonline.net/images/`; commit that too.
When no page is found, the run says so: add `page` and `url` to that entry in the list
by hand, and later runs keep them.
The folder itself is only on your machine, so the server needs nothing but the
committed list.

## Deployment

Production setup, the deploy command, and a runbook for when the site breaks are in
[DEPLOYMENT.md](DEPLOYMENT.md).

```bash
ssh deploy@167.233.141.19 '~/wayback-scraper/scripts/deploy.sh'
```
