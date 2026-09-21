# MoonGrinder GD List uploader

MoonGrinder is hosted on GitHub Pages, so the website itself never asks for your Geometry Dash password or GJP2. Uploading a list uses a small local helper that reads the authentication data already stored in your own `CCGameManager.dat` and sends the list to the Geometry Dash server.

## Windows

1. Close Geometry Dash first if you want to make sure the save on disk is current.
2. Double-click `tools\gd_list_bridge.bat`.
3. Keep the terminal window open.
4. The MoonGrinder **GD Lists** tab opens automatically.
5. If Chrome asks whether MoonGrinder may connect to devices on your local network, allow it. This permission is needed only so the website can talk to the helper running on `127.0.0.1`.
6. Click **Check connection** if it does not connect immediately.
7. Build the list and click **Upload to Geometry Dash**.

The normal Windows save location is detected automatically:

```text
%LOCALAPPDATA%\GeometryDash\CCGameManager.dat
```

## macOS / Linux

Run:

```bash
./tools/gd_list_bridge.sh
```

On macOS the normal Geometry Dash save location is detected automatically. On Linux, or if your save is somewhere unusual, pass it explicitly:

```bash
python3 tools/gd_list_bridge.py --save "/path/to/CCGameManager.dat"
```

## Security

The helper listens only on `127.0.0.1`, accepts requests only from the MoonGrinder GitHub Pages origin and localhost, and requires a random token that changes each time the helper starts. The browser receives your Geometry Dash username for the connection status, but it never receives GJP2, UDID, account authentication data, or the decoded save.

The helper uses the same private Geometry Dash list upload endpoint as the game. Because that endpoint is unofficial and can change, an upload can stop working after a Geometry Dash update even if the MoonGrinder website itself still works.

## Updating a list

Enter the existing Geometry Dash List ID in the **Existing List ID** field before uploading. Leave it at `0` to create a new list. Geometry Dash normally does not allow an uploaded list to be renamed, so keep the original name when updating one.
