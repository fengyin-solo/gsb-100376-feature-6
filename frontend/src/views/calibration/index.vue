<template>
  <section class="page" data-module="calibration">
    <header class="page-head">
      <div>
        <h2>仪器检定管理 · 结论签发需复核凭证</h2>
        <p class="page-desc">「确认合格」为检定结论签发动作，必须新增登记复核凭证（检测项目授权编号）；凭证按检测项目受控、到期只读、同一编号全系统只生效一次；历史已合格记录无凭证照常兼容展示。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出仪器检定清单</button>
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
        <span :class="['role-tag', store.operator.role === 'reviewer' ? 'reviewer' : 'sampler']">
          {{ store.operator.role === 'reviewer' ? '持证复核人' : '采样站点人员' }}
        </span>
      </div>
      <ul class="grant-list">
        <li v-if="!store.operator.grants.length" class="grant-empty">无检测项目授权编号：确认合格将被拒绝</li>
        <li v-for="grant in store.operator.grants" :key="grant.credentialNo" class="grant-item">
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
          <td>{{ row['记录编号'] ?? '—' }}</td>
          <td>{{ row['仪器编号'] ?? '—' }}</td>
          <td>{{ row['仪器名称'] ?? '—' }}</td>
          <td>{{ row['检定单位'] ?? '—' }}</td>
          <td>{{ row['检定日期'] ?? '—' }}</td>
          <td>{{ row['有效期至'] ?? '—' }}</td>
          <td>{{ row['检定结论'] ?? '—' }}</td>
          <td>
            <template v-if="row['复核凭证'] && row['复核凭证'] !== '—'">
              {{ row['复核凭证'] }}<br />
              <span class="muted-text">{{ row['签发人'] }} · {{ row['签发时间'] }}</span>
            </template>
            <span v-else class="muted-text">历史记录·无凭证</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无仪器检定数据，可先登记仪器检定记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条仪器检定记录</span>
      <span v-if="notice" class="notice-text">{{ notice }}</span>
      <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { OPERATORS, grantState } from '@/data/authorization'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('calibration')
const store = useSessionStore()
const operators = OPERATORS
const columns = ['记录编号', '仪器编号', '仪器名称', '检定单位', '检定日期', '有效期至', '检定结论', '复核凭证/签发']
const actions = ['送出检定', '确认合格', '标记不合格']
const statuses = ['待送检', '送检中', '已合格', '不合格', '已停用']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const notice = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['记录编号', '仪器编号', '仪器名称']
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '待送检仪器', value: rows.value.filter((row) => String(row.status) === '待送检').length },
  { label: '已合格仪器', value: rows.value.filter((row) => String(row.status) === '已合格').length },
  { label: '不合格仪器', value: rows.value.filter((row) => String(row.status) === '不合格').length },
])

function switchOperator(event: Event) {
  store.setOperator((event.target as HTMLSelectElement).value)
  errorMessage.value = ''
  notice.value = ''
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
  if (action === '确认合格') {
    const item = String(row['仪器名称'] ?? '')
    const grant = store.operator.grants.find(
      (candidate) => candidate.item === item && grantState(candidate) === 'valid',
    )
    const credentialNo = window.prompt(
      `确认合格须新增复核凭证。仪器「${item}」对应授权编号${
        grant ? `（本人有效凭证：${grant.credentialNo}）` : '（本人名下无该项目有效授权）'
      }，请输入授权编号：`,
      grant?.credentialNo ?? '',
    )
    if (credentialNo === null) return
    const opinion = window.prompt('请输入检定结论/复核意见：', '检定合格')
    if (opinion === null) return
    const result = applyAction(meta.key, Number(row.id), action, {
      operatorId: store.operatorId,
      credentialNo,
      text: opinion,
    })
    finish(result)
    return
  }
  const result = applyAction(meta.key, Number(row.id), action, { operatorId: store.operatorId })
  finish(result)
}

function finish(result: { ok: boolean; message: string }) {
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  notice.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '仪器检定列表读取失败'
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
.muted-text { color: var(--muted); font-size: 12px; }
.notice-text { color: #15803d; }
</style>
