import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { supabase } from './supabase'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const SNAIL_SPEED = 0.00005

function moveSnailToward(snail, player) {
  const dx = player[0] - snail[0]
  const dy = player[1] - snail[1]
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < SNAIL_SPEED) return player
  return [
    snail[0] + (dx / dist) * SNAIL_SPEED,
    snail[1] + (dy / dist) * SNAIL_SPEED,
  ]
}

function App() {
  const [playerName, setPlayerName] = useState(localStorage.getItem('playerName') || '')
  const [roomCode, setRoomCode] = useState(localStorage.getItem('roomCode') || '')
  const [joined, setJoined] = useState(false)
  const [playerPos, setPlayerPos] = useState(null)
  const [snailPos, setSnailPos] = useState(null)
  const [otherSnails, setOtherSnails] = useState([])
  const [players, setPlayers] = useState({})
  const [trail, setTrail] = useState([])
  const [distance, setDistance] = useState(null)
  const snailRef = useRef(null)
  const playerRef = useRef(null)
  const playerIdRef = useRef(localStorage.getItem('playerId') || crypto.randomUUID())

  const handleJoin = async () => {
    if (!playerName || !roomCode) return
    localStorage.setItem('playerName', playerName)
    localStorage.setItem('roomCode', roomCode)
    localStorage.setItem('playerId', playerIdRef.current)
    setJoined(true)
  }

  useEffect(() => {
    if (!joined) return
    Notification.requestPermission()
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords
      const player = [latitude, longitude]
      setPlayerPos(player)
      playerRef.current = player

      await supabase.from('players').upsert({
        id: playerIdRef.current,
        name: playerName,
        room_code: roomCode,
        latitude,
        longitude,
      })

      const { data: existingSnail } = await supabase
        .from('snails')
        .select('*')
        .eq('player_id', playerIdRef.current)
        .single()

      let snailStart
      if (existingSnail) {
        snailStart = [existingSnail.latitude, existingSnail.longitude]
      } else {
        const angle = Math.random() * 2 * Math.PI
        const dist = (Math.random() * 400 + 100) / 111000
        snailStart = [latitude + Math.cos(angle) * dist, longitude + Math.sin(angle) * dist]
        await supabase.from('snails').insert({
          player_id: playerIdRef.current,
          room_code: roomCode,
          latitude: snailStart[0],
          longitude: snailStart[1],
          speed: SNAIL_SPEED,
        })
      }
      setSnailPos(snailStart)
      snailRef.current = snailStart
    })
  }, [joined])

  // 蝸牛移動
  useEffect(() => {
    if (!snailPos) return
    const interval = setInterval(async () => {
      const newSnail = moveSnailToward(snailRef.current, playerRef.current)
      snailRef.current = newSnail
      setSnailPos([...newSnail])
      setTrail(prev => [...prev, [...newSnail]].slice(-10))

      await supabase.from('snails').update({
        latitude: newSnail[0],
        longitude: newSnail[1],
      }).eq('player_id', playerIdRef.current)

      const dx = playerRef.current[0] - newSnail[0]
      const dy = playerRef.current[1] - newSnail[1]
      const distMeters = Math.sqrt(dx * dx + dy * dy) * 111000
      setDistance(Math.round(distMeters))

      if (distMeters < 20) {
        new Notification('🐌 The snail is coming!')
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [!!snailPos])

  // 監聽其他玩家蝸牛
  useEffect(() => {
    if (!joined) return
    const channel = supabase
      .channel('snails-room')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'snails',
        filter: `room_code=eq.${roomCode}`,
      }, (payload) => {
        if (payload.new.player_id !== playerIdRef.current) {
          setOtherSnails(prev => {
            const filtered = prev.filter(s => s.player_id !== payload.new.player_id)
            return [...filtered, payload.new]
          })
        }
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [joined])

  // 監聽玩家名字
  useEffect(() => {
    if (!joined) return
    supabase.from('players').select('*').eq('room_code', roomCode).then(({ data }) => {
      if (data) {
        const map = {}
        data.forEach(p => { map[p.id] = p.name })
        setPlayers(map)
      }
    })
    const channel = supabase.channel('players-room')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'players',
        filter: `room_code=eq.${roomCode}`,
      }, (payload) => {
        setPlayers(prev => ({ ...prev, [payload.new.id]: payload.new.name }))
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [joined])

  if (!joined) return (
    <div style={{
      background: '#0a0a0a', height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '16px',
      fontFamily: 'monospace', color: 'white'
    }}>
      <h1 style={{ color: '#ff2222', letterSpacing: '4px', marginBottom: '20px' }}>🐌 SNAIL STALKER</h1>
      <input
        placeholder="你的名字"
        value={playerName}
        onChange={e => setPlayerName(e.target.value)}
        style={{ padding: '12px', background: '#1a1a1a', border: '1px solid #333', color: 'white', borderRadius: '6px', width: '250px', fontSize: '16px' }}
      />
      <input
        placeholder="房間碼 (e.g. SNAIL123)"
        value={roomCode}
        onChange={e => setRoomCode(e.target.value.toUpperCase())}
        style={{ padding: '12px', background: '#1a1a1a', border: '1px solid #333', color: 'white', borderRadius: '6px', width: '250px', fontSize: '16px' }}
      />
      <button
        onClick={handleJoin}
        style={{ padding: '12px 32px', background: '#ff2222', color: 'white', border: 'none', borderRadius: '6px', fontSize: '16px', cursor: 'pointer', letterSpacing: '2px' }}
      >
        JOIN GAME
      </button>
    </div>
  )

  if (!playerPos) return (
    <div style={{ background: '#0a0a0a', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff2222', fontFamily: 'monospace', fontSize: '20px', letterSpacing: '4px' }}>
      LOCATING YOU...
    </div>
  )

  const isClose = distance !== null && distance < 100
  const isCritical = distance !== null && distance < 20

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative', background: '#0a0a0a' }}>
      {isClose && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, pointerEvents: 'none',
          boxShadow: `inset 0 0 ${isCritical ? '120px' : '60px'} ${isCritical ? 'rgba(255,0,0,0.8)' : 'rgba(255,0,0,0.35)'}`,
          animation: isCritical ? 'pulse 0.5s infinite alternate' : 'none'
        }} />
      )}

      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999,
        background: '#0d0d0d',
        borderBottom: `2px solid ${isCritical ? '#ff0000' : isClose ? '#880000' : '#222'}`,
        color: isCritical ? '#ff0000' : isClose ? '#ff4444' : '#aaaaaa',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: 'monospace', fontSize: '15px', letterSpacing: '2px',
        transition: 'all 0.5s'
      }}>
        <span style={{ color: '#ff2222', fontWeight: 'bold', fontSize: '18px' }}>🐌 SNAIL STALKER</span>
        <span style={{ color: '#666', fontSize: '13px' }}>Room: {roomCode}</span>
        <span>
          {distance === null ? 'CALCULATING...' : isCritical ? `⚠️ ${distance}m — RUN.` : `📍 ${distance}m`}
        </span>
      </div>

      <MapContainer center={playerPos} zoom={15} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />
        <Marker position={playerPos} icon={L.divIcon({
          html: `<div style="text-align:center; font-size: 32px; filter: drop-shadow(0 0 6px #00ffff)">👤<br/><span style="font-size:11px; color:#00ffff; font-family:monospace">${playerName.toUpperCase()}</span></div>`,
          iconSize: [80, 55],
          className: ''
        })}>
          <Popup>{playerName}</Popup>
        </Marker>
        {snailPos && (
          <Marker position={snailPos} icon={L.divIcon({
            html: `<div style="text-align:center; font-size: 40px; filter: drop-shadow(0 0 6px red)">🐌<br/><span style="font-size:11px; color:#ff4444; font-family:monospace">${playerName.toUpperCase()}'S SNAIL</span></div>`,
            iconSize: [100, 65],
            className: ''
          })}>
            <Popup>🐌 你的蝸牛</Popup>
          </Marker>
        )}
        {otherSnails.map(s => (
          <Marker key={s.player_id} position={[s.latitude, s.longitude]} icon={L.divIcon({
            html: `<div style="text-align:center; font-size: 40px; filter: drop-shadow(0 0 6px red)">🐌<br/><span style="font-size:11px; color:#ff4444; font-family:monospace">${(players[s.player_id] || '???').toUpperCase()}'S SNAIL</span></div>`,
            iconSize: [100, 65],
            className: ''
          })}>
            <Popup>🐌 {players[s.player_id] || '???'} 的蝸牛</Popup>
          </Marker>
        ))}
        {trail.length > 1 && (
          <Polyline positions={trail} color="#ff0000" opacity={0.6} dashArray="4,6" />
        )}
      </MapContainer>

      <style>{`
        @keyframes pulse {
          from { box-shadow: inset 0 0 120px rgba(255,0,0,0.6); }
          to { box-shadow: inset 0 0 120px rgba(255,0,0,0.9); }
        }
      `}</style>
    </div>
  )
}

export default App
