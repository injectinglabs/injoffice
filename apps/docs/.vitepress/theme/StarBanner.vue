<script setup lang="ts">
import { onMounted, ref } from 'vue'

// Same ask as the rest of injoffice.com: closing it is remembered per browser, and the star
// count only shows once it is large enough to help.
const KEY = 'injoffice-star-banner'
const visible = ref(false)
const count = ref('')

onMounted(() => {
  let dismissed = false
  try { dismissed = localStorage.getItem(KEY) === 'dismissed' } catch {}
  visible.value = !dismissed
  if (dismissed) return
  fetch('https://api.github.com/repos/injectinglabs/injoffice', { headers: { Accept: 'application/vnd.github+json' } })
    .then(response => (response.ok ? response.json() : null))
    .then(repo => {
      const stars = Number(repo?.stargazers_count)
      if (!Number.isFinite(stars) || stars < 50) return
      count.value = stars >= 1000 ? (Math.round(stars / 100) / 10).toString().replace(/\.0$/, '') + 'k' : String(stars)
    })
    .catch(() => {})
})

function close() {
  visible.value = false
  try { localStorage.setItem(KEY, 'dismissed') } catch {}
}
</script>

<template>
  <aside v-if="visible" class="star-banner" aria-label="Support InjOffice">
    <p>Enjoying InjOffice? Rate us with a star on GitHub.</p>
    <a class="star-button" href="https://github.com/injectinglabs/injoffice" target="_blank" rel="noopener">
      <span><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.3L12 17.1l-5.6 3 1.1-6.3L2.9 9.4l6.3-.9L12 2.8z" /></svg>Star on GitHub</span>
      <span v-if="count" class="star-count" :aria-label="`${count} stars`">{{ count }}</span>
    </a>
    <button class="star-close" type="button" aria-label="Close" @click="close">&times;</button>
  </aside>
</template>

<style scoped>
.star-banner { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 16px; padding: 8px 24px; min-height: 48px; background: #eef6f1; border-bottom: 1px solid #d5e9dc; font-size: 14px; color: #3a3f4a; position: relative; z-index: 40; }
.star-banner p { margin: 0; flex: 1 1 280px; }
.star-button { display: inline-flex; align-items: stretch; border: 1px solid #cdd2da; border-radius: 8px; background: #fff; color: #15171c; text-decoration: none; font-weight: 600; font-size: 13px; line-height: 1; }
.star-button:hover { border-color: #9aa3b1; }
.star-button span { display: inline-flex; align-items: center; gap: 7px; padding: 8px 11px; }
.star-button svg { width: 15px; height: 15px; color: #c98a00; }
.star-count { border-left: 1px solid #e3e6eb; color: #5f6673; font-variant-numeric: tabular-nums; }
.star-close { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 8px; margin-left: auto; background: transparent; color: #5f6673; cursor: pointer; font-size: 20px; line-height: 1; }
.star-close:hover { background: #dcefe3; color: #15171c; }
.star-button:focus-visible, .star-close:focus-visible { outline: 2px solid #0c7a45; outline-offset: 2px; }
</style>
