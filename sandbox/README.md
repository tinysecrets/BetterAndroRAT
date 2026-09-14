# BetterAndroRAT - sandbox runtime

Runs the **PHP control panel** (`Panel/Index`) on a machine that has no Apache,
no PHP and no MySQL, with everything contained in this directory. It exists so
the panel can be studied in an isolated lab instead of on a real server.

Read this first: **the panel is the C2 side of an Android RAT.** Run it only in
a disposable environment you own, and never point a real device at it. No
Android payload (APK) is built, bundled or configured anywhere here - the
`Payload/` and `Binder/` trees are untouched.

## Why it is built this way

The sandbox this was developed in has no PHP/MySQL packages available and only
allows downloads from GitHub, PyPI and npm. So the stack is assembled from
those sources:

| Layer | What is used | Notes |
| ----- | ------------ | ----- |
| PHP runtime | `PHP 8.3` compiled to WebAssembly (`@php-wasm/node-8-3`) | Real PHP 8.3.33, not an emulation |
| Web server | `sandbox/server.mjs` (Node `http`) | Bridges HTTP to PHP's CGI SAPI |
| Filesystem | The checkout mounted into PHP at **its real path** via NODEFS | `config.php`, `dlfiles/`, uploads all work unmodified |
| Database | SQLite via PDO | Chosen with the new "SQLite" option in the setup wizard |

MySQL is still the default: pick "MySQL / MariaDB (default)" in the wizard and
the panel connects exactly as it always has.

## Quick start

```bash
cd sandbox
npm install

# create the SQLite DB, demo data, config.php and sandbox.flag
npm run provision            # add --reset to wipe and start over

npm start                    # http://localhost:8080/
```

Open <http://localhost:8080/> and log in. `provision` prints the admin
password it generated (or set `ANDRORAT_ADMIN_USER` / `ANDRORAT_ADMIN_PASS`
before running it to choose your own).

To use MySQL instead, delete `Panel/Index/config.php` and run the setup wizard
at `/setup/`.

## Files

| File | Purpose |
| ---- | ------- |
| `server.mjs` | Node HTTP server in front of the PHP 8.3 WASM runtime |
| `provision.mjs` | Builds the DB, seeds demo data, writes `config.php` + `sandbox.flag` |
| `schema.sql` | `Panel/Other Files/SQL.sql` ported to SQLite |
| `package.json` | Dependencies and `start` / `provision` / `reset` scripts |

Runtime state (gitignored): `sandbox/data/androrat.sqlite`,
`sandbox/data/sessions/`, `Panel/Index/config.php`, `Panel/Index/dlfiles/`.

## Two runtime quirks handled by the server

`server.mjs` papers over two things php-wasm does not do the way `mod_php` /
`php-fpm` would. Neither required changing the panel:

1. **Shared cookie jar.** php-wasm normally keeps one cookie store for the
   whole runtime and replays it on every request, which leaks the admin
   session to every visitor. The server sets `cookieStore: false` so cookies
   come from the real request.
2. **Working directory.** PHP's CGI SAPI runs each script with its own
   directory as the CWD; php-wasm does not, which broke the setup wizard
   (`file_exists("../reg.php")`). The server chdirs to the script's directory
   before executing it.

## Changes made to the panel

All of them are backwards compatible - a stock MySQL deployment behaves
exactly as before.

| File | Change | Why |
| ---- | ------ | --- |
| `functions.php` | Uses `$dbdsn` from `config.php` when present, otherwise the hard-coded MySQL DSN | Lets the same SQL run on SQLite |
| `reg.php` | Domain lock is skipped when `Panel/Index/sandbox.flag` exists | The panel refuses to run on any host but `pizzachip.com`; the flag is only created by `provision.mjs` |
| `setup/step1.php`, `setup/createconfig.php` | New "Database Driver" select (MySQL default, SQLite option) | SQLite usable from the first-run wizard |
| `applysettings.php` | Preserves `$dbdsn` when saving settings | Changing a setting must not silently drop back to MySQL |
| `message.php`, `blockbot.php` | `$result[blocked]` → `$result['blocked']` | Undefined constant = fatal error on PHP 8 |
| `clearawaiting.php`, `clearmessages.php` | `TRUNCATE TABLE` → `DELETE FROM` | SQLite has no `TRUNCATE` (identical result in MySQL) |
| `new-upload.php`, `upload-pictures.php` | `end(explode(...))` split into two statements | PHP 8 reference notice |
| `settings.php` | `isset()` guards around `$dbhost` / `$dbname` / `$dbuser` | Undefined-variable warnings in SQLite mode |
| `control.php` | Google Maps calls guarded with `typeof google !== "undefined"` | Map is optional; offline it must not break the page |
| `index.php`, `control.php`, `table.php`, `filetable.php`, `settings.php`, `setup/*` | jQuery from `assets/js/jquery.min.js` instead of `code.jquery.com` | Sandbox has no internet; also removes a third-party dependency |

Unchanged on purpose: the `keylimepie` shared secret used by
`get.php` / `get-functions.php` / `message.php` / uploads, the `http://pizzachip.com/rat/`
payload URL, and everything in `Payload/` and `Binder/`.

## Verified working

Checked with `curl` against the running sandbox:

- `GET /` login page, `POST /login.php`, session-protected `control.php`
- Device table: bot list, online/offline state, timezone conversion
- Setup wizard end to end (SQLite and MySQL paths) and settings save
- `get.php` - bot check-in / registration writes a row
- `get-functions.php` - queued commands are returned and drained; wrong
  password rejected
- `addcommand.php` - panel queues a command, bot picks it up
- `message.php` + `getmessages.php` - message ingest and history
- `new-upload.php` / `upload-pictures.php` - multipart upload to `dlfiles/`,
  per-bot picture directories, file manager listing
- `filetable.php`, `getwaitingcommands.php`, `showpictures.php`

## Out of scope

- **Building the Android payload.** `Payload/` is an Eclipse/ADT-era project
  that needs the old Android SDK, and it points at `http://pizzachip.com/rat/`.
  Nothing here builds, binds or repoints it.
- **The `Binder/` VB.NET APK binder** - Windows-only, not exercised.

## Teardown

```bash
npm run reset          # drop DB, config.php and captured uploads
rm -rf sandbox/data Panel/Index/config.php Panel/Index/sandbox.flag Panel/Index/dlfiles
```
