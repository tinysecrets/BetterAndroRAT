<?php
$allowedDomains = array("www.pizzachip.com", "pizzachip.com");

// Sandbox / local-lab support (see sandbox/README.md).
// The panel ships with a hard-coded domain lock. Dropping an empty file named
// "sandbox.flag" next to this script disables that lock so the panel can be
// studied on localhost or inside an ephemeral sandbox. Nothing else changes,
// and the flag is never created by the code itself.
if (file_exists(dirname(__FILE__) . "/sandbox.flag")) {
  $validDomain = "true";
  return;
}

if (in_array($_SERVER['HTTP_HOST'], $allowedDomains)) {
	$validDomain = "true";
} else {
	$validDomain = "false";
}
?>