import { useState, useEffect } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import type { SubagentCharacter } from '../hooks/useExtensionMessages.js'
import { TILE_SIZE, CharacterState } from '../office/types.js'
import { TOOL_OVERLAY_VERTICAL_OFFSET, CHARACTER_SITTING_OFFSET_PX } from '../constants.js'
import { providerAccent, providerLabel } from '../agentProvider.js'

interface AgentLabelsProps {
  officeState: OfficeState
  agents: number[]
  agentStatuses: Record<number, string>
  containerRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  panRef: React.RefObject<{ x: number; y: number }>
  subagentCharacters: SubagentCharacter[]
}

export function AgentLabels({
  officeState,
  agents,
  agentStatuses,
  containerRef,
  zoom,
  panRef,
  subagentCharacters,
}: AgentLabelsProps) {
  const [, setTick] = useState(0)
  useEffect(() => {
    let rafId = 0
    const tick = () => {
      setTick((n) => n + 1)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  const el = containerRef.current
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const canvasW = Math.round(rect.width * dpr)
  const canvasH = Math.round(rect.height * dpr)
  const layout = officeState.getLayout()
  const mapW = layout.cols * TILE_SIZE * zoom
  const mapH = layout.rows * TILE_SIZE * zoom
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x)
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y)

  // Build sub-agent lookup (name takes priority over label)
  const subNameMap = new Map<number, string>()
  for (const sub of subagentCharacters) {
    subNameMap.set(sub.id, sub.name || sub.label)
  }

  // All character IDs to render labels for (regular agents + sub-agents)
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)]

  // Don't render if ToolOverlay would be showing for hovered/selected
  const selectedId = officeState.selectedAgentId
  const hoveredId = officeState.hoveredAgentId

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id)
        if (!ch) return null

        // Skip if ToolOverlay is showing for this character
        if (id === selectedId || id === hoveredId) return null

        // Position above character (same math as ToolOverlay)
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr
        const screenY = (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr

        const status = agentStatuses[id]
        const isWaiting = status === 'waiting'
        const isActive = ch.isActive
        const isSub = ch.isSubagent
        const providerColor = providerAccent(ch.provider || 'unknown')
        const providerShort = providerLabel(ch.provider || 'unknown').charAt(0)

        let dotColor: string | null = null
        if (isWaiting) {
          dotColor = 'var(--pixel-status-permission)'
        } else if (isActive) {
          dotColor = 'var(--pixel-status-active)'
        }

        // Label: sub-agents show name/label, parent agents show projectName or Agent #N
        const labelText = isSub
          ? (ch.agentName || subNameMap.get(id) || `Agent #${id}`)
          : (ch.projectName || `Agent #${id}`)

        return (
          <div
            key={id}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY - 8,
              transform: 'translateX(-50%)',
              pointerEvents: 'none',
              zIndex: 40,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'var(--pixel-bg)',
                border: `2px solid ${providerColor}`,
                borderRadius: 0,
                padding: '2px 6px',
                boxShadow: 'var(--pixel-shadow)',
                whiteSpace: 'nowrap',
                maxWidth: 160,
              }}
            >
              {dotColor && (
                <span
                  className={isActive && !isWaiting ? 'pixel-agents-pulse' : undefined}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                style={{
                  width: 10,
                  height: 10,
                  border: '1px solid rgba(0,0,0,0.5)',
                  background: providerColor,
                  color: 'rgba(0,0,0,0.75)',
                  fontSize: 9,
                  lineHeight: '10px',
                  textAlign: 'center',
                  flexShrink: 0,
                }}
              >
                {providerShort}
              </span>
              <span
                style={{
                  fontSize: isSub ? '16px' : '18px',
                  fontStyle: isSub ? 'italic' : undefined,
                  color: 'rgba(255, 255, 255, 0.8)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {labelText}
              </span>
            </div>
          </div>
        )
      })}
    </>
  )
}
