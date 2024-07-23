import { splitProps } from 'solid-js'
import type { Video } from '../../index.data'

interface UserInfoProps {
  userName: Video['userName']
  userPic: Video['userPic']
  class?: string
}

export default function UserInfo(props: UserInfoProps) {
  const [local, user] = splitProps(props, ['class'])

  return (
    <div class={`flex items-center gap-4 ${local.class}`}>
      <img src={user.userPic} class='w-4 h-4 rounded-full' alt='userPic' />
      <span>{user.userName}</span>
    </div>
  )
}
