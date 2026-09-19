# MoonGrinder Time Reviewer

This is a standalone local contribution tool. It is not linked from or loaded by the MoonGrinder website.

## Use it

Windows: double-click `tools/review_times.bat`.

macOS/Linux:

```bash
python3 tools/time_reviewer.py
```

The tool opens a local page at `127.0.0.1`. Search for any level or start with **Flagged only**. You can edit/remove/add anonymized completion times, set the P30 MoonGrinder should use, and stage multiple fixes.

Click **Save contribution** when done. It creates one JSON file in:

```text
contributions/time-fixes/
```

For a GitHub contribution, commit only that generated JSON file. It never contains friend usernames, account IDs, authentication data, or personal progress.

## Repository owner

When the public repo is next to the private `Moongrinding V2` folder, the tool automatically enables maintainer mode. It can regenerate `data/time_review.json`, review submitted contribution files, make backups, apply accepted P30 values to the private timing files, and update the public catalog estimate.

The public review dataset contains only level metadata and anonymized millisecond values.

For the full pull-request workflow and repository rules, see `CONTRIBUTING.md`.
