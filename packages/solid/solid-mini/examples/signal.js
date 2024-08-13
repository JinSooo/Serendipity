import { createSignal, createEffect } from '../packages/solid/src/reactive/dist/signal.js'

const [track, trigger] = createSignal(1)

console.log(track())

createEffect(() => {
  console.log(track() * 2)
})

setTimeout(() => {
  trigger(3)
}, 1000)
