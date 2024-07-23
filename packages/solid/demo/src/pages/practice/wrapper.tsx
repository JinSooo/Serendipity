import { Link } from '@solidjs/router'
import type { ParentProps } from 'solid-js'

export default function PracticeWrapper(props: ParentProps) {
  return (
    <section class='bg-gray-100 text-gray-700 p-8'>
      <h1 class='text-2xl font-bold'>Practice</h1>
      <p class='mt-4'>This is the practice page.</p>

      <div class='flex items-center space-x-2 mt-2 mb-4'>
        <button type='button' class='border rounded-lg px-2 border-gray-900'>
          <Link href='/practice/state' class='no-underline hover:underline'>
            State
          </Link>
        </button>
        <button type='button' class='border rounded-lg px-2 border-gray-900'>
          <Link href='/practice/resource' class='no-underline hover:underline'>
            Resource
          </Link>
        </button>
      </div>

      {props.children}
    </section>
  )
}
