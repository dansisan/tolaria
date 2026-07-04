/**
 * Quality gate for production builds (wired into tauri.conf.json
 * beforeBuildCommand). Runs lint and the unit suite before bundling.
 *
 * Skip with: SKIP_TESTS=1 pnpm tauri build
 */
import { spawnSync } from 'node:child_process'

if (process.env.SKIP_TESTS) {
  console.log('[prebuild-checks] SKIP_TESTS set — skipping lint and tests')
  process.exit(0)
}

const checks = [
  ['pnpm', ['lint']],
  ['pnpm', ['test']],
]

for (const [command, args] of checks) {
  console.log(`[prebuild-checks] ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) {
    console.error(`[prebuild-checks] ${command} ${args.join(' ')} failed — aborting build (set SKIP_TESTS=1 to bypass)`)
    process.exit(result.status ?? 1)
  }
}
