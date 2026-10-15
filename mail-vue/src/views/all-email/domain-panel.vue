<template>
  <div class="domain-panel">
    <div class="domain-panel-title">{{ $t('domain') }}</div>
    <div class="domain-list">
      <div
          :class="['domain-item', { active: modelValue == null }]"
          @click="select(null)"
      >
        {{ $t('allDomains') }}
      </div>
      <div
          v-for="item in domains"
          :key="item"
          :class="['domain-item', { active: modelValue === item }]"
          :title="item"
          @click="select(item)"
      >
        {{ item }}
      </div>
    </div>
  </div>
</template>

<script setup>
defineOptions({
  name: 'all-email-domain-panel'
})

defineProps({
  domains: {
    type: Array,
    default: () => []
  },
  modelValue: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

function select(domain) {
  emit('update:modelValue', domain)
  emit('change', domain)
}
</script>

<style scoped lang="scss">
.domain-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 180px;
  border-right: 1px solid var(--el-border-color-light);
  overflow: hidden;
}

.domain-panel-title {
  padding: 12px 16px 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.domain-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px 8px;
}

.domain-item {
  padding: 8px 12px;
  margin-bottom: 2px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    background-color: var(--el-fill-color-light);
  }

  &.active {
    background-color: var(--el-color-primary-light-9);
    color: var(--el-color-primary);
  }
}
</style>
