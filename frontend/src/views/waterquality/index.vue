<template>
  <section class="page" data-module="waterquality">
    <header class="page-head">
      <div>
        <h2>水质检测管理 · 持证复核</h2>
        <p class="page-desc">结论签发实行持证复核：仅持有该检测项目有效授权编号的复核人可出具/签发；采样站点人员只能附加读数；跨单位资料只能查看并共享。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出水质检测清单</button>
      </div>
    </header>

    <article class="identity-card">
      <div class="identity-main">
        <span class="identity-label">当前操作身份</span>
        <select class="identity-select" :value="store.operatorId" @change="switchOperator">
          <option v-for="person in operators" :key="person.id" :value="person.id">
            {{ person.name }} · {{ person.title }}（{{ person.unit }}）
          </option>
        </select>
        <span :class="['role-tag', person.role === 'reviewer' ? 'reviewer' : 'sampler']">
          {{ person.role === 'reviewer' ? '持证复核人' : '采样站点人员' }}
        </span>
      </div>
      <ul class="grant-list">
        <li v-if="!person.grants.length" class="grant-empty">无检测项目授权编号：仅可附加本单位采样读数、查看/共享报告</li>
        <li v-for="grant in person.grants" :key="grant.credentialNo" class="grant-item">
          <span class="grant-no">{{ grant.credentialNo }}</span>
          <span class="grant-item-name">{{ grant.item }}</span>
          <span :class="['grant-state', grantState(grant)]">
            {{ grantState(grant) === 'valid' ? `有效至 ${grant.expireAt}` : `${grant.expireAt} 到期·只读` }}
          </span>
        </li>
      </ul>
    </article>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>
            {{ row['报告编号'] ?? '—' }}
            <span v-if="isLegacy(row)" class="mini-tag legacy">历史</span>
            <span v-if="!isSameUnit(person, row)" class="mini-tag cross">跨单位只读</span>
          </td>
          <td>{{ row['所属单位'] ?? '历史归档（单位待补录）' }}</td>
          <td>{{ row['采样站点'] ?? '—' }}</td>
          <td>{{ row['检测项目'] ?? '—' }}</td>
          <td>{{ row['检测值'] ?? '—' }}<span class="limit"> / 上限 {{ row['标准上限'] ?? '—' }}</span></td>
          <td>{{ row['中间结论'] ?? '—' }}</td>
          <td>
            <template v-if="row['复核凭证']">{{ row['复核凭证'] }}<br />
              <span class="muted-text">{{ row['签发人'] }} · {{ row['签发时间'] }}</span>
            </template>
            <span v-else class="muted-text">未签发</span>
          </td>
          <td class="reading-cell">
            <template v-if="readingList(row).length">
              <p v-for="(line, idx) in readingList(row)" :key="idx" class="reading-line">{{ line }}</p>
            </template>
            <span v-else class="muted-text">—</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-for="action in rowActions(row)" :key="action">
              <button v-if="action !== ''" class="link" type="button" @click="runAction(action, row)">
                {{ action }}
              </button>
            </template>
            <span v-if="!rowActions(row).length" class="muted-text">无可用动作</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无水质检测数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条水质检测记录 · 授权编号到期自动转为只读 · 同一授权编号全系统只可签发一次</span>
      <span v-if="notice" class="notice-text">{{ notice }}</span>
      <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import {
  attachReading,
  issueReport,
  returnReport,
  reviewReport,
  shareReport,
  startDetection,
} from '@/api/water-quality-service'
import {
  OPERATORS,
  effectiveGrant,
  findGrant,
  grantState,
  isSameUnit,
} from '@/data/authorization'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('waterquality')
const store = useSessionStore()
const operators = OPERATORS

const person = computed(() => store.operator)

const columns = ['报告编号', '所属单位', '采样站点', '检测项目', '检测值', '中间结论', '复核凭证/签发', '附加读数']
const statuses = ['已采样', '检测中', '已出报告', '超标', '已复核']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['报告编号', '采样站点', '检测项目']

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  const monthPrefix = '2026-10'
  return [
    {
      label: '本月检测次数',
      value: rows.value.filter((row) => String(row['采样时间'] ?? '').startsWith(monthPrefix)).length,
    },
    { label: '超标报告数', value: rows.value.filter((row) => String(row.status) === '超标').length },
    { label: '检测中样本', value: rows.value.filter((row) => String(row.status) === '检测中').length },
  ]
})

function isLegacy(row: EntryRow): boolean {
  return row['所属单位'] === undefined || row['所属单位'] === ''
}

function readingList(row: EntryRow): string[] {
  return Array.isArray(row['附加读数']) ? (row['附加读数'] as string[]) : []
}

/** 按身份与状态计算动作：未授权动作不渲染，校验点同时在服务层兜底 */
function rowActions(row: EntryRow): string[] {
  const status = String(row.status)
  const crossUnit = !isSameUnit(person.value, row)
  if (crossUnit) {
    return ['共享']
  }
  if (person.value.role === 'sampler') {
    // 采样站点人员：只能附加读数；查看与共享不受限
    return status === '已复核' ? ['共享'] : ['附加读数', '共享']
  }
  const item = String(row['检测项目'] ?? '')
  const grant = effectiveGrant(person.value, item)
  switch (status) {
    case '已采样':
      return grant ? ['开始检测', '共享'] : ['共享']
    case '检测中':
      return grant ? ['出具报告', '附加读数', '退回', '共享'] : ['附加读数', '共享']
    case '已出报告':
    case '超标':
      return grant ? ['持证复核', '退回', '共享'] : ['共享']
    case '已复核':
      // 已签发结论不可改；退回作废结论同样需要该项目有效授权（到期即只读）；历史报告仅可查看共享
      return grant ? ['退回', '共享'] : ['共享']
    default:
      return ['共享']
  }
}

function explainBlocked(row: EntryRow): string {
  if (!isSameUnit(person.value, row)) {
    return '跨单位资料只能查看并共享，不能改动'
  }
  if (person.value.role === 'sampler') {
    return '采样站点人员只能附加读数，不能签发或改动结论'
  }
  const item = String(row['检测项目'] ?? '')
  const expired = findGrant(person.value, item)
  if (expired && grantState(expired) === 'expired') {
    return `检测项目「${item}」授权 ${expired.credentialNo} 已到期，自动转为只读`
  }
  return `未取得检测项目「${item}」的检测项目授权编号，未授权不能改动`
}

function switchOperator(event: Event) {
  store.setOperator((event.target as HTMLSelectElement).value)
  errorMessage.value = ''
  notice.value = ''
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  notice.value = ''
  const id = Number(row.id)
  // 未授权动作按钮本身不渲染；若出现绕过（如旧缓存页面），用同一套校验提示拦下
  if (!rowActions(row).includes(action)) {
    errorMessage.value = explainBlocked(row)
    return
  }
  let result: { ok: boolean; message: string }
  if (action === '开始检测') {
    result = startDetection(id, store.operatorId)
  } else if (action === '出具报告') {
    const conclusion = window.prompt(
      `请输入「${row['检测项目']}」检测中间结论（初步判定，最终以持证复核为准）：`,
      String(row['中间结论'] ?? ''),
    )
    if (conclusion === null) return
    result = issueReport(id, store.operatorId, conclusion)
  } else if (action === '持证复核') {
    const grant = effectiveGrant(person.value, String(row['检测项目'] ?? ''))
    const opinion = window.prompt(
      `复核签发「${row['报告编号']}」，将使用授权编号 ${grant?.credentialNo}（该编号全系统只可签发一次）。请输入复核意见：`,
    )
    if (opinion === null) return
    result = reviewReport(id, store.operatorId, opinion)
  } else if (action === '退回') {
    result = returnReport(id, store.operatorId)
  } else if (action === '附加读数') {
    const reading = window.prompt(`附加采样读数（${person.value.name}，不改结论）：`, String(row['检测值'] ?? ''))
    if (reading === null) return
    result = attachReading(id, store.operatorId, reading)
  } else if (action === '共享') {
    result = shareReport(id, store.operatorId)
  } else {
    result = { ok: false, message: `未登记动作「${action}」` }
  }
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水质检测列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.identity-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  align-items: center;
}
.identity-main { display: flex; align-items: center; gap: 8px; }
.identity-label { font-size: 12px; color: var(--muted); }
.identity-select { border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; font-size: 13px; }
.role-tag { font-size: 12px; border-radius: 999px; padding: 2px 10px; }
.role-tag.reviewer { background: #e8f0fe; color: #1f6feb; }
.role-tag.sampler { background: #fef3e2; color: #b45309; }
.grant-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.grant-item { font-size: 12px; background: #f1f5f9; border-radius: 6px; padding: 3px 8px; display: flex; gap: 6px; align-items: center; }
.grant-no { font-weight: 600; }
.grant-item-name { color: var(--muted); }
.grant-state.valid { color: #15803d; }
.grant-state.expired { color: #b42318; }
.grant-empty { font-size: 12px; color: #b45309; }
.mini-tag { font-size: 11px; border-radius: 4px; padding: 0 6px; margin-left: 4px; }
.mini-tag.legacy { background: #e2e8f0; color: #475569; }
.mini-tag.cross { background: #fde8e8; color: #b42318; }
.limit, .muted-text { color: var(--muted); font-size: 12px; }
.reading-cell { min-width: 180px; }
.reading-line { margin: 0; font-size: 12px; color: #334155; }
.notice-text { color: #15803d; }
</style>
