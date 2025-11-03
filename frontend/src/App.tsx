import React, { useEffect, useState } from 'react'

type Item = {
  id: number
  name: string
  createdAt: string
}

export default function App() {
  const [items, setItems] = useState<Item[]>([])
  const [name, setName] = useState('')

  useEffect(() => {
    fetch('/api/items')
      .then((r) => r.json())
      .then(setItems)
      .catch(console.error)
  }, [])

  async function add() {
    if (!name) return
    const res = await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    const item = await res.json()
    setItems((s) => [item, ...s])
    setName('')
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Bundestagswahl — Demo</h1>
      <div style={{ marginBottom: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New item name" />
        <button onClick={add} style={{ marginLeft: 8 }}>Add</button>
      </div>
      <ul>
        {items.map((it) => (
          <li key={it.id}>
            {it.name} <small>({new Date(it.createdAt).toLocaleString()})</small>
          </li>
        ))}
      </ul>
    </div>
  )
}
