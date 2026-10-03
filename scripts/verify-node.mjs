/**
 * canonical 套件的**纯 Node 入口**喵（DESIGN §9-16）喵。
 *
 * 为什么不只用 bash：dsh 沙箱禁命名管道，Git Bash / WSL 都会报
 * `couldn't create signal pipe, Win32 error 5`，导致套件在沙箱里跑不起来喵。
 * 所以把原 `verify.sh` 的逻辑整体搬到这里，`verify.sh` 退化为一行薄包装喵。
 *
 * 做法与 `verify.sh` 完全一致喵：复制插件到临时目录 → 桩 `@deepseek-ai/dsh-tools`
 * → 复制真实的 schemastery / cosmokit / zod / yaml → 执行 `verify.mjs` → 清理喵。
 * 副本隔离，**绝不写源目录**喵。
 *
 * 用法：`node scripts/verify-node.mjs`（`npm test` 也指向这里）喵。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..')

/** profile 的 node_modules 候选位置：随 shell 而异（WSL 是 /mnt/c/...、Git Bash 是 /c/...）喵。 */
function profileCandidates() {
  const fromEnv = process.env.DSH_PROFILE_NM
  return [
    ...(fromEnv ? [fromEnv] : []),
    '/mnt/c/Users/flafk/.dsh/profiles/desktop/node_modules',
    '/c/Users/flafk/.dsh/profiles/desktop/node_modules',
    'C:\\Users\\flafk\\.dsh\\profiles\\desktop\\node_modules',
  ]
}

/** 挑第一个真的装着 schemastery 的候选喵。 */
function pickProfileNm() {
  for (const candidate of profileCandidates()) {
    if (existsSync(join(candidate, '@deepseek-ai', 'schemastery'))) return candidate
  }
  return process.env.DSH_PROFILE_NM || '/mnt/c/Users/flafk/.dsh/profiles/desktop/node_modules'
}

/** 复制一个包；源不存在时安静跳过喵。 */
async function copyPackage(from, to, warnings, label) {
  try {
    await cp(from, to, { recursive: true })
    return true
  } catch {
    warnings.push(`未找到 ${label}（${from}）`)
    return false
  }
}

const PROFILE_NM = pickProfileNm()
const warnings = []
let temp

try {
  temp = await mkdtemp(join(tmpdir(), 'hermes-verify-'))
  console.log(`src:  ${SRC}`)
  console.log(`temp: ${temp}`)
  console.log(`nm:   ${PROFILE_NM}`)

  // 1. 插件本体（只复制运行时需要的部分，node_modules 由下一步装配）喵
  await cp(join(SRC, 'index.js'), join(temp, 'index.js'))
  // FIX-11：pluginVersion() 读自己的 package.json，副本里也得有一份喵
  await cp(join(SRC, 'package.json'), join(temp, 'package.json'))
  await cp(join(SRC, 'src'), join(temp, 'src'), { recursive: true })
  await cp(join(SRC, 'scripts', 'verify.mjs'), join(temp, 'verify.mjs'))

  // 2. 桩掉宿主私有包（app.asar 里的 dsh-tools 在离线环境拿不到）喵
  await mkdir(join(temp, 'node_modules', '@deepseek-ai', 'dsh-tools'), { recursive: true })
  await writeFile(
    join(temp, 'node_modules', '@deepseek-ai', 'dsh-tools', 'package.json'),
    '{ "name": "@deepseek-ai/dsh-tools", "version": "0.0.0", "type": "module", "main": "index.js" }\n',
  )
  await writeFile(
    join(temp, 'node_modules', '@deepseek-ai', 'dsh-tools', 'index.js'),
    'export function defineTool(def) { return def }\n',
  )

  // 3. 真实依赖喵
  await copyPackage(join(PROFILE_NM, '@deepseek-ai', 'schemastery'), join(temp, 'node_modules', '@deepseek-ai', 'schemastery'), warnings, 'schemastery')
  await copyPackage(join(PROFILE_NM, '@deepseek-ai', 'cosmokit'), join(temp, 'node_modules', '@deepseek-ai', 'cosmokit'), warnings, 'cosmokit')
  await copyPackage(join(PROFILE_NM, 'yaml'), join(temp, 'node_modules', 'yaml'), warnings, 'yaml')
  // zod 是本插件的真实依赖，优先用源码目录里装好的那份喵
  const zodFrom = existsSync(join(SRC, 'node_modules', 'zod'))
    ? join(SRC, 'node_modules', 'zod')
    : join(PROFILE_NM, 'zod')
  await copyPackage(zodFrom, join(temp, 'node_modules', 'zod'), warnings, 'zod')

  for (const warning of warnings) console.log(`warn: ${warning}`)
  if (warnings.some((text) => text.includes('schemastery'))) {
    console.log('warn: 缺 schemastery，Config 断言将失败')
  }

  // 4. 跑断言集（patch 路径作为参数传入，原生 node 能正确接收）喵
  const child = spawnSync(process.execPath, ['verify.mjs', join(SRC, 'cordis.patch.yml')], {
    cwd: temp,
    stdio: 'inherit',
  })
  if (child.error) throw child.error
  process.exitCode = child.status ?? 1
} catch (error) {
  console.error(`verify-node 失败：${error && error.message ? error.message : error}`)
  process.exitCode = 1
} finally {
  if (temp) {
    await rm(temp, { recursive: true, force: true })
    console.log(`cleaned: ${temp}`)
  }
}
