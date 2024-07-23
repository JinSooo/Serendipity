import { Show, createSignal } from 'solid-js'

import clickOutside from '../../directive/clickOutside'
import type { Video as VideoType } from '../../index.data'
import UserInfo from './UserInfo'

interface VideoProps {
  video: VideoType
}

export default function Video(props: VideoProps) {
  const [show, setShow] = createSignal(false)

  // 派生Signal
  const durationTooltip = () => {
    const minute = +props.video.duration.split(':')[0]
    return minute < 5 ? '<5min' : props.video.duration
  }

  const handleClick = (type: 'delegate' | 'native', e) => {
    setShow(true)
    console.log(type, 'videoInfo', props.video)
  }

  return (
    <div
      // href={props.video.playUrl}
      class='relative flex w-80 h-96'
      style={{ background: `url(${props.video.coverUrl})` }}
      // 委托事件
      onClick={[handleClick, 'delegate']}
      // 原生事件
      on:click={e => handleClick('native', e)}
      // 指令
      use:clickOutside={() => setShow(false)}
    >
      <div class='absolute w-full bottom-4 left-4 flex flex-col gap-2'>
        <div class='flex justify-between items-center'>
          <span>{props.video.title}</span>
          <Show when={show()}>
            <span class='text-xs'>{durationTooltip()}</span>
          </Show>
        </div>
        <UserInfo userName={props.video.userName} userPic={props.video.userPic} />
      </div>
    </div>
  )
}
