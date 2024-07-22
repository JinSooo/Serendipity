import type { RouteDefinition } from '@solidjs/router'
import { lazy } from 'solid-js'

import AboutData from '../pages/about/index.data'
import Home from '../pages/home'

export const routes: RouteDefinition[] = [
  {
    path: '/',
    component: Home,
  },
  {
    path: '/about',
    component: lazy(() => import('../pages/about')),
    data: AboutData,
  },
  {
    path: '**',
    component: lazy(() => import('../pages/404')),
  },
]
