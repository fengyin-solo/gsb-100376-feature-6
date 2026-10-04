<template>
  <section class="page" data-module="waterquality">
    <header class="page-head">
      <div>
        <h2>水质检测管理 · 持证复核</h2>
        <p class="page-desc">采样站点人员只能附加读数；检测结论须由持检测项目授权编号的人员签发；跨单位资料只能查看并共享。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出水质检测清单</button>
      </div>
    </header>

    <OperatorBar />

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
          <th>复核凭证</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-external': isExternal(row) }">
          <td v-for="column in columns" :key="column">
            {{ row[column] === '' || row[column] == null ? '—' : row[column] }}
          </td>
          <td>
            {{ row.status }}
            <span v-if="isLegacy(row)" class="badge legacy" title="持证复核上线前出具，结论原样兼容">历史报告</span>
            <span v-if="isExternal(row)" class="badge external">外单位</span>
          </td>
          <td class="cell-log">
            <template v-if="row.签发授权编号">
              {{ row.签发授权编号 }}<br />
              <span class="muted">{{ row.复核人 }} · {{ row.复核时间 }}</span>
            </template>
            <span v-else-if="isLegacy(row)" class="muted">历史结论，无电子凭证</span>
            <span v-else class="muted">待签发</span>
          </td>
          <td class="row-actions">
            <template v-for="item in availabilityFor(row)" :key="item.action">
              <button
                class="link"
                type="button"
                :disabled="!item.enabled"
                :title="item.reason"
                @click="runAction(item.action, row)"
              >
                {{ item.action }}
              </button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无水质检测数据</td>
        </tr>
      </tbody>
    </table>

    <ActionDialog
      :open="dialog.open"
      :action="dialog.action"
      :row="dialog.row"
      :operator="store.operator"
      :scope-text="String(dialog.row.检测项目 ?? '')"
      @cancel="closeDialog"
      @confirm="confirmDialog"
    />

    <footer class="page-foot">
      <span>共 {{ total }} 条水质检测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import OperatorBar from '@/components/OperatorBar.vue'
import ActionDialog from '@/components/ActionDialog.vue'
import {
  availableActions,
  isExternal as rowIsExternal,
  isLegacyReport,
  requiresCredentialInput,
  type ActionAvailability,
  type ActionPayload,
} from '@/api/review-guard'
import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('waterquality')
const store = useSessionStore()
const columns = ['报告编号', '采样站点', '归属单位', '检测项目', '检测值', '标准上限', '检测人']
const statuses = ['已采样', '检测中', '已出报告', '超标', '已复核']
const filterFields = ['报告编号', '采样站点', '检测项目']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const dialog = reactive<{ open: boolean; action: string; row: EntryRow }>({
  open: false,
  action: '',
  row: {} as EntryRow,
})

const stats = computed(() => [
  { label: '报告总数', value: rows.value.length },
  { label: '超标报告数', value: rows.value.filter((row) => String(row.status) === '超标').length },
  { label: '检测中样本', value: rows.value.filter((row) => ['已采样', '检测中', '已出报告'].includes(String(row.status))).length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isExternal(row: EntryRow): boolean {
  return rowIsExternal(store.operator, row)
}

function isLegacy(row: EntryRow): boolean {
  return isLegacyReport('waterquality', row)
}

function availabilityFor(row: EntryRow): ActionAvailability[] {
  return availableActions('waterquality', row, store.operator)
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
  if (requiresCredentialInput(action) || ['附加读数', '提交结论'].includes(action)) {
    dialog.open = true
    dialog.action = action
    dialog.row = row
    return
  }
  dispatch(action, row)
}

function closeDialog() {
  dialog.open = false
}

function confirmDialog(payload: ActionPayload) {
  const { action, row } = dialog
  dialog.open = false
  dispatch(action, row, payload)
}

function dispatch(action: string, row: EntryRow, payload?: ActionPayload) {
  const result = applyAction(meta.key, Number(row.id), action, {
    operatorId: store.operator.id,
    payload,
  })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
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
.row-external { background: #fbfdff; }
.cell-log { white-space: pre-line; line-height: 1.6; }
.muted { color: var(--muted); font-size: 12px; }
.badge { border-radius: 999px; padding: 1px 8px; font-size: 11px; margin-left: 4px; }
.badge.legacy { background: #f1eefc; color: #5b4bb0; }
.badge.external { background: #eef2f7; color: var(--muted); }
.link:disabled { color: #b6bfcc; cursor: not-allowed; }
</style>
