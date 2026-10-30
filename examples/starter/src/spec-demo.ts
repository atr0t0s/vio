import { createApp, defineComponent } from '@atrotos/vio'
import { defineCatalog, defineSpecView } from '@atrotos/vio/spec'
import { connectDevtools } from '@atrotos/vio-devtools/client'

// Generated-UI demo: the page starts empty. An agent reads the catalog from
// app.manifest().docs and fills the view with app.patchState('Screen', ops)
// (or the vio_state MCP tool).

interface Order { id: number; customer: string; total: number; shipped: boolean }

const Card = defineComponent({
  name: 'Card',
  render: (_s, ctx) => ({
    tag: 'section',
    props: { class: 'card' },
    children: [{ tag: 'h2', children: [String(ctx.props.title)] }, ctx.props.children as never]
  })
})

const Metric = defineComponent({
  name: 'Metric',
  render: (_s, ctx) => ({
    tag: 'div',
    props: { class: 'metric' },
    children: [{ tag: 'strong', children: [String(ctx.props.value)] }, String(ctx.props.label)]
  })
})

const catalog = defineCatalog({
  components: {
    Card: { component: Card, doc: 'Titled panel', props: { 'title!': 'string' }, children: true },
    Metric: { component: Metric, doc: 'Big number with a label', props: { 'label!': 'string', 'value!': 'any' } }
  }
})

const actions = {
  ship: (s: Record<string, unknown>, id: unknown) => ({
    ...s,
    orders: (s.orders as Order[]).map(o => (o.id === id ? { ...o, shipped: !o.shipped } : o))
  })
}

const Screen = defineSpecView({ name: 'Screen', catalog, actions: Object.keys(actions) })

const Empty = defineComponent({
  name: 'Page',
  render: () => ({
    tag: 'main',
    children: [
      { tag: Screen },
      { tag: 'p', props: { class: 'empty' }, children: ['Spec view above is filled by an agent via patchState.'] }
    ]
  })
})

const orders: Order[] = [
  { id: 1, customer: 'Ada', total: 120, shipped: false },
  { id: 2, customer: 'Grace', total: 80, shipped: true },
  { id: 3, customer: 'Linus', total: 45, shipped: false }
]

const app = createApp({
  root: '#app',
  routes: [{ path: '/', component: Empty }],
  store: {
    state: { orders, revenue: orders.reduce((n, o) => n + o.total, 0), open: 2 },
    actions,
    meta: { ship: { params: 'id:number', doc: 'Toggle shipped' } }
  }
})

;(window as any).vio = app
app.mount()
connectDevtools(app)
