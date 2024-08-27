import "../dist/dev.js";
import { createSignal, createEffect, createMemo, createResource, createSelector, on } from "../dist/solid.js";

const list = [{
  id: 0,
  name: 'a',
}, {
  id: 1,
  name: 'b',
}, {
  id: 2,
  name: 'c',
}, {
  id: 3,
  name: 'd',
}]

const [selectedId, setSelectedId] = createSignal(0)
const isIdSelected = createSelector(selectedId)

for (const item of list) {
  // 两种方式都行，on 的话，可以显示标明依赖，看得更清晰
  createEffect(
    () => {
      console.log(isIdSelected(item.id), item)
    }
  )
  // createEffect(on(
  //   () => isIdSelected(item.id),
  //   isSelected => {
  //     console.log(isSelected, item)
  //   }
  // ))
}

setTimeout(() => {
  setSelectedId(2)
}, 1000)

/**
 * 在 setSelectedId 之后，只有 0 和 2 的 Computation 会发生更新，实现了 O(2)
 * 实现的方式很巧妙，Signal 与 Computation 的完美结合，
 * 在 isIdSelected 的时候对每个 key 进行 Computation 的收集，再在更新的时候，对每个 key 进行判断，找到对应的 Computation 进行更新
 */
