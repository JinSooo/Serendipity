import "../dist/dev.js";
import { createSignal, createEffect, createMemo, createResource } from "../dist/solid.js";

const getVideoList = async (param = {page: 0,
  size: 10,}) => {
  debugger
  const res = await fetch(`https://api.apiopen.top/api/getHaoKanVideo?page=${param.page}&size=${param.size}`)
  const data = await res.json()
  return data
}

debugger
const [page, setPage] = createSignal(0);
const [data, { mutate, refetch }] = createResource(page,(page) => getVideoList({page}));

createEffect(() => {
  debugger
  console.log('data.state', data.state)
  console.log('data.loading', data.loading)
  console.log('data.error', data.error)
  console.log('data.latest', data.latest)
  console.log('data', data())
  console.log('-----------------------------------------------')
})

setTimeout(() => {
  debugger
  setPage(1)
  // mutate(1)
}, 1000)
