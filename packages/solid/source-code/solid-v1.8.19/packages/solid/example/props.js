import { createEffect, createSignal, mergeProps, splitProps } from "../dist/solid.js";

const [s, set] = createSignal(undefined);
// const props = {
//   get name() {
//     return s();
//   },
//   get age() {
//     return 26;
//   }
// }

// const props2 = {
//   get name2() {
//     return s();
//   },
//   get age2() {
//     return 26;
//   }
// }

debugger;
// const mergedProps = mergeProps({name: 'default'}, props)
// // const mergedProps = mergeProps(props, s)

// createEffect(() => {
//   console.log('mergeProps', mergedProps.name)
// })

// setTimeout(() => {
//   set('Tom')
// }, 1000)

const props = { a: 1, b: 2, c: 3, d: 4, e: 5, foo: "bar" };

const [local, others] = splitProps(props, ["a", "e"], ["b", "c", "d"]);

createEffect(() => {
  console.log("others", others);
});

createEffect(() => {
  console.log("nameProps", local.name);
});

// setTimeout(() => {
//   set('Tom')
// }, 1000)
