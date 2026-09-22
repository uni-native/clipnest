import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { startRouter } from './router'
import './styles.css'

const app = createApp(App)
app.use(createPinia())
startRouter()
app.mount('#app')
