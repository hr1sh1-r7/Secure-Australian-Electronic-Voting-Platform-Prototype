// App shell: navigation, routing and session bar.
// Built by Muzammil Malek (s4175334) for the whole team's platform.
import { state, h, clear } from './core.js'
import { checkSession, renderSessionBar } from './session.js'
import home from './views/home.js'
import signIn from './views/signIn.js'
import vote from './views/vote.js'
import verify from './views/verify.js'
import polling from './views/polling.js'
import mission from './views/mission.js'
import recount from './views/recount.js'
import audit from './views/audit.js'
import alerts from './views/alerts.js'
import tally from './views/tally.js'

const NAV = [
  { group: 'Overview', items: [
    { path: '/', label: 'How it works', view: home }
  ] },
  { group: 'Voters', items: [
    { path: '/sign-in', label: 'Sign in', reqs: 'SR-11, SR-12', view: signIn },
    { path: '/vote', label: 'Cast your vote', reqs: 'SR-05, SR-07, SR-10', view: vote },
    { path: '/verify', label: 'Check a receipt', reqs: 'SR-07', view: verify }
  ] },
  { group: 'Polling places', items: [
    { path: '/polling', label: 'Polling terminal', reqs: 'SR-13, SR-14, SR-16', view: polling },
    { path: '/mission', label: 'Diplomatic missions', reqs: 'SR-06', view: mission }
  ] },
  { group: 'Election officials', items: [
    { path: '/recount', label: 'Recount and results', reqs: 'SR-15', view: recount }
  ] },
  { group: 'Auditors', items: [
    { path: '/audit', label: 'Audit log', reqs: 'SR-09', view: audit },
    { path: '/alerts', label: 'Security alerts', reqs: 'SR-11', view: alerts },
    { path: '/tally', label: 'Ballot integrity', reqs: 'SR-10', view: tally }
  ] }
]
const ROUTES = new Map(NAV.flatMap((g) => g.items).map((i) => [i.path, i]))

const nav = document.getElementById('nav')
const main = document.getElementById('main')
const menuButton = document.querySelector('.menu-button')

function renderNav(current) {
  clear(nav, h('div', { class: 'nav-inner' }, NAV.map((g) =>
    h('section', { class: 'nav-group' },
      h('h2', null, g.group),
      h('ul', null, g.items.map((i) => h('li', null,
        h('a', { href: '#' + i.path, 'aria-current': i.path === current ? 'page' : null },
          i.label, i.reqs ? h('span', { class: 'reqs' }, i.reqs) : null))))))))
}

let cleanup = null
async function route() {
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0]
  const item = ROUTES.get(path) || ROUTES.get('/')
  if (typeof cleanup === 'function') cleanup()
  cleanup = null

  renderNav(item.path)
  nav.classList.remove('open')
  menuButton.setAttribute('aria-expanded', 'false')
  document.title = `${item.label} – Secure Voting Platform`

  clear(main)
  cleanup = await item.view(main)
  main.focus({ preventScroll: true })
  window.scrollTo(0, 0)
}

menuButton.addEventListener('click', () => {
  const open = nav.classList.toggle('open')
  menuButton.setAttribute('aria-expanded', String(open))
})

window.addEventListener('hashchange', route)

;(async () => {
  await checkSession()
  renderSessionBar()
  route()
})()

export { state }
