<template>
  <section class="auth-bar">
    <div class="auth-id">
      <span class="auth-label">当前身份</span>
      <select :value="store.operator.id" @change="onSwitch">
        <option v-for="operator in operators" :key="operator.id" :value="operator.id">
          {{ operator.name }}（{{ roleLabelOf(operator.role) }} · {{ operator.unit }}）
        </option>
      </select>
    </div>
    <div class="auth-cred">
      <template v-if="active.length">
        <span class="auth-label">有效授权</span>
        <span v-for="credential in active" :key="credential.code" class="cred-chip valid">
          {{ credential.code }} · {{ credential.scopes.join('、') }} · 至 {{ credential.validTo }}
        </span>
      </template>
      <template v-else>
        <span class="cred-chip empty">当前身份无有效检测项目授权：仅可查看与共享，不能签发结论</span>
      </template>
      <span v-for="credential in expired" :key="credential.code" class="cred-chip expired">
        {{ credential.code }} · {{ credential.scopes.join('、') }} · 已于 {{ credential.validTo }} 到期（仅查看）
      </span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { OPERATORS, ROLE_LABEL, type OperatorRole } from '@/data/auth'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()
const operators = OPERATORS

const active = computed(() => store.activeCredentials)
const expired = computed(() => store.expiredCredentials)

function roleLabelOf(role: OperatorRole): string {
  return ROLE_LABEL[role]
}

function onSwitch(event: Event) {
  store.switchOperator((event.target as HTMLSelectElement).value)
}
</script>

<style scoped>
.auth-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 12px;
}
.auth-id { display: flex; align-items: center; gap: 6px; }
.auth-id select { padding: 4px 6px; font-size: 12px; }
.auth-cred { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.auth-label { color: var(--muted); }
.cred-chip { border-radius: 999px; padding: 2px 10px; }
.cred-chip.valid { background: #e7f6ec; color: #157347; }
.cred-chip.expired { background: #fdecec; color: #b42318; }
.cred-chip.empty { background: #eef2f7; color: var(--muted); }
</style>
