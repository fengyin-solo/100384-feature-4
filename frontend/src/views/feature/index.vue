<template>
  <section class="page" data-module="feature">
    <header class="page-head">
      <div>
        <h2>遗迹单位管理</h2>
        <p class="page-desc">维护遗迹，围绕遗迹编号、所属探方、遗迹类型、开口层位做登记、筛选与状态流转；清理轨道按开始清理 → 完成测绘 → 执行解剖顺向推进。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记遗迹</button>
        <button class="btn" type="button" @click="exportRows">导出遗迹单位清单</button>
      </div>
    </header>

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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button v-if="nextAction(row)" class="link" type="button" @click="openAction(nextAction(row)!, row)">
              {{ nextAction(row) }}
            </button>
            <button class="link" type="button" @click="openTrack(row)">清理轨道</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无遗迹单位数据，可先登记遗迹</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条遗迹单位记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="dialog.action" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3 class="modal-title">{{ dialog.action }} · {{ String(dialog.row?.['遗迹编号'] ?? '') }}</h3>
        <p class="modal-tip">阶段状态只能按「开始清理 → 完成测绘 → 执行解剖」顺向流转，提交前请落清以下信息。</p>
        <div class="modal-form">
          <label class="modal-field">
            <span>操作人</span>
            <input v-model="dialog.form.operator" placeholder="执行本阶段的操作人" />
          </label>
          <label class="modal-field">
            <span>完成时间</span>
            <input v-model="dialog.form.finishedAt" placeholder="YYYY-MM-DD HH:mm" />
          </label>
          <label v-if="dialog.action === '完成测绘'" class="modal-field wide">
            <span>现场测量结论</span>
            <textarea v-model="dialog.form.fieldConclusion" rows="2" placeholder="现场测量得到的结论"></textarea>
          </label>
          <label v-if="dialog.action === '完成测绘'" class="modal-field wide">
            <span>室内复核结论（与现场冲突时以此份为准）</span>
            <textarea v-model="dialog.form.reviewConclusion" rows="2" placeholder="室内复核后的最终结论"></textarea>
          </label>
          <label class="modal-field wide">
            <span>遗留问题</span>
            <textarea v-model="dialog.form.leftover" rows="2" placeholder="本阶段遗留问题，没有可填“无”；解剖阶段的遗留问题会同步到待复拍事项"></textarea>
          </label>
        </div>
        <p v-if="dialog.error" class="error-text">{{ dialog.error }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="submitAction">确认提交</button>
        </div>
      </div>
    </div>

    <div v-if="dialog.viewing" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <h3 class="modal-title">清理轨道 · {{ String(dialog.viewing['遗迹编号'] ?? '') }}</h3>
        <ol class="track-list">
          <li v-for="(stage, idx) in trackItems(dialog.viewing)" :key="stage.title" class="track-item">
            <div class="track-head">
              <strong>{{ idx + 1 }}. {{ stage.title }}</strong>
              <span :class="['track-badge', stage.done ? 'done' : 'todo']">
                {{ stage.done ? stage.target : '未开始' }}
              </span>
            </div>
            <dl v-if="stage.done" class="track-meta">
              <div><dt>操作人</dt><dd>{{ stage.operator || '—' }}</dd></div>
              <div><dt>完成时间</dt><dd>{{ stage.finishedAt || '—' }}</dd></div>
              <div><dt>遗留问题</dt><dd>{{ stage.leftover || '—' }}</dd></div>
            </dl>
            <dl v-if="stage.survey" class="track-meta">
              <div><dt>现场测量结论</dt><dd>{{ dialog.viewing['现场测量结论'] || '—' }}</dd></div>
              <div><dt>室内复核结论</dt><dd>{{ dialog.viewing['室内复核结论'] || '—' }}</dd></div>
              <div>
                <dt>采用结论</dt>
                <dd>
                  {{ dialog.viewing['测绘采用结论'] || '—' }}
                  <em v-if="dialog.viewing['测绘结论冲突']" class="conflict-note">（两份结论冲突，已按室内复核采用）</em>
                </dd>
              </div>
            </dl>
          </li>
        </ol>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="closeDialog">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { CLEANING_STAGES, nowStamp } from '@/data/feature-track'
import { useSessionStore } from '@/stores/session'
import type { CleaningActionDetail, EntryRow } from '@/data/types'

const meta = moduleMeta('feature')
const session = useSessionStore()
const columns = ["遗迹编号", "所属探方", "遗迹类型", "开口层位", "打破关系", "平面形状", "填土特征", "记录状态"]
const statuses = ["已揭露", "清理中", "已完绘", "已解剖", "已归档"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: "遗迹总数", value: rows.value.length },
  { label: "清理中遗迹", value: rows.value.filter((row) => String(row.status) === "清理中").length },
  { label: "已完绘遗迹", value: rows.value.filter((row) => String(row.status) === "已完绘").length },
])

type ActionDialog = {
  action: string
  row: EntryRow | null
  form: CleaningActionDetail
  error: string
}

const emptyForm = (): CleaningActionDetail => ({
  operator: session.operator,
  finishedAt: nowStamp(),
  leftover: '',
  fieldConclusion: '',
  reviewConclusion: '',
})

const dialog = reactive<{ action: string; row: EntryRow | null; form: CleaningActionDetail; error: string; viewing: EntryRow | null }>({
  action: '',
  row: null,
  form: emptyForm(),
  error: '',
  viewing: null,
})

// 顺向流转：每行只暴露当前状态允许的下一个阶段动作。
function nextAction(row: EntryRow): string {
  const status = String(row.status)
  if (status === '已揭露') return '开始清理'
  if (status === '清理中') return '完成测绘'
  if (status === '已完绘') return '执行解剖'
  return ''
}

function openAction(action: string, row: EntryRow) {
  dialog.action = action
  dialog.row = row
  dialog.form = emptyForm()
  dialog.error = ''
}

function openTrack(row: EntryRow) {
  dialog.viewing = row
}

function closeDialog() {
  dialog.action = ''
  dialog.row = null
  dialog.viewing = null
  dialog.error = ''
}

function submitAction() {
  if (!dialog.row) {
    return
  }
  const result = applyAction(meta.key, Number(dialog.row.id), dialog.action, { ...dialog.form })
  if (!result.ok) {
    dialog.error = result.message
    return
  }
  closeDialog()
  reload()
}

function trackItems(row: EntryRow) {
  return CLEANING_STAGES.map((stage) => {
    const finishedAt = row[`${stage.prefix}完成时间`]
    return {
      title: stage.action,
      target: stage.target,
      done: Boolean(finishedAt),
      operator: String(row[`${stage.prefix}操作人`] ?? ''),
      finishedAt: String(finishedAt ?? ''),
      leftover: String(row[`${stage.prefix}遗留问题`] ?? ''),
      survey: stage.action === '完成测绘' && Boolean(finishedAt),
    }
  })
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '遗迹登记入口尚未接入审批流'
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '遗迹单位列表读取失败'
  }
}

onMounted(reload)
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
  width: 560px;
  max-width: calc(100vw - 32px);
  max-height: 86vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
}
.modal-title { margin: 0 0 4px; font-size: 16px; }
.modal-tip { margin: 0 0 12px; color: var(--muted); font-size: 12px; }
.modal-form { display: flex; flex-wrap: wrap; gap: 10px 14px; }
.modal-field { flex: 1 1 240px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.modal-field.wide { flex-basis: 100%; }
.modal-field input, .modal-field textarea {
  font: inherit;
  color: #1f2937;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.track-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.track-item { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.track-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
.track-badge { font-size: 12px; border-radius: 999px; padding: 2px 10px; }
.track-badge.done { background: #e7f6ec; color: #177245; }
.track-badge.todo { background: #eef2f7; color: var(--muted); }
.track-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 12px; margin: 8px 0 0; font-size: 12px; }
.track-meta dt { color: var(--muted); margin: 0; }
.track-meta dd { margin: 2px 0 0; }
.conflict-note { color: #b42318; font-style: normal; }
</style>
