import { createSignal, createEffect, createMemo } from "../dist/solid.js";

// debugger
const [signal, trigger] = createSignal(1)
const memo = createMemo(() => signal() * 2)

// computation1
createEffect(() => {
  console.log('track1', signal())
})

// computation2
createEffect(() => {
  console.log('track2', memo())
})

trigger(Math.random() * 100)
