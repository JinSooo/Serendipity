import type { Video as VideoType } from '../../index.data'
import UserInfo from './UserInfo'

interface VideoProps {
  video: VideoType
}

export default function Video(props: VideoProps) {
  return (
    <a
      href={props.video.playUrl}
      class='relative flex w-80 h-96'
      style={{ background: `url(${props.video.coverUrl})` }}
    >
      <div class='absolute w-full bottom-4 left-4 flex flex-col gap-2'>
        <div class='flex justify-between items-center'>
          <span>{props.video.title}</span>
          <span class='text-xs'>{props.video.duration}</span>
        </div>
        <UserInfo userName={props.video.userName} userPic={props.video.userPic} />
      </div>
    </a>
  )
}
