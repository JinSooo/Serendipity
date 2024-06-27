import { effect } from './effect'
import { reactive } from './reactive'

const data = { ok: true, text: 'hello', count: 0, foo: { test: true } }

const obj = reactive(data)
// const obj = shallowReactive(data)

effect(() => {
  console.log(obj.foo.test)
})

obj.foo.test = false
