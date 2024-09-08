import { createEffect, createSignal, mergeProps, splitProps } from "../dist/solid.js";

const [s, set] = createSignal(undefined)
const props = {
  get name() {
    return s();
  },
  get age() {
    return 26;
  }
}

// const mergedProps = mergeProps({name: 'default'}, props)

// createEffect(() => {
//   console.log('mergeProps', mergedProps.name)
// })

const [local, others] = splitProps(props, ['name'])

createEffect(() => {
  console.log('others', others)
})

createEffect(() => {
  console.log('nameProps', local.name)
})

setTimeout(() => {
  set('Tom')
}, 1000)
