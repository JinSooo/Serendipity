import "../dist/dev.js";
import { createSignal, createEffect, createMemo, createResource } from "../dist/solid.js";

const getVideoList = async (param = {page: 0,
  size: 10,}) => {
  const res = await fetch(`https://api.apiopen.top/api/getHaoKanVideo?page=${param.page}&size=${param.size}`)
  const data = await res.json()
  return data
}

debugger
const [data] = createResource(() => getVideoList());

createEffect(() => {
  console.log('data', data())
})
