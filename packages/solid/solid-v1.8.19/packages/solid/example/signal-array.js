import "../dist/dev.js";
import { createSignal, createEffect, createMemo, createResource, mapArray } from "../dist/solid.js";

const [arr, setArr] = createSignal([{
  id: 1,
  name: 'test1',
  desc: 'descdesc'
}, {
  id: 2,
  name: 'test2',
  desc: 'descdesc2'
}])

// const reactiveArr = arr.map((model) => {
//   const [name, setName] = createSignal(model.name)
//   const [description, setDescription] = createSignal(model.desc)
//   return {
//     id: model.id,
//     get name() {
//       return name()
//     },
//     get desc() {
//       return description()
//     },
//     setName,
//     setDescription,
//   }
// })

debugger
const reactiveArr = mapArray(arr, (model) => {
  const [name, setName] = createSignal(model.name)
  const [description, setDescription] = createSignal(model.desc)
  return {
    id: model.id,
    get name() {
      return name()
    },
    get desc() {
      return description()
    },
    setName,
    setDescription,
  }
})

createEffect(() => {
  console.log('reactiveArr', reactiveArr())
})

createEffect(() => {
  console.log('reactiveArr()[0].name', reactiveArr()[0].name)
  console.log('reactiveArr()[0].desc', reactiveArr()[0].desc)
})

setTimeout(() => reactiveArr()[0].setName(name => name + 'add'), 1000)
setTimeout(() => setArr(arr => [...arr, { id: 3, name: 'test3', desc: 'descdesc3' }]), 2000)
