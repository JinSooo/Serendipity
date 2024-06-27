import { effect } from './effect'
import { readonly } from './reactive'

const data = { ok: true, text: 'hello', count: 0, foo: { test: true } }

const obj = readonly(data)
// const obj = shallowReactive(data)

effect(() => {
  console.log(obj.foo.test)
})

obj.foo.test = false
