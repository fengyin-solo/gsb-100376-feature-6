// 测试引导：提供浏览器桩（localStorage / window / document 无关），再加载测试套件。
// 固定“今天”为 2026-10-04，与授权有效期示例数据保持一致。
const storage = new Map()
const localStorageStub = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => void storage.set(k, String(v)),
  removeItem: (k) => void storage.delete(k),
}
globalThis.window = { localStorage: localStorageStub }
globalThis.localStorage = localStorageStub
globalThis.__TODAY__ = '2026-10-04'

const { runTestSuite } = await import('./test-suite.ts')
await runTestSuite()
