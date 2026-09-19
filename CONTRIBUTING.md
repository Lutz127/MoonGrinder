# Contributing to MoonGrinder

Thanks for helping improve MoonGrinder. The easiest useful contribution is correcting suspicious estimated clear times.

## Fix estimated times

### Windows

Double-click:

```text
tools\review_times.bat
```

### macOS / Linux

Run:

```bash
./tools/review_times.sh
```

The Time Reviewer opens locally in your browser. It starts with suspicious levels and lets you search every level by name, creator, or Level ID. You can edit or remove anonymized completion times, add a missing time, and choose the P30 estimate MoonGrinder should use.

When you are done:

1. Stage each level you changed.
2. Click **Save contribution**.
3. The tool creates one JSON file under `contributions/time-fixes/`.
4. Commit that generated JSON file and open a pull request.

Please explain unusual corrections in the review note when possible. The public review data contains no friend usernames, account IDs, Geometry Dash authentication data, or personal progress.

## Website/code changes

Before opening a pull request, run:

```bash
npm run check
python tools/check_public_repo.py
```

MoonGrinder has no npm dependencies or build step. The deployed website code lives in `assets/js/v2/` and `assets/css/styles-v2.css`.

## Do not commit private data

Never commit Geometry Dash save files, GJP2/authentication data, private leaderboard exports, `friend_leaderboards_private.json`, `level_times.json`, personal progress files, or backups containing those files.
