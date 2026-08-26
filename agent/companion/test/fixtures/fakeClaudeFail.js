// Fake "claude" that fails outright (non-zero exit, no valid JSON on stdout).
process.stderr.write("fake claude: simulated crash\n");
process.exit(1);
