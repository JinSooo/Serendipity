import { createSignal, createEffect } from "../dist/solid.js";

debugger
const [signal1, trigger1] = createSignal(1)
const [signal2, trigger2] = createSignal('1')

// computation1
createEffect(() => {
  console.log('track1', signal1())
})

// computation2
createEffect(() => {
  console.log('track2', signal2())
})

trigger1(Math.random() * 100)
trigger2(`${Math.random() * 100}`)
