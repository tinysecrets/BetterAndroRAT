# Better Android RAT
Dendroid Based Android Remote Access Trojan
#### All responsibilities are at your own risk.
#### Please use it only for research purposes.
# Feature
* Remote Update & Install Application
* Remote WebCam
* Remote Microphone Record
* Remote File Management
* Remote Call & SMS
* Remote Device Controller


# Sandbox
`sandbox/` runs the PHP control panel on any machine with Node installed -
PHP 8.3 (WebAssembly) plus SQLite, no Apache/MySQL setup required:

```bash
cd sandbox && npm install && npm run provision && npm start   # http://localhost:8080/
```

See [sandbox/README.md](sandbox/README.md) for the architecture, the (small,
backwards-compatible) panel changes it required, and what has been tested.
It is intended for isolated research environments; no Android payload is
built or bundled there.


