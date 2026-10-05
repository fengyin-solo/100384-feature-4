<template>
  <section class="page" data-module="feature">
    <header class="page-head">
      <div>
        <h2>遗迹单位管理</h2>
        <p class="page-desc">维护遗迹，围绕遗迹编号、所属探方、遗迹类型、开口层位做登记、筛选与状态流转；清理轨道按开始清理→完成测绘→执行解剖顺向推进，逐段落清操作人、完成时间与遗留问题。</p>
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
          <th>清理轨道</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '开口层位' && isLegacyOpening(row)">
              <span class="legacy-hint" title="旧遗迹缺少开口层位，沿用历史记录">未登记（沿用历史记录）</span>
            </template>
            <template v-else>{{ displayCell(row, column) }}</template>
          </td>
          <td>
            <ul class="track-list">
              <li v-for="track in trackEntries(row)" :key="track.name" class="track-item">
                <span class="track-name">{{ track.name }}</span>
                <span v-if="track.done" class="track-done">
                  {{ track.operator }} · {{ track.time }}
                </span>
                <span v-else class="track-pending">待进行</span>
                <p v-if="track.done && track.issue" class="track-issue" :title="track.issue">
                  遗留：{{ track.issue }}
                </p>
                <p v-if="track.done && track.conclusion" class="track-conclusion" :title="track.conclusion">
                  {{ track.conclusion }}
                </p>
              </li>
            </ul>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="nextAction(row.status)"
              class="link"
              type="button"
              @click="openAction(String(nextAction(row.status)), row)"
            >
              {{ nextAction(row.status) }}
            </button>
            <span v-else class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无遗迹单位数据，可先登记遗迹</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条遗迹单位记录</span>
      <span v-if="feedback" :class="feedbackOk ? 'ok-text' : 'error-text'">{{ feedback }}</span>
    </footer>

    <div v-if="dialog.action" class="modal-mask" @click.self="closeDialog">
      <form class="modal-panel" @submit.prevent="submitDialog">
        <h3 class="modal-title">{{ dialog.action }} · {{ dialog.code }}</h3>
        <label v-for="field in dialogFields" :key="field.key" class="modal-field">
          <span>{{ field.label }}</span>
          <textarea
            v-if="field.multiline"
            v-model="dialog.form[field.key]"
            rows="2"
            :placeholder="field.placeholder"
          ></textarea>
          <input v-else v-model="dialog.form[field.key]" :placeholder="field.placeholder" />
        </label>
        <p class="modal-tip">完成时间由系统在提交时自动记录；清理轨道只能按开始清理→完成测绘→执行解剖顺向流转。</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="submit">确认提交</button>
        </div>
      </form>
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
import { useSessionStore } from '@/stores/session'
import type { ActionExtra, EntryRow } from '@/data/types'

const session = useSessionStore()
const meta = moduleMeta('feature')
const columns = ["遗迹编号", "所属探方", "遗迹类型", "开口层位", "打破关系", "平面形状", "填土特征", "记录状态"]
const statuses = ["已揭露", "清理中", "已完绘", "已解剖", "已归档"]
// 清理轨道顺向顺序：当前状态对应的下一个动作，其它动作不展示也不允许提交。
const NEXT_ACTION: Record<string, string> = {
  "已揭露": "开始清理",
  "清理中": "完成测绘",
  "已完绘": "执行解剖",
}
const stats = [{"label": "遗迹总数", "value": 0}, {"label": "清理中遗迹", "value": 0}, {"label": "已完绘遗迹", "value": 0}]

type DialogFieldKey = 'operator' | 'issue' | 'fieldSurvey' | 'labReview'
type DialogField = { key: DialogFieldKey; label: string; placeholder: string; multiline?: boolean }

const rows = ref<EntryRow[]>([])
const total = ref(0)
const feedback = ref('')
const feedbackOk = ref(false)
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const dialog = reactive<{ id: number | null; code: string; action: string; form: Record<DialogFieldKey, string> }>({
  id: null,
  code: '',
  action: '',
  form: { operator: '', issue: '', fieldSurvey: '', labReview: '' },
})

const dialogFields = computed<DialogField[]>(() => {
  const fields: DialogField[] = [
    { key: 'operator', label: '操作人', placeholder: '默认为当前值班人员' },
  ]
  if (dialog.action === '完成测绘') {
    fields.push(
      { key: 'fieldSurvey', label: '现场测量结论', placeholder: '填写现场测量得到的结论', multiline: true },
      { key: 'labReview', label: '室内复核结论', placeholder: '填写室内复核后的结论；与现场冲突时以此为准', multiline: true },
    )
  }
  fields.push({ key: 'issue', label: '遗留问题', placeholder: '没有遗留问题可填「无」', multiline: true })
  return fields
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function nextAction(status: string | number | boolean): string | undefined {
  return NEXT_ACTION[String(status)]
}

function displayCell(row: EntryRow, column: string): string {
  const value = row[column]
  return value === undefined || value === null || String(value) === '' ? '—' : String(value)
}

// 旧遗迹缺少开口层位时沿用历史记录兼容：不阻断流程，仅在列表里标注。
function isLegacyOpening(row: EntryRow): boolean {
  const value = row['开口层位']
  return value === undefined || value === null || String(value).trim() === ''
}

type TrackEntry = { name: string; done: boolean; operator?: string; time?: string; issue?: string; conclusion?: string }

function trackEntries(row: EntryRow): TrackEntry[] {
  const surveyIssue = String(row['测绘遗留问题'] ?? '')
  return [
    {
      name: '开始清理',
      done: Boolean(row['清理时间']),
      operator: String(row['清理操作人'] ?? ''),
      time: String(row['清理时间'] ?? ''),
      issue: String(row['清理遗留问题'] ?? ''),
    },
    {
      name: '完成测绘',
      done: Boolean(row['测绘时间']),
      operator: String(row['测绘操作人'] ?? ''),
      time: String(row['测绘时间'] ?? ''),
      issue: surveyIssue,
      conclusion: row['测绘采用结论'] ? `采用结论：${String(row['测绘采用结论'])}` : '',
    },
    {
      name: '执行解剖',
      done: Boolean(row['解剖时间']),
      operator: String(row['解剖操作人'] ?? ''),
      time: String(row['解剖时间'] ?? ''),
      issue: String(row['解剖遗留问题'] ?? ''),
    },
  ]
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  feedbackOk.value = false
  feedback.value = '遗迹登记入口尚未接入审批流'
}

function openAction(action: string, row: EntryRow) {
  feedback.value = ''
  dialog.id = Number(row.id)
  dialog.code = String(row['遗迹编号'] ?? '')
  dialog.action = action
  dialog.form = {
    operator: session.operator,
    issue: '',
    fieldSurvey: '',
    labReview: '',
  }
}

function closeDialog() {
  dialog.id = null
  dialog.action = ''
  dialog.code = ''
}

function submitDialog() {
  if (dialog.id === null || !dialog.action) {
    return
  }
  const payload: ActionExtra = {
    operator: dialog.form.operator,
    issue: dialog.form.issue,
  }
  if (dialog.action === '完成测绘') {
    payload.fieldSurvey = dialog.form.fieldSurvey
    payload.labReview = dialog.form.labReview
  }
  const result = applyAction(meta.key, dialog.id, dialog.action, payload)
  feedbackOk.value = result.ok
  feedback.value = result.message
  if (result.ok) {
    closeDialog()
  }
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    feedbackOk.value = false
    feedback.value = error instanceof Error ? error.message : '遗迹单位列表读取失败'
  }
}

onMounted(reload)
</script>
