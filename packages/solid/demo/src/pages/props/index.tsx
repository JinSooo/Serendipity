import { createSignal } from 'solid-js'
import Child from './child'

export default function Props() {
  const [name, setName] = createSignal('JinSo')
  const [age, setAge] = createSignal(23)

  const update = () => {
    setName('Jason')
    setAge(99)
  }

  return (
    <section class='text-gray-700 p-8'>
      <Child name={name()} age={age()} />
      <button type='button' onClick={update}>
        Update
      </button>
    </section>
  )
}
