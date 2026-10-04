import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries:v2'
// 复核凭证消耗台账：记录哪个授权编号已经在哪张报告上签发过，保证同一授权只生效一次。
const LEDGER_KEY = 'hydrology-monitor-station:review-ledger:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null
let ledgerCache: Record<string, string> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

/** 直接读取最新台账（含其他标签页的写入），调用方据此做并发判定 */
export function readLedger(): Record<string, string> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return ledgerCache ?? {}
  }
  const raw = window.localStorage.getItem(LEDGER_KEY)
  ledgerCache = raw ? (JSON.parse(raw) as Record<string, string>) : {}
  return ledgerCache
}

export function ledgerOwner(credentialNo: string): string | undefined {
  const ledger = readLedger()
  return ledger[credentialNo]
}

export type ConsumeResult = { ok: boolean; ownerRef?: string }

/**
 * 原子占用授权编号：凭证号全局唯一，先查后写之间不接受第二次占用。
 * 多个标签页/重复点击同时签发时，只有第一次能写成功。
 */
export function consumeCredential(
  credentialNo: string,
  ownerRef: string,
): ConsumeResult {
  if (typeof window === 'undefined' || !window.localStorage) {
    const ledger = ledgerCache ?? {}
    if (ledger[credentialNo]) {
      return { ok: false, ownerRef: ledger[credentialNo] }
    }
    ledger[credentialNo] = ownerRef
    ledgerCache = ledger
    return { ok: true }
  }
  const ledger = readLedger()
  if (ledger[credentialNo]) {
    return { ok: false, ownerRef: ledger[credentialNo] }
  }
  ledger[credentialNo] = ownerRef
  ledgerCache = ledger
  window.localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger))
  return { ok: true }
}

/** 退回时释放占用：该报告作废的结论不再占住授权编号，允许后续重新签发 */
export function releaseCredential(credentialNo: string, ownerRef: string): void {
  if (!credentialNo) {
    return
  }
  const ledger = readLedger()
  if (ledger[credentialNo] === ownerRef) {
    delete ledger[credentialNo]
    ledgerCache = ledger
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger))
    }
  }
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 其他标签页写了 localStorage（含台账）后，本页缓存作废，保证并发判定基于最新数据。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      cache = null
    }
    if (event.key === LEDGER_KEY) {
      ledgerCache = null
    }
  })
}
