import { effect } from './effect'
import { reactive } from './reactive'
import { proxyRefs, ref, toRef, toRefs } from './ref'

const p = reactive({ ok: true })
const refP = toRef(p, 'ok')
const proxyP = proxyRefs({ ...toRefs(p) })
const normal = ref(1)

effect(() => {
  console.log('p', normal.value)
})

normal.value = 2
