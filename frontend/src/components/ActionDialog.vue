<template>
  <div v-if="open" class="modal-mask" @click.self="cancel">
    <form class="modal-card" @submit.prevent="confirm">
      <h3 class="modal-title">{{ title }}</h3>
      <p v-if="hint" class="modal-hint">{{ hint }}</p>

      <label v-if="mode === 'reading'" class="modal-field">
        <span>现场检测读数</span>
        <input v-model="reading" autofocus placeholder="例如 7.6" />
      </label>

      <template v-else-if="mode === 'conclusion'">
        <p class="modal-readonly">已附加读数：{{ row.检测值 || '—' }}（检测项目：{{ row.检测项目 }}）</p>
        <label class="modal-field">
          <span>中间结论说明（可留空使用默认措辞）</span>
          <textarea v-model="conclusion" rows="3" placeholder="检测分析初步结论，待持证复核签发"></textarea>
        </label>
      </template>

      <template v-else>
        <p class="modal-readonly">
          检测项目：{{ scopeText }} · 归属单位：{{ row.归属单位 || '—' }}<br />
          当前操作人：{{ operator.name }}（{{ operator.unit }}）
        </p>
        <label class="modal-field">
          <span>检测项目授权编号</span>
          <input v-model="credentialCode" autofocus placeholder="例如 WQ-PH-2026-018" />
        </label>
      </template>

      <footer class="modal-actions">
        <button class="btn" type="button" @click="cancel">取消</button>
        <button class="btn primary" type="submit">{{ confirmText }}</button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { Operator } from '@/data/auth'
import type { EntryRow } from '@/data/types'

const props = defineProps<{
  open: boolean
  action: string
  row: EntryRow
  operator: Operator
  scopeText: string
}>()

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'confirm', payload: { reading?: string; conclusion?: string; credentialCode?: string }): void
}>()

const reading = ref('')
const conclusion = ref('')
const credentialCode = ref('')

watch(
  () => props.open,
  (open) => {
    if (open) {
      reading.value = ''
      conclusion.value = ''
      credentialCode.value = ''
    }
  },
)

const mode = computed<'reading' | 'conclusion' | 'credential'>(() => {
  if (props.action === '附加读数') {
    return 'reading'
  }
  if (props.action === '提交结论') {
    return 'conclusion'
  }
  return 'credential'
})

const title = computed(() => `${props.action} · ${String(props.row.报告编号 ?? props.row.记录编号 ?? props.row.id)}`)
const hint = computed(() => {
  if (mode.value === 'reading') {
    return '采样站点人员只能附加读数；结论签发由持证复核人员完成。'
  }
  if (mode.value === 'conclusion') {
    return '中间结论提交后进入待复核，可被退回重测；最终结论须持授权编号签发。'
  }
  return '系统将核验授权编号：持证人员、检测项目、有效期与归属单位，任一不符即拒绝签发。'
})
const confirmText = computed(() => (mode.value === 'credential' ? '核验并签发' : '确定'))

function cancel() {
  emit('cancel')
}

function confirm() {
  if (mode.value === 'reading') {
    emit('confirm', { reading: reading.value })
    return
  }
  if (mode.value === 'conclusion') {
    emit('confirm', { conclusion: conclusion.value })
    return
  }
  emit('confirm', { credentialCode: credentialCode.value })
}
</script>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 420px;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
}
.modal-title { margin: 0 0 6px; font-size: 15px; }
.modal-hint { margin: 0 0 12px; color: var(--muted); font-size: 12px; }
.modal-readonly { margin: 0 0 12px; font-size: 12px; color: var(--muted); line-height: 1.8; }
.modal-field { display: block; margin-bottom: 14px; font-size: 12px; color: var(--muted); }
.modal-field input, .modal-field textarea {
  width: 100%;
  margin-top: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  color: #1f2937;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
