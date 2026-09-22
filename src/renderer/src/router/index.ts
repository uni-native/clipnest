import { readonly, ref } from 'vue'

   
                                             
                                                
   
export type RoutePath = '/' | '/settings'

function parseHash(): RoutePath {
  const h = window.location.hash.replace(/^#/, '').split('?')[0]
  return h.startsWith('/settings') ? '/settings' : '/'
}

const route = ref<RoutePath>(parseHash())
let listening = false

function onHashChange(): void {
  const next = parseHash()
  if (next !== route.value) route.value = next
}

export function startRouter(): void {
  if (listening) return
  listening = true
  window.addEventListener('hashchange', onHashChange)
  const next = parseHash()
  if (next !== route.value) route.value = next
}

export function navigate(path: RoutePath): void {
  if (window.location.hash !== `#${path}`) window.location.hash = path
}

export const currentRoute = readonly(route)
