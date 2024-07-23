import { Link } from '@solidjs/router'
import { type ParentProps, createEffect } from 'solid-js'

export default function Practice(props: ParentProps) {
  createEffect(() => {
    console.log('🚀 ~ Practice ~ props:', props)
  })

  return (
    <section class='bg-gray-100 text-gray-700 p-8'>
      <h1 class='text-2xl font-bold'>Practice</h1>

      <div class='flex items-center space-x-2 mt-2 mb-4'>
        <button type='button' class='border rounded-lg px-2 border-gray-900'>
          <Link href='/practice/state' class='no-underline hover:underline'>
            state
          </Link>
        </button>

        <button type='button' class='border rounded-lg px-2 border-gray-900'>
          <Link href='/practice/test1' class='no-underline hover:underline'>
            test1
          </Link>
        </button>
      </div>

      {props.children}
    </section>
  )
}
