import DefaultTheme from 'vitepress/theme'
import FlowHome from './FlowHome.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('FlowHome', FlowHome)
  },
}
