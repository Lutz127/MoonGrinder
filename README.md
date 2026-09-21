# MoonGrinder

MoonGrinder is a static Geometry Dash platformer moon-grinding planner designed to run directly on GitHub Pages. It uses the full rated-platformer catalog, keeps visitor progress in the browser, can read `CCGameManager.dat` locally, and includes a standalone community tool for improving estimated clear times.

No backend, framework, database, account, or build step is required.

## Features

- Full rated platformer catalog using Level ID as the canonical identity
- Search and filtering by difficulty, rating, moon reward, status, and estimated time
- Time-budget and moon-goal planners
- Fastest-first or most-efficient planning
- Grinding block builder and timed grinding sessions
- GD Lists builder with shortest, most-efficient, planner, grinding-block, and custom sources
- One-click conversion of planner results and grinding blocks into GD List drafts
- Local GD List uploader with Public, Unlisted, Friends-only, difficulty, description, ordering, and update controls
- Persistent local completed, skipped, excluded, and custom-time state
- Optional global exclusion of Easy, Medium, Hard, Insane, and Extreme Demon from planners/blocks
- Optional planner splits for Hard 4/5 moons, Harder 6/7 moons, and Insane 8/9 moons, while retaining the normal whole-difficulty filters
- Local `CCGameManager.dat` import for completed platformers and moon count
- Moon Check for official non-catalog moons, historical/unobtainable sources, and stale reward values
- Level names and creators link directly to GDBrowser
- Stats show remaining levels by difficulty and by moon reward
- Local MoonGrinder save import/export
- Standalone public-safe Time Reviewer for community estimate corrections

## Run locally

Windows:

```text
serve_local.bat
```

macOS/Linux:

```bash
./serve_local.sh
```

Then open `http://localhost:8000`. Do not open `index.html` directly because browsers can block local module/data requests.

## Repository layout

```text
MoonGrinder/
  index.html
  404.html
  .nojekyll
  assets/
    css/
      styles-v2.css
    images/
      moon.png
      difficulty/
    js/
      v2/              # deployed website modules, including gd-lists.js
  data/
    catalog.json       # sanitized public website catalog
    time_review.json   # anonymized completion-time samples
    time_review_accepted.json
  contributions/
    time-fixes/        # generated community correction proposals
  tools/
    gd_list_bridge.py
    gd_list_bridge.bat
    gd_list_bridge.sh
    GD_LIST_UPLOADER.md
    time_reviewer.py
    review_times.bat
    review_times.sh
    update_data.py
    update_catalog.bat
    check_public_repo.py
    smoke_test.mjs
    TIME_REVIEWER.md
  CONTRIBUTING.md
  serve_local.bat
  serve_local.sh
  package.json
```

## Community Time Reviewer

The Time Reviewer is intentionally separate from the public website. It runs only on `127.0.0.1` and uses the anonymized `data/time_review.json` dataset.

Windows:

```text
tools\review_times.bat
```

macOS/Linux:

```bash
./tools/review_times.sh
```

Contributors can search every level, focus on automatically flagged levels, edit/remove/add anonymized completion times, change the effective P30, and save all staged changes as one JSON file under `contributions/time-fixes/`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the PR workflow.

The public review dataset intentionally contains no player usernames, account IDs, credentials, or personal progress.

## Geometry Dash List uploader

The GD Lists tab can build lists directly from planner results, grinding blocks, automatic shortest/efficiency presets, or a manual draft. Uploading requires the local helper so account credentials never need to be typed into or stored by the GitHub Pages site.

Windows:

```text
tools\gd_list_bridge.bat
```

macOS/Linux:

```bash
./tools/gd_list_bridge.sh
```

The helper binds only to `127.0.0.1`, reads the logged-in account data from the local `CCGameManager.dat`, and returns no GJP2/authentication data to the browser. New list drafts default to Unlisted so they can be checked before being made Public. See [tools/GD_LIST_UPLOADER.md](tools/GD_LIST_UPLOADER.md) for setup and troubleshooting.

## Update the public catalog

The private MoonGrinder timing pipeline can produce `website_catalog.json`. To sanitize it into the public site:

```powershell
py -3.11 tools\update_data.py --source "D:\Moongrinding V2\data\website_catalog.json"
```

Or drag `website_catalog.json` onto `tools\update_catalog.bat`.

After updating data, run:

```bash
npm run check
python tools/check_public_repo.py
```

`npm run check` uses only Node.js itself. There are no npm packages to install.

## GitHub Pages

1. Create a repository and put these files at its root.
2. Push to GitHub.
3. Open **Settings > Pages**.
4. Choose **Deploy from a branch**.
5. Select the main branch and `/ (root)`.

MoonGrinder uses hash routes such as `#/catalog`, so no server-side routing is needed.

## Privacy and public-repository safety

Website progress and imported Geometry Dash save data stay in the visitor's browser. `CCGameManager.dat` is parsed locally and is not uploaded by MoonGrinder.

Never commit:

- `friend_leaderboards_private.json`
- `level_times.json`
- `CCGameManager.dat` or `CCLocalLevels.dat`
- GJP2/authentication data
- private leaderboard identities
- personal progress/session/settings files
- private backups

The GitHub Actions workflow runs `tools/check_public_repo.py`, syntax-checks the deployed JavaScript and Python tools, and runs the planner smoke tests on every push and pull request.
