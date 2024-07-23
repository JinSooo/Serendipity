interface ResponseWrapper<T> {
  code: number
  message: string
  result: T
}

export interface Video {
  id: number
  title: string
  userName: string
  userPic: string
  coverUrl: string
  playUrl: string
  duration: string
}

/**
 * 获取短视频列表
 */
export const getVideoList = async ({
  page = 0,
  size = 10,
}: {
  page?: number
  size?: number
}): Promise<ResponseWrapper<{ list: Video[]; total: number }>> => {
  const res = await fetch(`https://api.apiopen.top/api/getHaoKanVideo?page=${page}&size=${size}`)
  const data = await res.json()
  return data
}
