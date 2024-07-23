import { createSignal } from 'solid-js'
import PracticeWrapper from '../wrapper'

export default function State() {
  const [count, setCount] = createSignal(0)

  return (
    <PracticeWrapper>
      <h3 class='text-lg font-bold'>State</h3>

      <div class='flex items-center space-x-2'>
        <button type='button' class='border rounded-lg px-2 border-gray-900' onClick={() => setCount(count() - 1)}>
          -
        </button>

        <output class='p-10px'>Count: {count()}</output>

        <button type='button' class='border rounded-lg px-2 border-gray-900' onClick={() => setCount(count() + 1)}>
          +
        </button>
      </div>
    </PracticeWrapper>
  )
}
