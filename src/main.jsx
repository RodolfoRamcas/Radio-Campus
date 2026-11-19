import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/space-grotesk'
import './styles/base.css'
import { Home } from './pages/Home.jsx'

// Cada superficie carga solo su código: el celular no descarga el panel de administración.
const Screen = lazy(() => import('./pages/Screen.jsx').then((m) => ({ default: m.Screen })))
const Vote = lazy(() => import('./pages/Vote.jsx').then((m) => ({ default: m.Vote })))
const Admin = lazy(() => import('./pages/admin/Admin.jsx').then((m) => ({ default: m.Admin })))

const ROUTES = { '/pantalla': Screen, '/votar': Vote, '/admin': Admin }
const path = location.pathname.replace(/\/+$/, '') || '/'
const Page = ROUTES[path] ?? Home
document.body.dataset.surface = { '/pantalla': 'screen', '/votar': 'vote', '/admin': 'admin' }[path] ?? 'home'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </StrictMode>,
)
