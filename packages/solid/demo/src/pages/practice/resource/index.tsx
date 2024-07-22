import { For, Match, Suspense, Switch, createResource, createSignal } from 'solid-js'

import { getVideoList } from './index.data'

export default function Resource() {
  const [videoListParam, setVideoListParam] = createSignal({ page: 1, size: 10 })
  const [videoList] = createResource(videoListParam, getVideoList)

  return (
    <section class='bg-gray-100 text-gray-700 p-8'>
      <h1 class='text-2xl font-bold'>Resource</h1>
      <p class='mt-4 mb-8'>This is the resource page.</p>

      <div class='flex gap-10 justify-center'>
        <button
          type='button'
          class='border rounded-lg px-2 border-gray-900'
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
                  {(video, index) => {
                    return (
                      <a href={video.coverUrl} class='flex'>
                        <span class='mr-2'>{videoListParam().page * 10 + index()}.</span>
                        <div>{video.title}</div>
                        <div>-- {video.userName}</div>
                      </a>
                    )
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
    </section>
  )
}
