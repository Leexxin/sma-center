import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.SMA_CENTER_SELF_HOSTED = '1';
process.env.SMA_CENTER_DATA_DIR ||= fileURLToPath(new URL('../.sma-center-data/', import.meta.url));
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), 'build', '--webpack'], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
