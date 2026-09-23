import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import StarBanner from './StarBanner.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, { 'layout-top': () => h(StarBanner) }),
}
