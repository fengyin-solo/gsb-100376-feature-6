// Node ESM loader：把 @/ 别名解析到 src，并把 .ts 源文件用 TypeScript 转译。
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('/workspace/frontend/node_modules/typescript')
const SRC_ROOT = '/workspace/frontend/src'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return { url: pathToFileURL(SRC_ROOT + specifier.slice(1) + '.ts').href, shortCircuit: true }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const base = new URL(specifier, context.parentURL)
    for (const candidate of [base.href, base.href + '.ts', base.href + '/index.ts']) {
      try {
        readFileSync(fileURLToPath(candidate))
        return { url: candidate, shortCircuit: true }
      } catch {}
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = readFileSync(fileURLToPath(url), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
      fileName: fileURLToPath(url),
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
