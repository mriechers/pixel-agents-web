import { useRef, useEffect } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import { TileType } from '../office/types.js'
import {
  MINIMAP_SCALE,
  MINIMAP_PADDING,
  MINIMAP_DOT_SIZE,
  MINIMAP_BG,
  MINIMAP_FLOOR_COLOR,
  MINIMAP_WALL_COLOR,
  MINIMAP_VIEWPORT_COLOR,
  TILE_SIZE,
} from '../constants.js'

/** Simple hash to hue for team colors */
function teamHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return ((hash % 360) + 360) % 360
}

const PALETTE_COLORS = ['#e06060', '#60a0e0', '#60c080', '#c080e0', '#e0c060', '#e08060']

interface MinimapProps {
  officeState: OfficeState
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  canvasWidth: number
  canvasHeight: number
}

export function Minimap({ officeState, zoom, panRef, canvasWidth, canvasHeight }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const layout = officeState.getLayout()
  const mapW = layout.cols * MINIMAP_SCALE + MINIMAP_PADDING * 2
  const mapH = layout.rows * MINIMAP_SCALE + MINIMAP_PADDING * 2

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let rafId = 0

    const render = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const currentLayout = officeState.getLayout()
      const tileMap = officeState.tileMap
      const cols = currentLayout.cols
      const rows = currentLayout.rows
      const w = cols * MINIMAP_SCALE + MINIMAP_PADDING * 2
      const h = rows * MINIMAP_SCALE + MINIMAP_PADDING * 2

      canvas.width = w
      canvas.height = h

      // Background
      ctx.fillStyle = MINIMAP_BG
      ctx.fillRect(0, 0, w, h)

      // Tiles
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const tile = tileMap[r]?.[c]
          if (tile === undefined || tile === TileType.VOID) continue
          ctx.fillStyle = tile === TileType.WALL ? MINIMAP_WALL_COLOR : MINIMAP_FLOOR_COLOR
          ctx.fillRect(
            MINIMAP_PADDING + c * MINIMAP_SCALE,
            MINIMAP_PADDING + r * MINIMAP_SCALE,
            MINIMAP_SCALE,
            MINIMAP_SCALE,
          )
        }
      }

      // Characters as dots
      for (const ch of officeState.characters.values()) {
        if (ch.matrixEffect === 'despawn') continue
        let color: string
        if (ch.teamName) {
          const hue = teamHue(ch.teamName)
          color = `hsl(${hue}, 70%, 65%)`
        } else {
          color = PALETTE_COLORS[ch.palette] || '#ffffff'
        }
        ctx.fillStyle = color
        const dotX = MINIMAP_PADDING + (ch.x / TILE_SIZE) * MINIMAP_SCALE - MINIMAP_DOT_SIZE / 2
        const dotY = MINIMAP_PADDING + (ch.y / TILE_SIZE) * MINIMAP_SCALE - MINIMAP_DOT_SIZE / 2
        ctx.fillRect(dotX, dotY, MINIMAP_DOT_SIZE, MINIMAP_DOT_SIZE)
      }

      // Viewport rectangle
      const dpr = window.devicePixelRatio || 1
      const deviceW = canvasWidth * dpr
      const deviceH = canvasHeight * dpr
      const mapPixelW = cols * TILE_SIZE * zoom
      const mapPixelH = rows * TILE_SIZE * zoom
      const offsetX = Math.floor((deviceW - mapPixelW) / 2) + Math.round(panRef.current.x)
      const offsetY = Math.floor((deviceH - mapPixelH) / 2) + Math.round(panRef.current.y)

      // Convert viewport bounds to tile coords
      const viewLeftTile = -offsetX / (TILE_SIZE * zoom)
      const viewTopTile = -offsetY / (TILE_SIZE * zoom)
      const viewWidthTiles = deviceW / (TILE_SIZE * zoom)
      const viewHeightTiles = deviceH / (TILE_SIZE * zoom)

      ctx.strokeStyle = MINIMAP_VIEWPORT_COLOR
      ctx.lineWidth = 1
      ctx.strokeRect(
        MINIMAP_PADDING + viewLeftTile * MINIMAP_SCALE,
        MINIMAP_PADDING + viewTopTile * MINIMAP_SCALE,
        viewWidthTiles * MINIMAP_SCALE,
        viewHeightTiles * MINIMAP_SCALE,
      )

      rafId = requestAnimationFrame(render)
    }

    rafId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafId)
  }, [officeState, zoom, panRef, canvasWidth, canvasHeight])

  return (
    <div
      style={{
        position: 'absolute',
        top: 54,
        right: 10,
        zIndex: 50,
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        boxShadow: 'var(--pixel-shadow)',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        width={mapW}
        height={mapH}
        style={{
          display: 'block',
          width: mapW,
          height: mapH,
          imageRendering: 'pixelated',
        }}
      />
    </div>
  )
}
