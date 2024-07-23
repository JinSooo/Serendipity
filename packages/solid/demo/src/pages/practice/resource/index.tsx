import { For, Match, Suspense, Switch, createResource, createSignal } from 'solid-js'

import PracticeWrapper from '../wrapper'
import Video from './components/Video'
import { getVideoList } from './index.data'

export default function Resource() {
  const [videoListParam, setVideoListParam] = createSignal({ page: 1, size: 10 })
  // 异步资源Hook
  const [videoList] = createResource(videoListParam, getVideoList)

  return (
    <PracticeWrapper>
      <h3 class='text-lg font-bold'>Resource</h3>

      <div class='flex gap-10 justify-center'>
        <button
          type='button'
          // 两种class的使用
          class='border rounded-lg px-2 border-gray-900'
          classList={{ 'cursor-not-allowed': videoListParam().page <= 1 }}
          disabled={videoListParam().page <= 1}
          onClick={() => setVideoListParam(videoListParam => ({ ...videoListParam, page: videoListParam.page - 1 }))}
        >
          Prev
        </button>
        <Suspense fallback={<span>Loading...</span>}>
          <Switch>
            <Match when={videoList.error}>
              <div>Error: {videoList.error()}</div>
            </Match>
            <Match when={videoList()}>
              <div class='flex flex-col gap-4'>
                <For each={videoList().result.list}>
                  {video => {
                    return <Video video={video} />
                  }}
                </For>
              </div>
            </Match>
          </Switch>
        </Suspense>
        <button
          type='button'
          class='border rounded-lg px-2 border-gray-900'
          onClick={() => setVideoListParam(videoListParam => ({ ...videoListParam, page: videoListParam.page + 1 }))}
        >
          Next
        </button>
      </div>
    </PracticeWrapper>
  )
}
